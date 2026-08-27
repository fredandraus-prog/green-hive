export const AI_PROVIDER_ERROR_CODES = [
  'AI_PROVIDER_INVALID_INPUT',
  'AI_PROVIDER_INVALID_OUTPUT',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_TIMEOUT',
  'AI_PROVIDER_FAILED',
] as const;

export type AIProviderErrorCode = (typeof AI_PROVIDER_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<AIProviderErrorCode, string>> = Object.freeze({
  AI_PROVIDER_INVALID_INPUT: 'AI provider input is invalid',
  AI_PROVIDER_INVALID_OUTPUT: 'AI provider output is invalid',
  AI_PROVIDER_UNAVAILABLE: 'AI provider is unavailable',
  AI_PROVIDER_TIMEOUT: 'AI provider timed out',
  AI_PROVIDER_FAILED: 'AI provider operation failed',
});

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;

  constructor(code: AIProviderErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'AIProviderError';
    this.code = code;
  }
}

export const AI_GATEWAY_ERROR_CODES = [
  'AI_GATEWAY_ACCESS_DENIED',
  'AI_GATEWAY_INVALID_INPUT',
  'AI_GATEWAY_CONFIGURATION_INVALID',
  'AI_GATEWAY_TASK_NOT_FOUND',
  'AI_GATEWAY_MODEL_NOT_AVAILABLE',
  'AI_GATEWAY_TRUST_DENIED',
  'AI_GATEWAY_CONFIRMATION_REQUIRED',
  'AI_GATEWAY_SANITIZER_REQUIRED',
  'AI_GATEWAY_COST_DENIED',
  'AI_GATEWAY_OUTPUT_SCHEMA_INVALID',
  'AI_GATEWAY_OPERATION_CONFLICT',
  'AI_GATEWAY_PROVIDER_UNAVAILABLE',
  'AI_GATEWAY_PROVIDER_TIMEOUT',
  'AI_GATEWAY_PROVIDER_FAILED',
  'AI_GATEWAY_OPERATION_FAILED',
] as const;

export type AIGatewayErrorCode = (typeof AI_GATEWAY_ERROR_CODES)[number];

const GATEWAY_SAFE_MESSAGES: Readonly<Record<AIGatewayErrorCode, string>> = Object.freeze({
  AI_GATEWAY_ACCESS_DENIED: 'AI Gateway operation is not permitted',
  AI_GATEWAY_INVALID_INPUT: 'AI Gateway input is invalid',
  AI_GATEWAY_CONFIGURATION_INVALID: 'AI Gateway configuration is invalid',
  AI_GATEWAY_TASK_NOT_FOUND: 'AI task is not registered',
  AI_GATEWAY_MODEL_NOT_AVAILABLE: 'No eligible AI model is available',
  AI_GATEWAY_TRUST_DENIED: 'AI processing is denied by Trust Policy',
  AI_GATEWAY_CONFIRMATION_REQUIRED: 'AI processing requires verified confirmation',
  AI_GATEWAY_SANITIZER_REQUIRED: 'AI processing requires a registered sanitizer',
  AI_GATEWAY_COST_DENIED: 'AI processing is denied by Cost Guard',
  AI_GATEWAY_OUTPUT_SCHEMA_INVALID: 'AI structured output does not match its registered schema',
  AI_GATEWAY_OPERATION_CONFLICT: 'AI operation identity conflicts with an earlier request',
  AI_GATEWAY_PROVIDER_UNAVAILABLE: 'AI provider is unavailable',
  AI_GATEWAY_PROVIDER_TIMEOUT: 'AI provider timed out',
  AI_GATEWAY_PROVIDER_FAILED: 'AI provider operation failed',
  AI_GATEWAY_OPERATION_FAILED: 'AI Gateway operation could not be completed',
});

export class AIGatewayError extends Error {
  readonly code: AIGatewayErrorCode;

  constructor(code: AIGatewayErrorCode) {
    super(GATEWAY_SAFE_MESSAGES[code]);
    this.name = 'AIGatewayError';
    this.code = code;
  }
}
