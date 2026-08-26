import { JobError } from './errors.js';
import type {
  CompleteJobInput,
  FailJobInput,
  WorkerFailureKind,
  WorkerIdentity,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEASE_TOKEN = /^[0-9a-f-]{36}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const OUTPUT_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/;
const IDENTITY_KEYS = new Set(['workerId']);
const COMPLETE_KEYS = new Set(['jobId', 'leaseToken', 'outputHash', 'outputReference']);
const FAIL_KEYS = new Set(['jobId', 'leaseToken', 'failureKind', 'safeErrorCode']);

function invalid(): never {
  throw new JobError('WORKER_INVALID_INPUT');
}

function record(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const parsed = value as Record<string, unknown>;
  if (Object.keys(parsed).some((key) => !keys.has(key))) invalid();
  return parsed;
}

export function validateWorkerIdentity(value: unknown): WorkerIdentity {
  const parsed = record(value, IDENTITY_KEYS);
  if (typeof parsed.workerId !== 'string' || !WORKER_ID.test(parsed.workerId)) invalid();
  return { workerId: parsed.workerId };
}

export function validateLeaseSeconds(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 15 || (value as number) > 3600) invalid();
  return value as number;
}

export function validateBatchLimit(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1000) invalid();
  return value as number;
}

export function validateWorkerJobId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value;
}

export function validateLeaseToken(value: unknown): string {
  if (typeof value !== 'string' || !LEASE_TOKEN.test(value)) invalid();
  return value;
}

export function validateCompleteJobInput(value: unknown): CompleteJobInput {
  const parsed = record(value, COMPLETE_KEYS);
  const outputHash = parsed.outputHash;
  const outputReference = parsed.outputReference;
  if (outputHash !== undefined && (typeof outputHash !== 'string' || !SHA256.test(outputHash))) invalid();
  if (outputReference !== undefined
    && (typeof outputReference !== 'string' || !OUTPUT_REFERENCE.test(outputReference))) invalid();
  return {
    jobId: validateWorkerJobId(parsed.jobId),
    leaseToken: validateLeaseToken(parsed.leaseToken),
    ...(outputHash === undefined ? {} : { outputHash }),
    ...(outputReference === undefined ? {} : { outputReference }),
  };
}

export function validateFailJobInput(value: unknown): FailJobInput {
  const parsed = record(value, FAIL_KEYS);
  if (parsed.failureKind !== 'TRANSIENT' && parsed.failureKind !== 'PERMANENT') invalid();
  if (typeof parsed.safeErrorCode !== 'string' || !SAFE_ERROR_CODE.test(parsed.safeErrorCode)) invalid();
  return {
    jobId: validateWorkerJobId(parsed.jobId),
    leaseToken: validateLeaseToken(parsed.leaseToken),
    failureKind: parsed.failureKind as WorkerFailureKind,
    safeErrorCode: parsed.safeErrorCode,
  };
}
