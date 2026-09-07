/**
 * GH-0802 keeps operational telemetry deliberately small. These records are
 * for service diagnosis, not product analytics: no URLs, identities, tenant
 * identifiers, request bodies, cookies, tokens, prompts or provider payloads
 * are accepted by this contract.
 */
export const OBSERVABILITY_OUTCOMES = ['SUCCEEDED', 'DENIED', 'FAILED'] as const;
export type ObservabilityOutcome = (typeof OBSERVABILITY_OUTCOMES)[number];

export interface StructuredOperationalEvent {
  readonly event: 'HTTP_REQUEST';
  readonly component: 'REFERENCE_APP_HTTP';
  readonly operation: string;
  readonly outcome: ObservabilityOutcome;
  readonly requestId: string;
  readonly correlationId: string;
  readonly durationMs: number;
  readonly statusCode: number;
  readonly errorCode?: string;
  readonly providerCode?: string;
}

export interface StructuredOperationalEventInput {
  readonly operation: string;
  readonly outcome: ObservabilityOutcome;
  readonly requestId: string;
  readonly correlationId: string;
  readonly durationMs: number;
  readonly statusCode: number;
  readonly errorCode?: string;
  readonly providerCode?: string;
}

export interface ObservabilitySink {
  write(event: StructuredOperationalEvent): void;
}

export class ObservabilityValidationError extends Error {
  readonly code = 'INVALID_OBSERVABILITY_EVENT' as const;

  constructor() {
    super('The structured operational event is invalid');
    this.name = 'ObservabilityValidationError';
  }
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function code(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!CODE_PATTERN.test(value)) throw new ObservabilityValidationError();
  return value;
}

function uuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new ObservabilityValidationError();
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ObservabilityValidationError();
  }
  return value;
}

/** Creates one redaction-safe, JSON-serializable HTTP operational event. */
export function structuredHttpEvent(
  input: StructuredOperationalEventInput,
): StructuredOperationalEvent {
  if (!OBSERVABILITY_OUTCOMES.includes(input.outcome)) throw new ObservabilityValidationError();
  const errorCode = code(input.errorCode);
  const providerCode = code(input.providerCode);
  const event: StructuredOperationalEvent = {
    event: 'HTTP_REQUEST',
    component: 'REFERENCE_APP_HTTP',
    operation: code(input.operation)!,
    outcome: input.outcome,
    requestId: uuid(input.requestId),
    correlationId: uuid(input.correlationId),
    durationMs: boundedInteger(input.durationMs, 0, 86_400_000),
    statusCode: boundedInteger(input.statusCode, 100, 599),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(providerCode === undefined ? {} : { providerCode }),
  };
  return Object.freeze(event);
}

/** Logging must never change the response path, even if a downstream sink is unavailable. */
export function writeOperationalEvent(
  sink: ObservabilitySink | undefined,
  event: StructuredOperationalEvent,
): void {
  try {
    sink?.write(event);
  } catch {
    // Observability is fail-open by design; application availability wins.
  }
}

export const OBSERVABILITY_STATUS = 'STRUCTURED_SAFE_HTTP_FOUNDATION' as const;
