import type { TrustedOrganizationContext } from '@green-hive/core';
import { ProjectError } from './errors.js';
import type { JsonValue, ValidatedCreateProjectInput } from './types.js';

const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const CREATE_KEYS = new Set(['name', 'metadata']);
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_METADATA_DEPTH = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen: Set<object>, depth: number): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > MAX_METADATA_DEPTH || seen.has(value)) return false;

  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen, depth + 1))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((entry) => isJsonValue(entry, seen, depth + 1));
  seen.delete(value);
  return valid;
}

export function validateTrustedProjectContext(value: unknown): TrustedOrganizationContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new ProjectError('PROJECT_ACCESS_DENIED');
  }
  if (typeof value.userId !== 'string' || !UUID.test(value.userId)) {
    throw new ProjectError('PROJECT_ACCESS_DENIED');
  }
  if (typeof value.appCode !== 'string' || !APP_CODE.test(value.appCode)) {
    throw new ProjectError('PROJECT_ACCESS_DENIED');
  }
  if (typeof value.organizationId !== 'string' || !UUID.test(value.organizationId)) {
    throw new ProjectError('PROJECT_ACCESS_DENIED');
  }
  if (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN') {
    throw new ProjectError('PROJECT_ACCESS_DENIED');
  }
  return value.platformRole === undefined
    ? {
        userId: value.userId.toLowerCase(),
        appCode: value.appCode,
        organizationId: value.organizationId.toLowerCase(),
      }
    : {
        userId: value.userId.toLowerCase(),
        appCode: value.appCode,
        organizationId: value.organizationId.toLowerCase(),
        platformRole: value.platformRole,
      };
}

export function validateCreateProjectInput(value: unknown): ValidatedCreateProjectInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !CREATE_KEYS.has(key))) {
    throw new ProjectError('INVALID_PROJECT_INPUT');
  }
  if (typeof value.name !== 'string') throw new ProjectError('INVALID_PROJECT_INPUT');
  const name = value.name.trim();
  if (name.length < 1 || name.length > 160) throw new ProjectError('INVALID_PROJECT_INPUT');

  const metadata = value.metadata ?? {};
  if (!isRecord(metadata) || !isJsonValue(metadata, new Set(), 0)) {
    throw new ProjectError('INVALID_PROJECT_INPUT');
  }
  const serialized = JSON.stringify(metadata);
  if (new TextEncoder().encode(serialized).byteLength > MAX_METADATA_BYTES) {
    throw new ProjectError('INVALID_PROJECT_INPUT');
  }

  return {
    name,
    metadata: JSON.parse(serialized) as Readonly<Record<string, JsonValue>>,
  };
}

export function validateProjectId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new ProjectError('INVALID_PROJECT_INPUT');
  }
  return value.toLowerCase();
}
