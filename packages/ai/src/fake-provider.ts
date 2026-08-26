import { AIProviderError } from './errors.js';
import type {
  AIJsonValue,
  AIProvider,
  AIStructuredGenerationRequest,
  AIStructuredGenerationResult,
  AITextGenerationRequest,
  AITextGenerationResult,
  FakeAIFailureMode,
  FakeAIProviderOptions,
} from './types.js';
import {
  countDeterministicFakeTokens,
  validateAIJsonValue,
  validateAIStructuredGenerationRequest,
  validateAIStructuredGenerationResult,
  validateAITextGenerationRequest,
  validateAITextGenerationResult,
} from './validation.js';

const MODEL_CODE = /^[A-Z][A-Z0-9_.:-]{2,127}$/;
const FAILURE_MODES = new Set<FakeAIFailureMode>([
  'NONE',
  'UNAVAILABLE',
  'TIMEOUT',
  'FAILED',
]);
const OPTION_KEYS = new Set([
  'textOutput',
  'structuredOutput',
  'modelCode',
  'failureMode',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function throwConfiguredFailure(mode: FakeAIFailureMode): void {
  if (mode === 'UNAVAILABLE') {
    throw new AIProviderError('AI_PROVIDER_UNAVAILABLE');
  }
  if (mode === 'TIMEOUT') {
    throw new AIProviderError('AI_PROVIDER_TIMEOUT');
  }
  if (mode === 'FAILED') {
    throw new AIProviderError('AI_PROVIDER_FAILED');
  }
}

function defaultStructuredOutput(
  request: AIStructuredGenerationRequest,
): AIJsonValue {
  return {
    result: 'FAKE_AI_SUCCESS',
    taskType: request.taskType,
    operationId: request.operationId,
    schemaId: request.outputSchemaId,
  };
}

export class FakeAIProvider implements AIProvider {
  static readonly providerCode = 'GREEN_HIVE_FAKE_AI';
  readonly providerCode = FakeAIProvider.providerCode;

  readonly #textOutput: string | undefined;
  readonly #structuredOutput: AIJsonValue | undefined;
  readonly #modelCode: string;
  readonly #failureMode: FakeAIFailureMode;

  constructor(options: FakeAIProviderOptions = {}) {
    if (!isRecord(options) || Object.keys(options).some((key) => !OPTION_KEYS.has(key))) {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
    const failureMode: unknown = options.failureMode ?? 'NONE';
    const modelCode: unknown = options.modelCode ?? 'FAKE_DETERMINISTIC_V1';
    const textOutput: unknown = options.textOutput;
    if (
      typeof failureMode !== 'string'
      || !FAILURE_MODES.has(failureMode as FakeAIFailureMode)
      || typeof modelCode !== 'string'
      || !MODEL_CODE.test(modelCode)
      || (textOutput !== undefined
        && (typeof textOutput !== 'string' || textOutput.length === 0))
    ) {
      throw new AIProviderError('AI_PROVIDER_FAILED');
    }
    this.#failureMode = failureMode as FakeAIFailureMode;
    this.#modelCode = modelCode;
    this.#textOutput = textOutput;
    this.#structuredOutput = options.structuredOutput === undefined
      ? undefined
      : validateAIJsonValue(options.structuredOutput);
  }

  async generateText(request: AITextGenerationRequest): Promise<AITextGenerationResult> {
    const validated = validateAITextGenerationRequest(request);
    throwConfiguredFailure(this.#failureMode);
    const content = this.#textOutput
      ?? `FAKE_AI_SUCCESS ${validated.taskType} ${validated.operationId}`;
    return validateAITextGenerationResult({
      outputMode: 'TEXT',
      providerCode: this.providerCode,
      modelCode: this.#modelCode,
      content,
      finishReason: 'STOP',
      usage: {
        inputTokens: countDeterministicFakeTokens(validated.input),
        outputTokens: countDeterministicFakeTokens(content),
      },
    });
  }

  async generateStructured(
    request: AIStructuredGenerationRequest,
  ): Promise<AIStructuredGenerationResult> {
    const validated = validateAIStructuredGenerationRequest(request);
    throwConfiguredFailure(this.#failureMode);
    const value = validateAIJsonValue(
      this.#structuredOutput ?? defaultStructuredOutput(validated),
    );
    return validateAIStructuredGenerationResult({
      outputMode: 'STRUCTURED',
      providerCode: this.providerCode,
      modelCode: this.#modelCode,
      value,
      finishReason: 'STOP',
      usage: {
        inputTokens: countDeterministicFakeTokens(validated.input),
        outputTokens: countDeterministicFakeTokens(JSON.stringify(value)),
      },
    });
  }
}
