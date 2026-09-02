import { DATA_CLASSIFICATIONS, type DataClassification } from '@green-hive/trust';
import { SearchGatewayError } from './errors.js';
import type {
  SearchGatewayConfiguration,
  SearchProvider,
  SearchProviderRegistration,
  SearchTaskRegistration,
} from './types.js';
import { SEARCH_CACHE_POLICIES } from './types.js';
import { SEARCH_MAX_QUERY_CHARACTERS, SEARCH_MAX_RESULTS } from './validation.js';

const CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const RELEASE = /^[A-Z][A-Z0-9_.:-]{2,127}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,8})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const CONFIGURATION_KEYS = new Set(['configurationRelease', 'providers', 'registrations', 'tasks']);
const TASK_KEYS = new Set([
  'searchType',
  'sensitivityMax',
  'preferredProviderClass',
  'maxQueryCharacters',
  'maxResults',
  'costBudgetType',
  'cachePolicy',
  'retryPolicy',
  'capabilityCode',
  'sanitizer',
]);
const RETRY_KEYS = new Set(['maxAttempts', 'retryableProviderErrors']);
const SANITIZER_KEYS = new Set(['mode', 'sanitize']);
const REGISTRATION_KEYS = new Set([
  'providerClass',
  'providerCode',
  'enabled',
  'priority',
  'maxResults',
  'requestCost',
  'resultCost',
  'currency',
]);
const CLASSIFICATION_ORDER: Readonly<Record<DataClassification, number>> = Object.freeze({
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  HIGHLY_CONFIDENTIAL: 3,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new SearchGatewayError('SEARCH_GATEWAY_CONFIGURATION_INVALID');
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function decimalIsPositive(value: string): boolean {
  return /[1-9]/.test(value);
}

function validateTask(task: SearchTaskRegistration): SearchTaskRegistration {
  if (
    !isRecord(task)
    || Object.keys(task).some((key) => !TASK_KEYS.has(key))
    || !CODE.test(task.searchType)
    || !task.searchType.includes('_')
    || !DATA_CLASSIFICATIONS.includes(task.sensitivityMax)
    || !CODE.test(task.preferredProviderClass)
    || !Number.isInteger(task.maxQueryCharacters)
    || task.maxQueryCharacters < 1
    || task.maxQueryCharacters > SEARCH_MAX_QUERY_CHARACTERS
    || !Number.isInteger(task.maxResults)
    || task.maxResults < 1
    || task.maxResults > SEARCH_MAX_RESULTS
    || task.costBudgetType !== 'SEARCH'
    || !SEARCH_CACHE_POLICIES.includes(task.cachePolicy)
    || task.cachePolicy !== 'NONE'
    || !CODE.test(task.capabilityCode)
    || !isRecord(task.retryPolicy)
    || Object.keys(task.retryPolicy).some((key) => !RETRY_KEYS.has(key))
    || !Number.isInteger(task.retryPolicy.maxAttempts)
    || task.retryPolicy.maxAttempts < 1
    || task.retryPolicy.maxAttempts > 3
    || !Array.isArray(task.retryPolicy.retryableProviderErrors)
    || task.retryPolicy.retryableProviderErrors.some(
      (code) => code !== 'UNAVAILABLE' && code !== 'TIMEOUT',
    )
    || hasDuplicate(task.retryPolicy.retryableProviderErrors)
    || (task.sanitizer !== undefined && (
      !isRecord(task.sanitizer)
      || Object.keys(task.sanitizer).some((key) => !SANITIZER_KEYS.has(key))
      || task.sanitizer.mode !== 'ABSTRACT_QUERY'
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

function validateRegistration(
  registration: SearchProviderRegistration,
): SearchProviderRegistration {
  if (
    !isRecord(registration)
    || Object.keys(registration).some((key) => !REGISTRATION_KEYS.has(key))
    || !CODE.test(registration.providerClass)
    || !PROVIDER_CODE.test(registration.providerCode)
    || typeof registration.enabled !== 'boolean'
    || !Number.isInteger(registration.priority)
    || registration.priority < 1
    || registration.priority > 10_000
    || !Number.isInteger(registration.maxResults)
    || registration.maxResults < 1
    || registration.maxResults > SEARCH_MAX_RESULTS
    || !DECIMAL.test(registration.requestCost)
    || !decimalIsPositive(registration.requestCost)
    || !DECIMAL.test(registration.resultCost)
    || !CURRENCY.test(registration.currency)
  ) invalid();
  return Object.freeze({ ...registration });
}

export class SearchGatewayRegistry {
  readonly configurationRelease: string;
  readonly #providers: ReadonlyMap<string, SearchProvider>;
  readonly #registrations: readonly SearchProviderRegistration[];
  readonly #tasks: ReadonlyMap<string, SearchTaskRegistration>;

  constructor(configuration: SearchGatewayConfiguration) {
    if (
      !isRecord(configuration)
      || Object.keys(configuration).some((key) => !CONFIGURATION_KEYS.has(key))
      || typeof configuration.configurationRelease !== 'string'
      || !RELEASE.test(configuration.configurationRelease)
      || !Array.isArray(configuration.providers)
      || !Array.isArray(configuration.registrations)
      || !Array.isArray(configuration.tasks)
      || configuration.providers.length === 0
      || configuration.registrations.length === 0
      || configuration.tasks.length === 0
    ) invalid();

    const providers = configuration.providers.map((provider) => {
      if (
        !provider
        || !PROVIDER_CODE.test(provider.providerCode)
        || typeof provider.search !== 'function'
      ) invalid();
      return provider;
    });
    if (hasDuplicate(providers.map((provider) => provider.providerCode))) invalid();

    const registrations = configuration.registrations.map(validateRegistration);
    if (hasDuplicate(registrations.map(
      (registration) => `${registration.providerClass}:${registration.providerCode}`,
    ))) invalid();
    const providerCodes = new Set(providers.map((provider) => provider.providerCode));
    if (registrations.some((registration) => !providerCodes.has(registration.providerCode))) {
      invalid();
    }

    const tasks = configuration.tasks.map(validateTask);
    if (hasDuplicate(tasks.map((task) => task.searchType))) invalid();
    for (const task of tasks) {
      const eligible = registrations.some((registration) => (
        registration.enabled
        && registration.providerClass === task.preferredProviderClass
        && registration.maxResults >= task.maxResults
      ));
      if (!eligible) invalid();
    }

    this.configurationRelease = configuration.configurationRelease;
    this.#providers = new Map(providers.map((provider) => [provider.providerCode, provider]));
    this.#registrations = Object.freeze([...registrations]);
    this.#tasks = new Map(tasks.map((task) => [task.searchType, task]));
  }

  task(searchType: string): SearchTaskRegistration {
    const task = this.#tasks.get(searchType);
    if (!task) throw new SearchGatewayError('SEARCH_GATEWAY_TASK_NOT_FOUND');
    return task;
  }

  route(task: SearchTaskRegistration): {
    readonly registration: SearchProviderRegistration;
    readonly provider: SearchProvider;
  } {
    const registration = this.#registrations
      .filter((candidate) => (
        candidate.enabled
        && candidate.providerClass === task.preferredProviderClass
        && candidate.maxResults >= task.maxResults
      ))
      .sort((left, right) => left.priority - right.priority)[0];
    if (!registration) {
      throw new SearchGatewayError('SEARCH_GATEWAY_PROVIDER_NOT_AVAILABLE');
    }
    const provider = this.#providers.get(registration.providerCode);
    if (!provider) throw new SearchGatewayError('SEARCH_GATEWAY_PROVIDER_NOT_AVAILABLE');
    return { registration, provider };
  }

  acceptsClassification(task: SearchTaskRegistration, classification: DataClassification): boolean {
    return CLASSIFICATION_ORDER[classification]! <= CLASSIFICATION_ORDER[task.sensitivityMax]!;
  }
}
