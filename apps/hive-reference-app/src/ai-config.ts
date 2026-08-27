import {
  AIGatewayError,
  FakeAIProvider,
  OPENAI_CANONICAL_MODEL_CODE,
  OPENAI_PROVIDER_CODE,
  OpenAIResponsesProvider,
  type AIGatewayConfiguration,
  type AIJsonValue,
  type AIProvider,
  type OpenAIResponsesFetch,
  type OpenAIStructuredTaskProfile,
} from '@green-hive/ai';

export const REFERENCE_APP_AI_CONFIGURATION_RELEASE = 'REFERENCE_APP_AI_V1' as const;
export const REFERENCE_APP_OPENAI_STAGING_CONFIGURATION_RELEASE =
  'REFERENCE_APP_AI_OPENAI_STAGING_V1' as const;
export const REFERENCE_APP_AI_TASK_TYPE = 'REFERENCE_APP_STRUCTURED_ECHO' as const;
export const REFERENCE_APP_AI_SCHEMA_ID = 'REFERENCE_APP_ECHO_V1' as const;
export const REFERENCE_APP_AI_SUCCESS_RESULT = 'REFERENCE_APP_AI_SUCCESS' as const;

const REFERENCE_APP_MODEL_CLASS = 'GENERAL_STRUCTURED' as const;
const FAKE_PROVIDER_CODE = 'GREEN_HIVE_FAKE_AI' as const;

export const REFERENCE_APP_OPENAI_STAGING_TASK_PROFILE: OpenAIStructuredTaskProfile =
  Object.freeze({
    taskType: REFERENCE_APP_AI_TASK_TYPE,
    modelClass: REFERENCE_APP_MODEL_CLASS,
    outputMode: 'STRUCTURED',
    outputSchemaId: REFERENCE_APP_AI_SCHEMA_ID,
    schemaName: 'reference_app_ai_result_v1',
    instructions: [
      'This is a controlled Green Hive staging connectivity task.',
      'Return only the JSON object required by the registered schema.',
      `Set result exactly to ${REFERENCE_APP_AI_SUCCESS_RESULT}.`,
      'Do not repeat, transform, summarize, or expose the user input.',
    ].join(' '),
    jsonSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        result: Object.freeze({
          type: 'string',
          enum: Object.freeze([REFERENCE_APP_AI_SUCCESS_RESULT]),
        }),
      }),
      required: Object.freeze(['result']),
      additionalProperties: false,
    }),
  });

export type ReferenceAppAIProfile = 'FAKE' | 'OPENAI_STAGING';

export interface ReferenceAppAIComposition {
  readonly provider: AIProvider;
  /** Server-owned allowlisted profile; callers cannot supply model, price or limit fields. */
  readonly profile: ReferenceAppAIProfile;
}

export interface ReferenceAppOpenAIStagingOptions {
  /** Injectable only for deterministic tests; production uses the provider's fixed HTTPS transport. */
  readonly fetch?: OpenAIResponsesFetch;
  readonly timeoutMs?: number;
}

interface ReferenceAppAIProfileDefinition {
  readonly configurationRelease: string;
  readonly expectedProviderCode: string;
  readonly modelCode: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly inputTokenOverhead: number;
  readonly inputCostPerThousandTokens: string;
  readonly outputCostPerThousandTokens: string;
  readonly currency: string;
  readonly sensitivityMax: 'INTERNAL' | 'CONFIDENTIAL';
  readonly taskMaxInputTokens: number;
  readonly taskMaxOutputTokens: number;
  readonly maxAttempts: number;
  readonly retryableProviderErrors: readonly ('UNAVAILABLE' | 'TIMEOUT')[];
}

const FAKE_PROFILE: ReferenceAppAIProfileDefinition = Object.freeze({
  configurationRelease: REFERENCE_APP_AI_CONFIGURATION_RELEASE,
  expectedProviderCode: FAKE_PROVIDER_CODE,
  modelCode: 'FAKE_DETERMINISTIC_V1',
  maxInputTokens: 4_096,
  maxOutputTokens: 512,
  inputTokenOverhead: 0,
  inputCostPerThousandTokens: '0.001',
  outputCostPerThousandTokens: '0.002',
  currency: 'BRL',
  sensitivityMax: 'CONFIDENTIAL',
  taskMaxInputTokens: 1_024,
  taskMaxOutputTokens: 256,
  maxAttempts: 2,
  retryableProviderErrors: Object.freeze(['UNAVAILABLE', 'TIMEOUT'] as const),
});

const OPENAI_STAGING_PROFILE: ReferenceAppAIProfileDefinition = Object.freeze({
  configurationRelease: REFERENCE_APP_OPENAI_STAGING_CONFIGURATION_RELEASE,
  expectedProviderCode: OPENAI_PROVIDER_CODE,
  modelCode: OPENAI_CANONICAL_MODEL_CODE,
  maxInputTokens: 65_536,
  maxOutputTokens: 8_192,
  inputTokenOverhead: 1_024,
  inputCostPerThousandTokens: '0.00015',
  outputCostPerThousandTokens: '0.00060',
  currency: 'USD',
  sensitivityMax: 'INTERNAL',
  taskMaxInputTokens: 128,
  taskMaxOutputTokens: 64,
  maxAttempts: 1,
  retryableProviderErrors: Object.freeze([]),
});

function isRecord(value: AIJsonValue): value is { readonly [key: string]: AIJsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateReferenceAppEcho(value: AIJsonValue): AIJsonValue {
  if (!isRecord(value)) throw new AIGatewayError('AI_GATEWAY_OUTPUT_SCHEMA_INVALID');
  const keys = Object.keys(value).sort();
  const isProviderNeutral = (
    keys.join('|') === 'result'
    && value.result === REFERENCE_APP_AI_SUCCESS_RESULT
  );
  const isLegacyFake = (
    keys.join('|') === 'operationId|result|schemaId|taskType'
    && value.result === 'FAKE_AI_SUCCESS'
    && value.taskType === REFERENCE_APP_AI_TASK_TYPE
    && value.schemaId === REFERENCE_APP_AI_SCHEMA_ID
    && typeof value.operationId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.operationId)
  );
  if (!isProviderNeutral && !isLegacyFake) {
    throw new AIGatewayError('AI_GATEWAY_OUTPUT_SCHEMA_INVALID');
  }
  return Object.freeze({ result: REFERENCE_APP_AI_SUCCESS_RESULT });
}

function minimizeReferenceAppContext(input: string): string {
  const terms = input.trim().split(/\s+/u).slice(0, 32);
  return `MINIMIZED_CONTEXT word_count=${terms.length}`;
}

function isComposition(
  value: AIProvider | ReferenceAppAIComposition,
): value is ReferenceAppAIComposition {
  return typeof value === 'object' && value !== null && 'provider' in value && 'profile' in value;
}

function profileDefinition(profile: ReferenceAppAIProfile): ReferenceAppAIProfileDefinition {
  if (profile === 'FAKE') return FAKE_PROFILE;
  if (profile === 'OPENAI_STAGING') return OPENAI_STAGING_PROFILE;
  throw new AIGatewayError('AI_GATEWAY_CONFIGURATION_INVALID');
}

function providerNeutralFake(): FakeAIProvider {
  return new FakeAIProvider({
    structuredOutput: Object.freeze({ result: REFERENCE_APP_AI_SUCCESS_RESULT }),
  });
}

/**
 * Server-owned Reference App AI composition. The compatibility form still accepts a fake
 * provider directly; real-provider composition can select only an allowlisted fixed profile.
 */
export function createReferenceAppAIConfiguration(
  providerOrComposition: AIProvider | ReferenceAppAIComposition = providerNeutralFake(),
): AIGatewayConfiguration {
  const composition = isComposition(providerOrComposition)
    ? providerOrComposition
    : { provider: providerOrComposition, profile: 'FAKE' as const };
  const profile = profileDefinition(composition.profile);
  if (composition.provider.providerCode !== profile.expectedProviderCode) {
    throw new AIGatewayError('AI_GATEWAY_CONFIGURATION_INVALID');
  }
  return Object.freeze({
    configurationRelease: profile.configurationRelease,
    providers: Object.freeze([composition.provider]),
    models: Object.freeze([
      Object.freeze({
        modelClass: REFERENCE_APP_MODEL_CLASS,
        providerCode: profile.expectedProviderCode,
        modelCode: profile.modelCode,
        enabled: true,
        priority: 100,
        maxInputTokens: profile.maxInputTokens,
        maxOutputTokens: profile.maxOutputTokens,
        inputTokenOverhead: profile.inputTokenOverhead,
        inputCostPerThousandTokens: profile.inputCostPerThousandTokens,
        outputCostPerThousandTokens: profile.outputCostPerThousandTokens,
        currency: profile.currency,
      }),
    ]),
    tasks: Object.freeze([
      Object.freeze({
        taskType: REFERENCE_APP_AI_TASK_TYPE,
        outputMode: 'STRUCTURED',
        outputSchemaId: REFERENCE_APP_AI_SCHEMA_ID,
        sensitivityMax: profile.sensitivityMax,
        preferredModelClass: REFERENCE_APP_MODEL_CLASS,
        maxInputTokensInternal: profile.taskMaxInputTokens,
        maxOutputTokensInternal: profile.taskMaxOutputTokens,
        costBudgetType: 'AI',
        cachePolicy: 'NONE',
        retryPolicy: Object.freeze({
          maxAttempts: profile.maxAttempts,
          retryableProviderErrors: profile.retryableProviderErrors,
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

/**
 * Controlled real-provider profile. The key and optional transport remain server-side;
 * provider, exact model snapshot, pricing, retry policy and token limits are fixed here.
 */
export function createReferenceAppOpenAIStagingConfiguration(
  apiKey: string,
  options: ReferenceAppOpenAIStagingOptions = {},
): AIGatewayConfiguration {
  const provider = new OpenAIResponsesProvider({
    apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    taskProfiles: Object.freeze([REFERENCE_APP_OPENAI_STAGING_TASK_PROFILE]),
  });
  return createReferenceAppAIConfiguration({ provider, profile: 'OPENAI_STAGING' });
}
