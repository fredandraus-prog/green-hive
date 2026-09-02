import { SearchProviderError } from './errors.js';
import {
  FAKE_SEARCH_FAILURE_MODES,
  SEARCH_CONTENT_TRUST,
  type FakeSearchFailureMode,
  type FakeSearchProviderOptions,
  type SearchProvider,
  type SearchProviderRequest,
  type SearchProviderResult,
  type SearchResult,
} from './types.js';
import {
  SEARCH_MAX_RESULTS,
  validateSearchProviderRequest,
  validateSearchProviderResult,
} from './validation.js';

const OPTION_KEYS = new Set(['results', 'failureMode']);

const DEFAULT_RESULTS: readonly SearchResult[] = Object.freeze([
  Object.freeze({
    rank: 1,
    title: 'GREEN_HIVE_FAKE_SEARCH_RESULT_1',
    url: 'https://example.invalid/green-hive/fake-search/1',
    snippet: 'Deterministic untrusted search data for local development and tests.',
  }),
  Object.freeze({
    rank: 2,
    title: 'GREEN_HIVE_FAKE_SEARCH_RESULT_2',
    url: 'https://example.invalid/green-hive/fake-search/2',
    snippet: 'No external network request was performed to produce this result.',
  }),
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configuredFailure(mode: FakeSearchFailureMode): void {
  if (mode === 'UNAVAILABLE') {
    throw new SearchProviderError('SEARCH_PROVIDER_UNAVAILABLE');
  }
  if (mode === 'TIMEOUT') {
    throw new SearchProviderError('SEARCH_PROVIDER_TIMEOUT');
  }
  if (mode === 'FAILED') {
    throw new SearchProviderError('SEARCH_PROVIDER_FAILED');
  }
}

function normalizeConfiguredResults(value: unknown): readonly SearchResult[] {
  if (!Array.isArray(value)) throw new SearchProviderError('SEARCH_PROVIDER_FAILED');
  try {
    return validateSearchProviderResult({
      providerCode: FakeSearchProvider.providerCode,
      contentTrust: SEARCH_CONTENT_TRUST,
      results: value,
      usage: { requestCount: 1, resultCount: value.length },
    }, SEARCH_MAX_RESULTS).results;
  } catch {
    throw new SearchProviderError('SEARCH_PROVIDER_FAILED');
  }
}

export class FakeSearchProvider implements SearchProvider {
  static readonly providerCode = 'GREEN_HIVE_FAKE_SEARCH';
  readonly providerCode = FakeSearchProvider.providerCode;

  readonly #results: readonly SearchResult[];
  readonly #failureMode: FakeSearchFailureMode;

  constructor(options: FakeSearchProviderOptions = {}) {
    if (!isRecord(options) || Object.keys(options).some((key) => !OPTION_KEYS.has(key))) {
      throw new SearchProviderError('SEARCH_PROVIDER_FAILED');
    }
    const failureMode: unknown = options.failureMode ?? 'NONE';
    if (
      typeof failureMode !== 'string'
      || !FAKE_SEARCH_FAILURE_MODES.includes(failureMode as FakeSearchFailureMode)
    ) {
      throw new SearchProviderError('SEARCH_PROVIDER_FAILED');
    }
    this.#failureMode = failureMode as FakeSearchFailureMode;
    this.#results = options.results === undefined
      ? DEFAULT_RESULTS
      : normalizeConfiguredResults(options.results);
  }

  async search(request: SearchProviderRequest): Promise<SearchProviderResult> {
    const validated = validateSearchProviderRequest(request);
    configuredFailure(this.#failureMode);
    const results = this.#results.slice(0, validated.maxResults);
    return validateSearchProviderResult({
      providerCode: this.providerCode,
      contentTrust: SEARCH_CONTENT_TRUST,
      results,
      usage: { requestCount: 1, resultCount: results.length },
    }, validated.maxResults);
  }
}
