import type { TrustedOrganizationContext } from '@green-hive/core';
import { UsageCostError } from './errors.js';
import {
  ACCOUNTING_EVENT_KINDS,
  USAGE_BUDGET_TYPES,
  USAGE_MEASUREMENT_KINDS,
  type AccountingEventKind,
  type ConfigureUsageBudgetInput,
  type RecordCostEventInput,
  type RecordUsageEventInput,
  type UsageBudgetType,
  type UsageCostMetadata,
  type UsageMeasurementKind,
  type ValidatedConfigureUsageBudgetInput,
  type ValidatedRecordCostEventInput,
  type ValidatedRecordUsageEventInput,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,127}$/;
const UNIT_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const EXACT_DECIMAL = /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,8})?$/;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const BUDGET_KEYS = new Set([
  'projectId', 'budgetType', 'measurementKind', 'unitCode', 'ceilingAmount',
  'cycleId', 'periodStart', 'periodEnd', 'idempotencyKey', 'metadata',
]);
const USAGE_KEYS = new Set([
  'projectId', 'budgetId', 'operationId', 'idempotencyKey', 'eventKind', 'usageCode',
  'quantity', 'unitCode', 'capabilityCode', 'cycleId', 'providerCode', 'serviceCode',
  'occurredAt', 'metadata',
]);
const COST_KEYS = new Set([
  'projectId', 'budgetId', 'operationId', 'idempotencyKey', 'eventKind', 'amount',
  'currency', 'providerCode', 'serviceCode', 'modelCode', 'cycleId', 'occurredAt',
  'metadata',
]);
const CONFIDENTIAL_METADATA_KEYS = new Set([
  'authorization', 'content', 'cookie', 'document', 'password', 'payload', 'prompt',
  'secret', 'signature', 'token',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new UsageCostError('USAGE_COST_INVALID_INPUT');
}

function onlyKeys(value: unknown, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.has(key))) invalid();
  return value;
}

function validateUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value.toLowerCase();
}

function validateOptionalUuid(value: unknown): string | null {
  return value === undefined ? null : validateUuid(value);
}

function validateCode(value: unknown, expression: RegExp): string {
  if (typeof value !== 'string' || !expression.test(value)) invalid();
  return value;
}

function validateOptionalCode(value: unknown, expression: RegExp): string | null {
  return value === undefined ? null : validateCode(value, expression);
}

function validateReference(value: unknown, maximum = 128): string {
  if (typeof value !== 'string' || value.length > maximum || !REFERENCE.test(value)) invalid();
  return value;
}

function validateOptionalReference(value: unknown, maximum = 128): string | null {
  return value === undefined ? null : validateReference(value, maximum);
}

function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) invalid();
  return value;
}

function validatePositiveDecimal(value: unknown): string {
  if (typeof value !== 'string' || !EXACT_DECIMAL.test(value)) invalid();
  const [whole = '0', fraction = ''] = value.split('.');
  if (!/[1-9]/.test(`${whole}${fraction}`)) invalid();
  const normalizedWhole = whole.replace(/^0+(?=[0-9])/, '');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction.length > 0 ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function validateOptionalDate(value: unknown): Date | null {
  if (value === undefined) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalid();
  return new Date(value.getTime());
}

function validateMetadata(value: unknown): UsageCostMetadata {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value)) invalid();
  const output: Record<string, boolean | number | string | null> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)
      || CONFIDENTIAL_METADATA_KEYS.has(key.toLowerCase())
      || !(
        nested === null
        || typeof nested === 'boolean'
        || (typeof nested === 'number' && Number.isFinite(nested))
        || (typeof nested === 'string' && nested.length <= 240)
      )
    ) invalid();
    output[key] = nested as boolean | number | string | null;
  }
  if (new TextEncoder().encode(JSON.stringify(output)).length > 2048) invalid();
  return Object.freeze(output);
}

function validateEventKind(value: unknown): AccountingEventKind {
  if (!ACCOUNTING_EVENT_KINDS.includes(value as AccountingEventKind)) invalid();
  return value as AccountingEventKind;
}

export function validateTrustedUsageCostContext(value: unknown): TrustedOrganizationContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new UsageCostError('USAGE_COST_ACCESS_DENIED');
  }
  if (
    typeof value.userId !== 'string'
    || !UUID.test(value.userId)
    || typeof value.appCode !== 'string'
    || !APP_CODE.test(value.appCode)
    || typeof value.organizationId !== 'string'
    || !UUID.test(value.organizationId)
    || (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN')
  ) {
    throw new UsageCostError('USAGE_COST_ACCESS_DENIED');
  }
  return {
    userId: value.userId.toLowerCase(),
    appCode: value.appCode,
    organizationId: value.organizationId.toLowerCase(),
    ...(value.platformRole === undefined ? {} : { platformRole: value.platformRole }),
  };
}

export function validateUsageCostProjectId(value: unknown): string {
  return validateUuid(value);
}

export function validateConfigureUsageBudgetInput(
  input: ConfigureUsageBudgetInput,
): ValidatedConfigureUsageBudgetInput {
  const value = onlyKeys(input, BUDGET_KEYS);
  if (!USAGE_BUDGET_TYPES.includes(value.budgetType as UsageBudgetType)) invalid();
  if (!USAGE_MEASUREMENT_KINDS.includes(value.measurementKind as UsageMeasurementKind)) invalid();
  const measurementKind = value.measurementKind as UsageMeasurementKind;
  const unitCode = validateCode(value.unitCode, UNIT_CODE);
  if (measurementKind === 'COST' && !/^[A-Z]{3}$/.test(unitCode)) invalid();
  const periodStart = validateOptionalDate(value.periodStart);
  const periodEnd = validateOptionalDate(value.periodEnd);
  if ((periodStart === null) !== (periodEnd === null)) invalid();
  if (periodStart && periodEnd && periodEnd.getTime() <= periodStart.getTime()) invalid();
  return {
    projectId: validateUuid(value.projectId),
    budgetType: value.budgetType as UsageBudgetType,
    measurementKind,
    unitCode,
    ceilingAmount: validatePositiveDecimal(value.ceilingAmount),
    cycleId: validateOptionalReference(value.cycleId),
    periodStart,
    periodEnd,
    idempotencyKey: validateIdempotencyKey(value.idempotencyKey),
    metadata: validateMetadata(value.metadata),
  };
}

export function validateRecordUsageEventInput(
  input: RecordUsageEventInput,
): ValidatedRecordUsageEventInput {
  const value = onlyKeys(input, USAGE_KEYS);
  return {
    projectId: validateUuid(value.projectId),
    budgetId: validateOptionalUuid(value.budgetId),
    operationId: validateReference(value.operationId, 200),
    idempotencyKey: validateIdempotencyKey(value.idempotencyKey),
    eventKind: validateEventKind(value.eventKind),
    usageCode: validateCode(value.usageCode, CODE),
    quantity: validatePositiveDecimal(value.quantity),
    unitCode: validateCode(value.unitCode, UNIT_CODE),
    capabilityCode: validateOptionalCode(value.capabilityCode, CODE),
    cycleId: validateOptionalReference(value.cycleId),
    providerCode: validateOptionalCode(value.providerCode, PROVIDER_CODE),
    serviceCode: validateOptionalCode(value.serviceCode, PROVIDER_CODE),
    occurredAt: validateOptionalDate(value.occurredAt),
    metadata: validateMetadata(value.metadata),
  };
}

export function validateRecordCostEventInput(
  input: RecordCostEventInput,
): ValidatedRecordCostEventInput {
  const value = onlyKeys(input, COST_KEYS);
  return {
    projectId: validateUuid(value.projectId),
    budgetId: validateOptionalUuid(value.budgetId),
    operationId: validateReference(value.operationId, 200),
    idempotencyKey: validateIdempotencyKey(value.idempotencyKey),
    eventKind: validateEventKind(value.eventKind),
    amount: validatePositiveDecimal(value.amount),
    currency: validateCode(value.currency, /^[A-Z]{3}$/),
    providerCode: validateCode(value.providerCode, PROVIDER_CODE),
    serviceCode: validateCode(value.serviceCode, PROVIDER_CODE),
    modelCode: validateOptionalReference(value.modelCode),
    cycleId: validateOptionalReference(value.cycleId),
    occurredAt: validateOptionalDate(value.occurredAt),
    metadata: validateMetadata(value.metadata),
  };
}

