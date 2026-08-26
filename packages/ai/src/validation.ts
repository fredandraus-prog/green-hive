import { AIProviderError } from './errors.js';
import type {
  AIJsonValue,
  AIProviderUsage,
  AIStructuredGenerationRequest,
  AIStructuredGenerationResult,
  AITextGenerationRequest,
  AITextGenerationResult,
} from './types.js';

const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const MODEL_CLASS = /^[A-Z][A-Z0-9_]{2,63}$/;
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const MODEL_CODE = /^[A-Z][A-Z0-9_.:-]{2,127}$/;
const TEXT_REQUEST_KEYS = new Set([
  'operationId',
  'taskType',
  'modelClass',
  'input',
  'maxOutputTokens',
]);
const STRUCTURED_REQUEST_KEYS = new Set([...TEXT_REQUEST_KEYS, 'outputSchemaId']);
const TEXT_RESULT_KEYS = new Set([
  'outputMode',
  'providerCode',
  'modelCode',
  'content',
  'finishReason',
  'usage',
]);
const STRUCTURED_RESULT_KEYS = new Set([
  'outputMode',
  'providerCode',
  'modelCode',
  'value',
  'finishReason',
  'usage',
]);
const USAGE_KEYS = new Set(['inputTokens', 'outputTokens']);
const MAX_INPUT_CHARACTERS = 65_536;
const MAX_OUTPUT_TOKENS = 8_192;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function validateRequestBase(
  value: Record<string, unknown>,
): AITextGenerationRequest {
  if (
    typeof value.operationId !== 'string'
    || !OPERATION_ID.test(value.operationId)
    || typeof value.taskType !== 'string'
    || !APP_CODE.test(value.taskType)
    || !value.taskType.includes('_')
    || typeof value.modelClass !== 'string'
    || !MODEL_CLASS.test(value.modelClass)
    || typeof value.input !== 'string'
    || value.input.trim().length === 0
    || value.input.length > MAX_INPUT_CHARACTERS
    || !Number.isInteger(value.maxOutputTokens)
    || (value.maxOutputTokens as number) < 1
    || (value.maxOutputTokens as number) > MAX_OUTPUT_TOKENS
  ) {
    throw new AIProviderError('AI_PROVIDER_INVALID_INPUT');
  }
  return {
    operationId: value.operationId,
    taskType: value.taskType,
    modelClass: value.modelClass,
    input: value.input,
    maxOutputTokens: value.maxOutputTokens as number,
  };
}

export function validateAITextGenerationRequest(
  value: unknown,
): AITextGenerationRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, TEXT_REQUEST_KEYS)) {
    throw new AIProviderError('AI_PROVIDER_INVALID_INPUT');
  }
  return validateRequestBase(value);
}

export function validateAIStructuredGenerationRequest(
  value: unknown,
): AIStructuredGenerationRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, STRUCTURED_REQUEST_KEYS)) {
    throw new AIProviderError('AI_PROVIDER_INVALID_INPUT');
  }
  const request = validateRequestBase(value);
  if (
    typeof value.outputSchemaId !== 'string'
    || !APP_CODE.test(value.outputSchemaId)
    || !value.outputSchemaId.includes('_')
  ) {
    throw new AIProviderError('AI_PROVIDER_INVALID_INPUT');
  }
  return { ...request, outputSchemaId: value.outputSchemaId };
}

export function validateAIJsonValue(value: unknown): AIJsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => validateAIJsonValue(item));
  }
  if (isRecord(value)) {
    const normalized: Record<string, AIJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.length === 0 || key.length > 128) {
        throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
      }
      normalized[key] = validateAIJsonValue(item);
    }
    return normalized;
  }
  throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
}

function validateUsage(value: unknown): AIProviderUsage {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, USAGE_KEYS)
    || !Number.isInteger(value.inputTokens)
    || (value.inputTokens as number) < 0
    || !Number.isInteger(value.outputTokens)
    || (value.outputTokens as number) < 0
  ) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  return {
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
  };
}

function validateResultIdentity(value: Record<string, unknown>): {
  readonly providerCode: string;
  readonly modelCode: string;
  readonly finishReason: 'STOP' | 'LENGTH';
  readonly usage: AIProviderUsage;
} {
  if (
    typeof value.providerCode !== 'string'
    || !PROVIDER_CODE.test(value.providerCode)
    || typeof value.modelCode !== 'string'
    || !MODEL_CODE.test(value.modelCode)
    || (value.finishReason !== 'STOP' && value.finishReason !== 'LENGTH')
  ) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  return {
    providerCode: value.providerCode,
    modelCode: value.modelCode,
    finishReason: value.finishReason,
    usage: validateUsage(value.usage),
  };
}

export function validateAITextGenerationResult(
  value: unknown,
): AITextGenerationResult {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, TEXT_RESULT_KEYS)
    || value.outputMode !== 'TEXT'
    || typeof value.content !== 'string'
    || value.content.length === 0
  ) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  return {
    outputMode: 'TEXT',
    ...validateResultIdentity(value),
    content: value.content,
  };
}

export function validateAIStructuredGenerationResult(
  value: unknown,
): AIStructuredGenerationResult {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, STRUCTURED_RESULT_KEYS)
    || value.outputMode !== 'STRUCTURED'
  ) {
    throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
  }
  return {
    outputMode: 'STRUCTURED',
    ...validateResultIdentity(value),
    value: validateAIJsonValue(value.value),
  };
}

export function countDeterministicFakeTokens(value: string): number {
  const normalized = value.trim();
  return normalized.length === 0 ? 0 : normalized.split(/\s+/u).length;
}
