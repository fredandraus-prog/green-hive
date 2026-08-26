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
