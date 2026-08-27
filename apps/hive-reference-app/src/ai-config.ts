import {
  AIGatewayError,
  FakeAIProvider,
  type AIGatewayConfiguration,
  type AIJsonValue,
  type AIProvider,
} from '@green-hive/ai';

export const REFERENCE_APP_AI_CONFIGURATION_RELEASE = 'REFERENCE_APP_AI_V1' as const;
export const REFERENCE_APP_AI_TASK_TYPE = 'REFERENCE_APP_STRUCTURED_ECHO' as const;
export const REFERENCE_APP_AI_SCHEMA_ID = 'REFERENCE_APP_ECHO_V1' as const;

function isRecord(value: AIJsonValue): value is { readonly [key: string]: AIJsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateReferenceAppEcho(value: AIJsonValue): AIJsonValue {
  if (!isRecord(value)) throw new AIGatewayError('AI_GATEWAY_OUTPUT_SCHEMA_INVALID');
  const expectedKeys = ['operationId', 'result', 'schemaId', 'taskType'];
  if (
    Object.keys(value).sort().join('|') !== expectedKeys.join('|')
    || value.result !== 'FAKE_AI_SUCCESS'
    || value.taskType !== REFERENCE_APP_AI_TASK_TYPE
    || value.schemaId !== REFERENCE_APP_AI_SCHEMA_ID
    || typeof value.operationId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.operationId)
  ) {
    throw new AIGatewayError('AI_GATEWAY_OUTPUT_SCHEMA_INVALID');
  }
  return Object.freeze({ ...value });
}

function minimizeReferenceAppContext(input: string): string {
  const terms = input.trim().split(/\s+/u).slice(0, 32);
  return `MINIMIZED_CONTEXT word_count=${terms.length}`;
}

/**
 * Server-owned Reference App AI composition. It registers no vendor secret and exposes no
 * provider or model authority to browser callers.
 */
export function createReferenceAppAIConfiguration(
  provider: AIProvider = new FakeAIProvider(),
): AIGatewayConfiguration {
  return Object.freeze({
    configurationRelease: REFERENCE_APP_AI_CONFIGURATION_RELEASE,
    providers: Object.freeze([provider]),
    models: Object.freeze([
      Object.freeze({
        modelClass: 'GENERAL_STRUCTURED',
        providerCode: provider.providerCode,
        modelCode: 'FAKE_DETERMINISTIC_V1',
        enabled: true,
        priority: 100,
        maxInputTokens: 4_096,
        maxOutputTokens: 512,
        inputCostPerThousandTokens: '0.001',
        outputCostPerThousandTokens: '0.002',
        currency: 'BRL',
      }),
    ]),
    tasks: Object.freeze([
      Object.freeze({
        taskType: REFERENCE_APP_AI_TASK_TYPE,
        outputMode: 'STRUCTURED',
        outputSchemaId: REFERENCE_APP_AI_SCHEMA_ID,
        sensitivityMax: 'CONFIDENTIAL',
        preferredModelClass: 'GENERAL_STRUCTURED',
        maxInputTokensInternal: 1_024,
        maxOutputTokensInternal: 256,
        costBudgetType: 'AI',
        cachePolicy: 'NONE',
        retryPolicy: Object.freeze({
          maxAttempts: 2,
          retryableProviderErrors: Object.freeze(['UNAVAILABLE', 'TIMEOUT'] as const),
        }),
        capabilityCode: 'REFERENCE_APP_RUN_JOB',
        sanitizer: Object.freeze({
          mode: 'MINIMIZE_CONTEXT',
          sanitize: minimizeReferenceAppContext,
        }),
      }),
    ]),
    schemas: Object.freeze([
      Object.freeze({
        schemaId: REFERENCE_APP_AI_SCHEMA_ID,
        validate: validateReferenceAppEcho,
      }),
    ]),
  });
}
