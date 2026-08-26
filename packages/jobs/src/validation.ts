import type { TrustedOrganizationContext } from '@green-hive/core';
import { JobError } from './errors.js';
import type { EnqueueJobInput, ValidatedEnqueueJobInput } from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const JOB_TYPE = /^[A-Z][A-Z0-9_]{2,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const INPUT_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const ENQUEUE_KEYS = new Set([
  'projectId', 'jobType', 'idempotencyKey', 'inputHash', 'inputReference', 'priority',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new JobError('JOB_INVALID_INPUT');
}

function onlyKeys(value: unknown, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.has(key))) invalid();
  return value;
}

export function validateTrustedJobContext(value: unknown): TrustedOrganizationContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new JobError('JOB_ACCESS_DENIED');
  }
  if (
    typeof value.userId !== 'string' || !UUID.test(value.userId)
    || typeof value.appCode !== 'string' || !APP_CODE.test(value.appCode)
    || typeof value.organizationId !== 'string' || !UUID.test(value.organizationId)
    || (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN')
  ) {
    throw new JobError('JOB_ACCESS_DENIED');
  }
  return value as unknown as TrustedOrganizationContext;
}

export function validateJobId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value;
}

export function validateJobProjectId(value: unknown): string {
  return validateJobId(value);
}

export function validateEnqueueJobInput(input: EnqueueJobInput): ValidatedEnqueueJobInput {
  const value = onlyKeys(input, ENQUEUE_KEYS);
  if (typeof value.jobType !== 'string' || !JOB_TYPE.test(value.jobType)) invalid();
  if (typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(value.idempotencyKey)) {
    invalid();
  }
  if (typeof value.inputHash !== 'string' || !SHA256.test(value.inputHash)) invalid();
  if (
    value.inputReference !== undefined
    && (typeof value.inputReference !== 'string' || !INPUT_REFERENCE.test(value.inputReference))
  ) {
    invalid();
  }
  const priority = value.priority === undefined ? 50 : value.priority;
  if (!Number.isInteger(priority) || (priority as number) < 0 || (priority as number) > 100) {
    invalid();
  }
  return {
    projectId: validateJobProjectId(value.projectId),
    jobType: value.jobType,
    idempotencyKey: value.idempotencyKey,
    inputHash: value.inputHash,
    inputReference: (value.inputReference as string | undefined) ?? null,
    priority: priority as number,
  };
}
