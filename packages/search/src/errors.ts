export const SEARCH_PROVIDER_ERROR_CODES = [
  'SEARCH_PROVIDER_INVALID_INPUT',
  'SEARCH_PROVIDER_INVALID_OUTPUT',
  'SEARCH_PROVIDER_UNAVAILABLE',
  'SEARCH_PROVIDER_TIMEOUT',
  'SEARCH_PROVIDER_FAILED',
] as const;

export type SearchProviderErrorCode = (typeof SEARCH_PROVIDER_ERROR_CODES)[number];

const PROVIDER_SAFE_MESSAGES: Readonly<Record<SearchProviderErrorCode, string>> = Object.freeze({
  SEARCH_PROVIDER_INVALID_INPUT: 'Search provider input is invalid',
  SEARCH_PROVIDER_INVALID_OUTPUT: 'Search provider output is invalid',
  SEARCH_PROVIDER_UNAVAILABLE: 'Search provider is unavailable',
  SEARCH_PROVIDER_TIMEOUT: 'Search provider timed out',
  SEARCH_PROVIDER_FAILED: 'Search provider operation failed',
});

export class SearchProviderError extends Error {
  readonly code: SearchProviderErrorCode;

  constructor(code: SearchProviderErrorCode) {
    super(PROVIDER_SAFE_MESSAGES[code]);
    this.name = 'SearchProviderError';
    this.code = code;
  }
}

export const SEARCH_GATEWAY_ERROR_CODES = [
  'SEARCH_GATEWAY_ACCESS_DENIED',
  'SEARCH_GATEWAY_INVALID_INPUT',
  'SEARCH_GATEWAY_CONFIGURATION_INVALID',
  'SEARCH_GATEWAY_TASK_NOT_FOUND',
  'SEARCH_GATEWAY_PROVIDER_NOT_AVAILABLE',
  'SEARCH_GATEWAY_TRUST_DENIED',
  'SEARCH_GATEWAY_CONFIRMATION_REQUIRED',
  'SEARCH_GATEWAY_SANITIZER_REQUIRED',
  'SEARCH_GATEWAY_COST_DENIED',
  'SEARCH_GATEWAY_OPERATION_CONFLICT',
  'SEARCH_GATEWAY_PROVIDER_UNAVAILABLE',
  'SEARCH_GATEWAY_PROVIDER_TIMEOUT',
  'SEARCH_GATEWAY_PROVIDER_FAILED',
  'SEARCH_GATEWAY_OPERATION_FAILED',
] as const;

export type SearchGatewayErrorCode = (typeof SEARCH_GATEWAY_ERROR_CODES)[number];

const GATEWAY_SAFE_MESSAGES: Readonly<Record<SearchGatewayErrorCode, string>> = Object.freeze({
  SEARCH_GATEWAY_ACCESS_DENIED: 'Search Gateway operation is not permitted',
  SEARCH_GATEWAY_INVALID_INPUT: 'Search Gateway input is invalid',
  SEARCH_GATEWAY_CONFIGURATION_INVALID: 'Search Gateway configuration is invalid',
  SEARCH_GATEWAY_TASK_NOT_FOUND: 'Search task is not registered',
  SEARCH_GATEWAY_PROVIDER_NOT_AVAILABLE: 'No eligible search provider is available',
  SEARCH_GATEWAY_TRUST_DENIED: 'Search processing is denied by Trust Policy',
  SEARCH_GATEWAY_CONFIRMATION_REQUIRED: 'Search processing requires verified confirmation',
  SEARCH_GATEWAY_SANITIZER_REQUIRED: 'Search processing requires a registered sanitizer',
  SEARCH_GATEWAY_COST_DENIED: 'Search processing is denied by Cost Guard',
  SEARCH_GATEWAY_OPERATION_CONFLICT: 'Search operation identity conflicts with an earlier request',
  SEARCH_GATEWAY_PROVIDER_UNAVAILABLE: 'Search provider is unavailable',
  SEARCH_GATEWAY_PROVIDER_TIMEOUT: 'Search provider timed out',
  SEARCH_GATEWAY_PROVIDER_FAILED: 'Search provider operation failed',
  SEARCH_GATEWAY_OPERATION_FAILED: 'Search Gateway operation could not be completed',
});

export class SearchGatewayError extends Error {
  readonly code: SearchGatewayErrorCode;

  constructor(code: SearchGatewayErrorCode) {
    super(GATEWAY_SAFE_MESSAGES[code]);
    this.name = 'SearchGatewayError';
    this.code = code;
  }
}
