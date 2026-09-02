import { SearchProviderError } from './errors.js';
import {
  SEARCH_CONTENT_TRUST,
  type SearchProviderRequest,
  type SearchProviderResult,
  type SearchProviderUsage,
  type SearchResult,
} from './types.js';

const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const REQUEST_KEYS = new Set(['operationId', 'query', 'maxResults']);
const RESULT_KEYS = new Set(['rank', 'title', 'url', 'snippet']);
const PROVIDER_RESULT_KEYS = new Set(['providerCode', 'contentTrust', 'results', 'usage']);
const USAGE_KEYS = new Set(['requestCount', 'resultCount']);
export const SEARCH_MAX_QUERY_CHARACTERS = 4_096;
export const SEARCH_MAX_RESULTS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function invalidInput(): never {
  throw new SearchProviderError('SEARCH_PROVIDER_INVALID_INPUT');
}

function invalidOutput(): never {
  throw new SearchProviderError('SEARCH_PROVIDER_INVALID_OUTPUT');
}

export function validateSearchProviderRequest(value: unknown): SearchProviderRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, REQUEST_KEYS)) invalidInput();
  if (
    typeof value.operationId !== 'string'
    || !OPERATION_ID.test(value.operationId)
    || typeof value.query !== 'string'
    || value.query.trim().length === 0
    || value.query.length > SEARCH_MAX_QUERY_CHARACTERS
    || !Number.isInteger(value.maxResults)
    || (value.maxResults as number) < 1
    || (value.maxResults as number) > SEARCH_MAX_RESULTS
  ) invalidInput();
  return Object.freeze({
    operationId: value.operationId,
    query: value.query,
    maxResults: value.maxResults as number,
  });
}

function validateSearchUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) invalidOutput();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalidOutput();
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username.length > 0
    || parsed.password.length > 0
  ) invalidOutput();
  return parsed.toString();
}

function validateSearchResult(value: unknown, expectedRank: number): SearchResult {
  if (!isRecord(value) || !hasOnlyKeys(value, RESULT_KEYS)) invalidOutput();
  if (
    value.rank !== expectedRank
    || typeof value.title !== 'string'
    || value.title.trim().length === 0
    || value.title.length > 512
    || !(
      value.snippet === null
      || (typeof value.snippet === 'string' && value.snippet.length <= 2_048)
    )
  ) invalidOutput();
  return Object.freeze({
    rank: expectedRank,
    title: value.title as string,
    url: validateSearchUrl(value.url),
    snippet: value.snippet as string | null,
  });
}

function validateUsage(value: unknown, resultCount: number): SearchProviderUsage {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, USAGE_KEYS)
    || value.requestCount !== 1
    || value.resultCount !== resultCount
  ) invalidOutput();
  return Object.freeze({ requestCount: 1, resultCount });
}

export function validateSearchProviderResult(
  value: unknown,
  maximumResults = SEARCH_MAX_RESULTS,
): SearchProviderResult {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, PROVIDER_RESULT_KEYS)
    || typeof value.providerCode !== 'string'
    || !PROVIDER_CODE.test(value.providerCode)
    || value.contentTrust !== SEARCH_CONTENT_TRUST
    || !Array.isArray(value.results)
    || !Number.isInteger(maximumResults)
    || maximumResults < 1
    || maximumResults > SEARCH_MAX_RESULTS
    || value.results.length > maximumResults
  ) invalidOutput();
  const results = Object.freeze(
    value.results.map((result, index) => validateSearchResult(result, index + 1)),
  );
  if (new Set(results.map((result) => result.url)).size !== results.length) invalidOutput();
  return Object.freeze({
    providerCode: value.providerCode,
    contentTrust: SEARCH_CONTENT_TRUST,
    results,
    usage: validateUsage(value.usage, results.length),
  });
}
