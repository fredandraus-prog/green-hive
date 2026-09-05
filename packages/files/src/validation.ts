import type { TrustedOrganizationContext } from '@green-hive/core';
import { FileError } from './errors.js';
import type {
  FileServiceConfiguration,
  ValidatedStoreGeneratedFileInput,
} from './server-types.js';
import {
  FILE_SENSITIVITIES,
  FILE_ABSOLUTE_MAX_BYTES,
  type StoreGeneratedFileInput,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const CAPABILITY_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const BUCKET = /^[a-z0-9][a-z0-9._-]{2,62}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const STORE_KEYS = new Set([
  'projectId', 'idempotencyKey', 'originalFilename', 'mediaType', 'content',
]);
const CONFIG_KEYS = new Set([
  'requiredCapability', 'sensitivity', 'storageProvider', 'storageBucket', 'maxBytes',
  'allowedMediaTypes',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  errorCode: 'FILE_INVALID_INPUT' | 'FILE_CONFIGURATION_INVALID',
): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new FileError(errorCode);
  }
  return value;
}

export function validateTrustedFileContext(value: unknown): TrustedOrganizationContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new FileError('FILE_ACCESS_DENIED');
  }
  if (
    typeof value.userId !== 'string' || !UUID.test(value.userId)
    || typeof value.appCode !== 'string' || !APP_CODE.test(value.appCode)
    || typeof value.organizationId !== 'string' || !UUID.test(value.organizationId)
    || (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN')
  ) {
    throw new FileError('FILE_ACCESS_DENIED');
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

export function validateFileId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new FileError('FILE_INVALID_INPUT');
  }
  return value.toLowerCase();
}

export function validateFileProjectId(value: unknown): string {
  return validateFileId(value);
}

export function validateStoreGeneratedFileInput(
  input: StoreGeneratedFileInput,
): ValidatedStoreGeneratedFileInput {
  const value = onlyKeys(input, STORE_KEYS, 'FILE_INVALID_INPUT');
  const projectId = validateFileProjectId(value.projectId);
  if (typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(value.idempotencyKey)) {
    throw new FileError('FILE_INVALID_INPUT');
  }
  if (typeof value.originalFilename !== 'string') throw new FileError('FILE_INVALID_INPUT');
  const originalFilename = value.originalFilename.trim().normalize('NFC');
  if (
    originalFilename.length < 1
    || originalFilename.length > 180
    || originalFilename === '.'
    || originalFilename === '..'
    || originalFilename.endsWith('.')
    || originalFilename.endsWith(' ')
    || originalFilename.includes('/')
    || originalFilename.includes('\\')
    || CONTROL_OR_BIDI.test(originalFilename)
  ) {
    throw new FileError('FILE_INVALID_INPUT');
  }
  if (typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType)) {
    throw new FileError('FILE_INVALID_INPUT');
  }
  if (!(value.content instanceof Uint8Array)) throw new FileError('FILE_INVALID_INPUT');
  if (value.content.byteLength < 1 || value.content.byteLength > FILE_ABSOLUTE_MAX_BYTES) {
    throw new FileError('FILE_INVALID_INPUT');
  }
  return {
    projectId,
    idempotencyKey: value.idempotencyKey,
    originalFilename,
    mediaType: value.mediaType,
    content: new Uint8Array(value.content),
  };
}

export function validateFileServiceConfiguration(value: unknown): FileServiceConfiguration {
  const config = onlyKeys(value, CONFIG_KEYS, 'FILE_CONFIGURATION_INVALID');
  if (
    typeof config.requiredCapability !== 'string'
    || !CAPABILITY_CODE.test(config.requiredCapability)
    || typeof config.sensitivity !== 'string'
    || !FILE_SENSITIVITIES.includes(
      config.sensitivity as (typeof FILE_SENSITIVITIES)[number],
    )
    || typeof config.storageProvider !== 'string'
    || !PROVIDER_CODE.test(config.storageProvider)
    || typeof config.storageBucket !== 'string'
    || !BUCKET.test(config.storageBucket)
    || !Number.isSafeInteger(config.maxBytes)
    || (config.maxBytes as number) < 1
    || (config.maxBytes as number) > FILE_ABSOLUTE_MAX_BYTES
    || !Array.isArray(config.allowedMediaTypes)
    || config.allowedMediaTypes.length < 1
    || config.allowedMediaTypes.some(
      (candidate) => typeof candidate !== 'string' || !MEDIA_TYPE.test(candidate),
    )
    || new Set(config.allowedMediaTypes).size !== config.allowedMediaTypes.length
  ) {
    throw new FileError('FILE_CONFIGURATION_INVALID');
  }
  return Object.freeze({
    requiredCapability: config.requiredCapability,
    sensitivity: config.sensitivity,
    storageProvider: config.storageProvider,
    storageBucket: config.storageBucket,
    maxBytes: config.maxBytes,
    allowedMediaTypes: Object.freeze([...(config.allowedMediaTypes as string[])]),
  }) as FileServiceConfiguration;
}
