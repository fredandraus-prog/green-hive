export type AIJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly AIJsonValue[]
  | { readonly [key: string]: AIJsonValue };

export const AI_OUTPUT_MODES = ['TEXT', 'STRUCTURED'] as const;
export type AIOutputMode = (typeof AI_OUTPUT_MODES)[number];

export const AI_FINISH_REASONS = ['STOP', 'LENGTH'] as const;
export type AIFinishReason = (typeof AI_FINISH_REASONS)[number];

export interface AIProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AIProviderRequestBase {
  /** App-owned, idempotency-safe identity. It must never contain prompt content. */
  readonly operationId: string;
  /** Stable app-prefixed task code registered by the application. */
  readonly taskType: string;
  /** Vendor-neutral routing class. A provider-specific model is not accepted from app code. */
  readonly modelClass: string;
  /** Task-specific input only; whole projects or databases must not be supplied by default. */
  readonly input: string;
  readonly maxOutputTokens: number;
}

export interface AITextGenerationRequest extends AIProviderRequestBase {}

export interface AIStructuredGenerationRequest extends AIProviderRequestBase {
  /** App-owned schema identity. Runtime schema validation belongs to the later AI Gateway slice. */
  readonly outputSchemaId: string;
}

export interface AITextGenerationResult {
  readonly outputMode: 'TEXT';
  readonly providerCode: string;
  readonly modelCode: string;
  readonly content: string;
  readonly finishReason: AIFinishReason;
  readonly usage: AIProviderUsage;
}

export interface AIStructuredGenerationResult {
  readonly outputMode: 'STRUCTURED';
  readonly providerCode: string;
  readonly modelCode: string;
  readonly value: AIJsonValue;
  readonly finishReason: AIFinishReason;
  readonly usage: AIProviderUsage;
}

export interface AIProvider {
  readonly providerCode: string;
  generateText(request: AITextGenerationRequest): Promise<AITextGenerationResult>;
  generateStructured(
    request: AIStructuredGenerationRequest,
  ): Promise<AIStructuredGenerationResult>;
}

export const FAKE_AI_FAILURE_MODES = [
  'NONE',
  'UNAVAILABLE',
  'TIMEOUT',
  'FAILED',
] as const;
export type FakeAIFailureMode = (typeof FAKE_AI_FAILURE_MODES)[number];

export interface FakeAIProviderOptions {
  readonly textOutput?: string;
  readonly structuredOutput?: AIJsonValue;
  readonly modelCode?: string;
  readonly failureMode?: FakeAIFailureMode;
}

export interface OpenAIResponsesHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: {
    get(name: string): string | null;
  };
  readonly body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type OpenAIResponsesFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<OpenAIResponsesHttpResponse>;

export interface OpenAITextTaskProfile {
  readonly taskType: string;
  readonly modelClass: string;
  readonly outputMode: 'TEXT';
  /** Server-owned instructions. They are never accepted from a generation request. */
  readonly instructions: string;
}

export interface OpenAIStructuredTaskProfile {
  readonly taskType: string;
  readonly modelClass: string;
  readonly outputMode: 'STRUCTURED';
  /** Server-owned schema identity; callers may only reference this exact registered value. */
  readonly outputSchemaId: string;
  readonly schemaName: string;
  readonly instructions: string;
  readonly jsonSchema: AIJsonValue;
}

export type OpenAITaskProfile =
  | OpenAITextTaskProfile
  | OpenAIStructuredTaskProfile;

export interface OpenAIResponsesProviderOptions {
  /** Server-side secret. It is retained only in a private class field. */
  readonly apiKey: string;
  /** Injectable transport used by deterministic tests and controlled runtimes. */
  readonly fetch?: OpenAIResponsesFetch;
  /** Hard request deadline. It cannot be disabled. */
  readonly timeoutMs?: number;
  /** Exact allowlist of server-owned task and schema profiles. */
  readonly taskProfiles: readonly OpenAITaskProfile[];
}
