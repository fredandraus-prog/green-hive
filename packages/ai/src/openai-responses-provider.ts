import { AIProviderError } from './errors.js';
import type {
  AIJsonValue,
  AIProvider,
  AIProviderUsage,
  AIStructuredGenerationRequest,
  AIStructuredGenerationResult,
  AITextGenerationRequest,
  AITextGenerationResult,
  OpenAIResponsesFetch,
  OpenAIResponsesHttpResponse,
  OpenAIResponsesProviderOptions,
  OpenAIStructuredTaskProfile,
  OpenAITaskProfile,
  OpenAITextTaskProfile,
} from './types.js';
import {
  validateAIJsonValue,
  validateAIStructuredGenerationRequest,
  validateAIStructuredGenerationResult,
  validateAITextGenerationRequest,
  validateAITextGenerationResult,
} from './validation.js';

export const OPENAI_PROVIDER_CODE = 'OPENAI' as const;
export const OPENAI_CANONICAL_MODEL_CODE = 'OPENAI_GPT_4O_MINI_2024_07_18' as const;

const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const OPENAI_API_MODEL = 'gpt-4o-mini-2024-07-18';
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_OUTPUT_CHARACTERS = 262_144;
const MAX_INSTRUCTIONS_CHARACTERS = 16_384;
const MAX_SCHEMA_BYTES = 65_536;
const MAX_PROFILES = 100;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const MODEL_CLASS = /^[A-Z][A-Z0-9_]{2,63}$/;
const SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const OPTION_KEYS = new Set(['apiKey', 'fetch', 'timeoutMs', 'taskProfiles']);
const TEXT_PROFILE_KEYS = new Set([
  'taskType',
  'modelClass',
  'outputMode',
  'instructions',
]);
const STRUCTURED_PROFILE_KEYS = new Set([
  ...TEXT_PROFILE_KEYS,
  'outputSchemaId',
  'schemaName',
  'jsonSchema',
]);

type JsonRecord = Record<string, unknown>;

interface ParsedOpenAIResponse {
  readonly content: string;
  readonly finishReason: 'STOP' | 'LENGTH';
  readonly usage: AIProviderUsage;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validateIdentity(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
  return value;
}

function validateInstructions(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > MAX_INSTRUCTIONS_CHARACTERS
  ) {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
  return value;
}

function assertStrictObjectSchemas(value: AIJsonValue): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertStrictObjectSchemas(item);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (value.type === 'object') {
    if (!isRecord(value.properties) || value.additionalProperties !== false) {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
    if (
      !Array.isArray(value.required)
      || value.required.some((item) => typeof item !== 'string')
    ) {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
    const properties = Object.keys(value.properties).sort();
    const required = [...new Set(value.required as string[])].sort();
    if (
      required.length !== value.required.length
      || properties.length !== required.length
      || properties.some((property, index) => required[index] !== property)
    ) {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
  }
  for (const nested of Object.values(value)) {
    assertStrictObjectSchemas(nested as AIJsonValue);
  }
}

function validateJsonSchema(value: unknown): AIJsonValue {
  const schema = validateAIJsonValue(value);
  if (!isRecord(schema) || schema.type !== 'object') {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
  const serialized = JSON.stringify(schema);
  if (byteLength(serialized) > MAX_SCHEMA_BYTES) {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
  assertStrictObjectSchemas(schema);
  return schema;
}

function validateTextProfile(value: JsonRecord): OpenAITextTaskProfile {
  if (!hasOnlyKeys(value, TEXT_PROFILE_KEYS) || value.outputMode !== 'TEXT') {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
  return Object.freeze({
    taskType: validateIdentity(value.taskType, APP_CODE),
    modelClass: validateIdentity(value.modelClass, MODEL_CLASS),
    outputMode: 'TEXT',
    instructions: validateInstructions(value.instructions),
  });
}

function validateStructuredProfile(value: JsonRecord): OpenAIStructuredTaskProfile {
  if (
    !hasOnlyKeys(value, STRUCTURED_PROFILE_KEYS)
    || value.outputMode !== 'STRUCTURED'
  ) {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
  return Object.freeze({
    taskType: validateIdentity(value.taskType, APP_CODE),
    modelClass: validateIdentity(value.modelClass, MODEL_CLASS),
    outputMode: 'STRUCTURED',
    outputSchemaId: validateIdentity(value.outputSchemaId, APP_CODE),
    schemaName: validateIdentity(value.schemaName, SCHEMA_NAME),
    instructions: validateInstructions(value.instructions),
    jsonSchema: validateJsonSchema(value.jsonSchema),
  });
}

function validateProfiles(value: unknown): ReadonlyMap<string, OpenAITaskProfile> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PROFILES) {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
  const profiles = new Map<string, OpenAITaskProfile>();
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
    const profile = candidate.outputMode === 'TEXT'
      ? validateTextProfile(candidate)
      : validateStructuredProfile(candidate);
    if (profiles.has(profile.taskType)) {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
    profiles.set(profile.taskType, profile);
  }
  return profiles;
}

function defaultFetch(
  url: string,
  init: Parameters<OpenAIResponsesFetch>[1],
): Promise<OpenAIResponsesHttpResponse> {
  return globalThis.fetch(url, init);
}

function validateUsage(value: unknown): AIProviderUsage {
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.input_tokens)
    || (value.input_tokens as number) < 0
    || !Number.isSafeInteger(value.output_tokens)
    || (value.output_tokens as number) < 0
  ) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  return {
    inputTokens: value.input_tokens as number,
    outputTokens: value.output_tokens as number,
  };
}

function extractOutputText(value: JsonRecord): string {
  if (!Array.isArray(value.output)) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  const parts: string[] = [];
  let characters = 0;
  for (const outputItem of value.output) {
    if (!isRecord(outputItem) || outputItem.type !== 'message') {
      continue;
    }
    if (!Array.isArray(outputItem.content)) {
      throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
    }
    for (const contentItem of outputItem.content) {
      if (!isRecord(contentItem)) {
        throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
      }
      if (contentItem.type === 'refusal') {
        throw new AIProviderError('AI_PROVIDER_FAILED');
      }
      if (contentItem.type !== 'output_text') {
        continue;
      }
      if (typeof contentItem.text !== 'string' || contentItem.text.length === 0) {
        throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
      }
      characters += contentItem.text.length;
      if (characters > MAX_OUTPUT_CHARACTERS) {
        throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
      }
      parts.push(contentItem.text);
    }
  }
  const content = parts.join('');
  if (content.length === 0) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  return content;
}

function parseResponseDocument(value: unknown): ParsedOpenAIResponse {
  if (!isRecord(value)) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  if (value.error !== undefined && value.error !== null) {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
  if (value.status === 'failed' || value.status === 'cancelled') {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
  if (value.model !== OPENAI_API_MODEL) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  const content = extractOutputText(value);
  if (value.status === 'incomplete') {
    const details = value.incomplete_details;
    if (!isRecord(details) || details.reason !== 'max_output_tokens') {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
    return {
      content,
      finishReason: 'LENGTH',
      usage: validateUsage(value.usage),
    };
  }
  if (value.status !== 'completed') {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  return {
    content,
    finishReason: 'STOP',
    usage: validateUsage(value.usage),
  };
}

function errorForHttpStatus(status: number): AIProviderError {
  if (status === 408) {
    return new AIProviderError('AI_PROVIDER_TIMEOUT');
  }
  if (status === 429 || status >= 500) {
    return new AIProviderError('AI_PROVIDER_UNAVAILABLE');
  }
  return new AIProviderError('AI_PROVIDER_FAILED');
}

function providerInput(
  request: AITextGenerationRequest | AIStructuredGenerationRequest,
): readonly JsonRecord[] {
  const taskContext = 'outputSchemaId' in request
    ? {
        operationId: request.operationId,
        taskType: request.taskType,
        outputSchemaId: request.outputSchemaId,
      }
    : {
        operationId: request.operationId,
        taskType: request.taskType,
      };
  return [
    {
      role: 'developer',
      content: `GREEN_HIVE_TASK_CONTEXT ${JSON.stringify(taskContext)}`,
    },
    {
      role: 'user',
      content: request.input,
    },
  ];
}

async function parseHttpResponse(
  response: OpenAIResponsesHttpResponse,
): Promise<ParsedOpenAIResponse> {
  if (!response.ok) {
    throw errorForHttpStatus(response.status);
  }
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null
    && /^\d+$/u.test(declaredLength)
    && Number(declaredLength) > MAX_RESPONSE_BYTES
  ) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  const body = await readBoundedBody(response);
  let document: unknown;
  try {
    document = JSON.parse(body) as unknown;
  } catch {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  return parseResponseDocument(document);
}

async function readBoundedBody(response: OpenAIResponsesHttpResponse): Promise<string> {
  if (response.body === undefined || response.body === null) {
    const body = await response.text();
    if (byteLength(body) > MAX_RESPONSE_BYTES) {
      throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
    }
    return body;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    if (!(chunk.value instanceof Uint8Array)) {
      await reader.cancel();
      throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
    }
    bytes += chunk.value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
}

export class OpenAIResponsesProvider implements AIProvider {
  static readonly providerCode = OPENAI_PROVIDER_CODE;
  static readonly modelCode = OPENAI_CANONICAL_MODEL_CODE;
  readonly providerCode = OpenAIResponsesProvider.providerCode;

  readonly #apiKey: string;
  readonly #fetch: OpenAIResponsesFetch;
  readonly #timeoutMs: number;
  readonly #profiles: ReadonlyMap<string, OpenAITaskProfile>;

  constructor(options: OpenAIResponsesProviderOptions) {
    if (
      !isRecord(options)
      || !hasOnlyKeys(options, OPTION_KEYS)
      || typeof options.apiKey !== 'string'
      || options.apiKey.length < 8
      || options.apiKey.length > 4_096
      || options.apiKey.trim() !== options.apiKey
      || (options.fetch !== undefined && typeof options.fetch !== 'function')
    ) {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
    const timeoutMs: unknown = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isInteger(timeoutMs)
      || (timeoutMs as number) < MIN_TIMEOUT_MS
      || (timeoutMs as number) > MAX_TIMEOUT_MS
    ) {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? defaultFetch;
    this.#timeoutMs = timeoutMs as number;
    this.#profiles = validateProfiles(options.taskProfiles);
  }

  async generateText(request: AITextGenerationRequest): Promise<AITextGenerationResult> {
    const validated = validateAITextGenerationRequest(request);
    const profile = this.#profile(validated.taskType, validated.modelClass, 'TEXT');
    const response = await this.#request({
      model: OPENAI_API_MODEL,
      instructions: profile.instructions,
      input: providerInput(validated),
      max_output_tokens: validated.maxOutputTokens,
      store: false,
    });
    return validateAITextGenerationResult({
      outputMode: 'TEXT',
      providerCode: this.providerCode,
      modelCode: OpenAIResponsesProvider.modelCode,
      content: response.content,
      finishReason: response.finishReason,
      usage: response.usage,
    });
  }

  async generateStructured(
    request: AIStructuredGenerationRequest,
  ): Promise<AIStructuredGenerationResult> {
    const validated = validateAIStructuredGenerationRequest(request);
    const profile = this.#profile(
      validated.taskType,
      validated.modelClass,
      'STRUCTURED',
    );
    if (validated.outputSchemaId !== profile.outputSchemaId) {
      throw new AIProviderError('AI_PROVIDER_INVALID_INPUT');
    }
    const response = await this.#request({
      model: OPENAI_API_MODEL,
      instructions: profile.instructions,
      input: providerInput(validated),
      max_output_tokens: validated.maxOutputTokens,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: profile.schemaName,
          schema: profile.jsonSchema,
          strict: true,
        },
      },
    });
    if (response.finishReason !== 'STOP') {
      throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
    }
    let value: unknown;
    try {
      value = JSON.parse(response.content) as unknown;
    } catch {
      throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
    }
    return validateAIStructuredGenerationResult({
      outputMode: 'STRUCTURED',
      providerCode: this.providerCode,
      modelCode: OpenAIResponsesProvider.modelCode,
      value,
      finishReason: response.finishReason,
      usage: response.usage,
    });
  }

  #profile(
    taskType: string,
    modelClass: string,
    outputMode: 'TEXT',
  ): OpenAITextTaskProfile;
  #profile(
    taskType: string,
    modelClass: string,
    outputMode: 'STRUCTURED',
  ): OpenAIStructuredTaskProfile;
  #profile(
    taskType: string,
    modelClass: string,
    outputMode: 'TEXT' | 'STRUCTURED',
  ): OpenAITaskProfile {
    const profile = this.#profiles.get(taskType);
    if (
      profile === undefined
      || profile.modelClass !== modelClass
      || profile.outputMode !== outputMode
    ) {
      throw new AIProviderError('AI_PROVIDER_INVALID_INPUT');
    }
    return profile;
  }

  async #request(body: JsonRecord): Promise<ParsedOpenAIResponse> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new AIProviderError('AI_PROVIDER_TIMEOUT'));
      }, this.#timeoutMs);
    });
    const requestPromise = (async () => {
      const response = await this.#fetch(OPENAI_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return parseHttpResponse(response);
    })();
    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AIProviderError('AI_PROVIDER_TIMEOUT');
      }
      if (error instanceof AIProviderError) {
        throw error;
      }
      throw new AIProviderError('AI_PROVIDER_UNAVAILABLE');
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
