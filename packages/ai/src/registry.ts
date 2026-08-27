import { DATA_CLASSIFICATIONS, type DataClassification } from '@green-hive/trust';
import { AIGatewayError } from './errors.js';
import type {
  AIGatewayConfiguration,
  AIModelRegistration,
  AIOutputSchemaRegistration,
  AITaskRegistration,
} from './gateway-types.js';
import type { AIProvider } from './types.js';

const CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const RELEASE = /^[A-Z][A-Z0-9_.:-]{2,127}$/;
const MODEL_CODE = /^[A-Z][A-Z0-9_.:-]{2,127}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,8})?$/;
const CURRENCIES = /^[A-Z]{3}$/;
const CLASSIFICATION_ORDER: Readonly<Record<DataClassification, number>> = Object.freeze({
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  HIGHLY_CONFIDENTIAL: 3,
});

function invalid(): never {
  throw new AIGatewayError('AI_GATEWAY_CONFIGURATION_INVALID');
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function validateTask(task: AITaskRegistration): AITaskRegistration {
  if (
    !task
    || !CODE.test(task.taskType)
    || !task.taskType.includes('_')
    || (task.outputMode !== 'TEXT' && task.outputMode !== 'STRUCTURED')
    || !DATA_CLASSIFICATIONS.includes(task.sensitivityMax)
    || !CODE.test(task.preferredModelClass)
    || !Number.isInteger(task.maxInputTokensInternal)
    || task.maxInputTokensInternal < 1
    || task.maxInputTokensInternal > 65_536
    || !Number.isInteger(task.maxOutputTokensInternal)
    || task.maxOutputTokensInternal < 1
    || task.maxOutputTokensInternal > 8_192
    || task.costBudgetType !== 'AI'
    || !['NONE', 'PROJECT_SCOPED', 'PUBLIC_SAFE'].includes(task.cachePolicy)
    || !CODE.test(task.capabilityCode)
    || !task.retryPolicy
    || !Number.isInteger(task.retryPolicy.maxAttempts)
    || task.retryPolicy.maxAttempts < 1
    || task.retryPolicy.maxAttempts > 3
    || !Array.isArray(task.retryPolicy.retryableProviderErrors)
    || task.retryPolicy.retryableProviderErrors.some((code) => !['UNAVAILABLE', 'TIMEOUT'].includes(code))
    || hasDuplicate(task.retryPolicy.retryableProviderErrors)
    || (task.outputMode === 'STRUCTURED' && (!task.outputSchemaId || !CODE.test(task.outputSchemaId)))
    || (task.outputMode === 'TEXT' && task.outputSchemaId !== undefined)
    || (task.sanitizer !== undefined && (
      !['MINIMIZE_CONTEXT', 'ABSTRACT_QUERY', 'METADATA_ONLY'].includes(task.sanitizer.mode)
      || typeof task.sanitizer.sanitize !== 'function'
    ))
  ) invalid();
  return Object.freeze({
    ...task,
    retryPolicy: Object.freeze({
      maxAttempts: task.retryPolicy.maxAttempts,
      retryableProviderErrors: Object.freeze([...task.retryPolicy.retryableProviderErrors]),
    }),
    ...(task.sanitizer ? { sanitizer: Object.freeze(task.sanitizer) } : {}),
  });
}

function validateModel(model: AIModelRegistration): AIModelRegistration {
  if (
    !model
    || !CODE.test(model.modelClass)
    || !CODE.test(model.providerCode)
    || !MODEL_CODE.test(model.modelCode)
    || typeof model.enabled !== 'boolean'
    || !Number.isInteger(model.priority)
    || model.priority < 1
    || model.priority > 10_000
    || !Number.isInteger(model.maxInputTokens)
    || model.maxInputTokens < 1
    || model.maxInputTokens > 65_536
    || !Number.isInteger(model.maxOutputTokens)
    || model.maxOutputTokens < 1
    || model.maxOutputTokens > 8_192
    || !DECIMAL.test(model.inputCostPerThousandTokens)
    || !DECIMAL.test(model.outputCostPerThousandTokens)
    || !CURRENCIES.test(model.currency)
  ) invalid();
  return Object.freeze({ ...model });
}

export class AIGatewayRegistry {
  readonly configurationRelease: string;
  readonly #providers: ReadonlyMap<string, AIProvider>;
  readonly #models: readonly AIModelRegistration[];
  readonly #tasks: ReadonlyMap<string, AITaskRegistration>;
  readonly #schemas: ReadonlyMap<string, AIOutputSchemaRegistration>;

  constructor(configuration: AIGatewayConfiguration) {
    if (!configuration || !RELEASE.test(configuration.configurationRelease)) invalid();
    if (
      !Array.isArray(configuration.providers)
      || !Array.isArray(configuration.models)
      || !Array.isArray(configuration.tasks)
      || !Array.isArray(configuration.schemas)
      || configuration.providers.length === 0
      || configuration.models.length === 0
      || configuration.tasks.length === 0
    ) invalid();
    const providers = configuration.providers.map((provider) => {
      if (!provider || !CODE.test(provider.providerCode)) invalid();
      return provider;
    });
    if (hasDuplicate(providers.map((provider) => provider.providerCode))) invalid();
    const models = configuration.models.map(validateModel);
    if (hasDuplicate(models.map((model) => `${model.providerCode}:${model.modelCode}`))) invalid();
    const providerCodes = new Set(providers.map((provider) => provider.providerCode));
    if (models.some((model) => !providerCodes.has(model.providerCode))) invalid();
    const tasks = configuration.tasks.map(validateTask);
    if (hasDuplicate(tasks.map((task) => task.taskType))) invalid();
    const schemas = configuration.schemas.map((schema) => {
      if (!schema || !CODE.test(schema.schemaId) || typeof schema.validate !== 'function') invalid();
      return Object.freeze(schema);
    });
    if (hasDuplicate(schemas.map((schema) => schema.schemaId))) invalid();
    const schemaIds = new Set(schemas.map((schema) => schema.schemaId));
    if (tasks.some((task) => task.outputSchemaId && !schemaIds.has(task.outputSchemaId))) invalid();
    for (const task of tasks) {
      const eligible = models.some((model) => (
        model.enabled
        && model.modelClass === task.preferredModelClass
        && model.maxInputTokens >= task.maxInputTokensInternal
        && model.maxOutputTokens >= task.maxOutputTokensInternal
      ));
      if (!eligible) invalid();
    }
    this.configurationRelease = configuration.configurationRelease;
    this.#providers = new Map(providers.map((provider) => [provider.providerCode, provider]));
    this.#models = Object.freeze([...models]);
    this.#tasks = new Map(tasks.map((task) => [task.taskType, task]));
    this.#schemas = new Map(schemas.map((schema) => [schema.schemaId, schema]));
  }

  task(taskType: string): AITaskRegistration {
    const task = this.#tasks.get(taskType);
    if (!task) throw new AIGatewayError('AI_GATEWAY_TASK_NOT_FOUND');
    return task;
  }

  route(task: AITaskRegistration): { readonly model: AIModelRegistration; readonly provider: AIProvider } {
    const model = this.#models
      .filter((candidate) => (
        candidate.enabled
        && candidate.modelClass === task.preferredModelClass
        && candidate.maxInputTokens >= task.maxInputTokensInternal
        && candidate.maxOutputTokens >= task.maxOutputTokensInternal
      ))
      .sort((left, right) => left.priority - right.priority)[0];
    if (!model) throw new AIGatewayError('AI_GATEWAY_MODEL_NOT_AVAILABLE');
    const provider = this.#providers.get(model.providerCode);
    if (!provider) throw new AIGatewayError('AI_GATEWAY_MODEL_NOT_AVAILABLE');
    return { model, provider };
  }

  schema(schemaId: string): AIOutputSchemaRegistration {
    const schema = this.#schemas.get(schemaId);
    if (!schema) throw new AIGatewayError('AI_GATEWAY_OUTPUT_SCHEMA_INVALID');
    return schema;
  }

  acceptsClassification(task: AITaskRegistration, classification: DataClassification): boolean {
    return CLASSIFICATION_ORDER[classification]! <= CLASSIFICATION_ORDER[task.sensitivityMax]!;
  }
}
