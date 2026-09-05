import { createHash } from 'node:crypto';
import { FileError } from './errors.js';
import type {
  DeletePrivateFileInput,
  HeadPrivateFileInput,
  PrivateStorageProvider,
  PrivateStoredObject,
  PutPrivateFileInput,
} from './server-types.js';

export const FAKE_FILE_STORAGE_FAILURE_MODES = [
  'NONE',
  'PUT_FAILED',
  'HEAD_FAILED',
  'DELETE_FAILED',
] as const;
export type FakeFileStorageFailureMode =
  (typeof FAKE_FILE_STORAGE_FAILURE_MODES)[number];

export interface FakeFileStorageOptions {
  readonly providerCode?: string;
  readonly failureMode?: FakeFileStorageFailureMode;
}

interface FakeObject {
  readonly metadata: PrivateStoredObject;
  readonly content: Uint8Array;
}

const OPTION_KEYS = new Set(['providerCode', 'failureMode']);
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const BUCKET = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const STORAGE_KEY = /^ghf\/[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectIdentity(bucket: string, key: string): string {
  return `${bucket}\u0000${key}`;
}

function safeLocator(input: HeadPrivateFileInput): void {
  if (
    typeof input.storageProvider !== 'string'
    || typeof input.storageBucket !== 'string'
    || typeof input.storageKey !== 'string'
    || !BUCKET.test(input.storageBucket)
    || !STORAGE_KEY.test(input.storageKey)
  ) {
    throw new FileError('FILE_STORAGE_FAILED');
  }
}

function copyMetadata(value: PrivateStoredObject): PrivateStoredObject {
  return Object.freeze({ ...value });
}

export class FakeFileStorage implements PrivateStorageProvider {
  static readonly providerCode = 'GREEN_HIVE_FAKE_STORAGE';
  readonly providerCode: string;

  readonly #failureMode: FakeFileStorageFailureMode;
  readonly #objects = new Map<string, FakeObject>();

  constructor(options: FakeFileStorageOptions = {}) {
    if (!isRecord(options) || Object.keys(options).some((key) => !OPTION_KEYS.has(key))) {
      throw new FileError('FILE_CONFIGURATION_INVALID');
    }
    const providerCode = options.providerCode ?? FakeFileStorage.providerCode;
    const failureMode = options.failureMode ?? 'NONE';
    if (
      typeof providerCode !== 'string'
      || !PROVIDER_CODE.test(providerCode)
      || typeof failureMode !== 'string'
      || !FAKE_FILE_STORAGE_FAILURE_MODES.includes(failureMode as FakeFileStorageFailureMode)
    ) {
      throw new FileError('FILE_CONFIGURATION_INVALID');
    }
    this.providerCode = providerCode;
    this.#failureMode = failureMode as FakeFileStorageFailureMode;
  }

  async putPrivate(input: PutPrivateFileInput): Promise<PrivateStoredObject> {
    safeLocator(input);
    if (this.#failureMode === 'PUT_FAILED') throw new FileError('FILE_STORAGE_FAILED');
    if (
      input.storageProvider !== this.providerCode
      || !(input.content instanceof Uint8Array)
      || !Number.isSafeInteger(input.byteSize)
      || input.byteSize !== input.content.byteLength
      || typeof input.mediaType !== 'string'
      || !SHA256.test(input.contentSha256)
    ) {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    const content = new Uint8Array(input.content);
    const observedHash = createHash('sha256').update(content).digest('hex');
    if (observedHash !== input.contentSha256) throw new FileError('FILE_STORAGE_CONFLICT');

    const identity = objectIdentity(input.storageBucket, input.storageKey);
    const existing = this.#objects.get(identity);
    if (existing) {
      if (
        existing.metadata.contentSha256 !== input.contentSha256
        || existing.metadata.byteSize !== input.byteSize
        || existing.metadata.mediaType !== input.mediaType
      ) {
        throw new FileError('FILE_STORAGE_CONFLICT');
      }
      return copyMetadata(existing.metadata);
    }

    const objectVersion = createHash('sha256')
      .update(`${this.providerCode}\u0000${input.storageBucket}\u0000${input.storageKey}\u0000${input.contentSha256}`)
      .digest('hex');
    const metadata = Object.freeze({
      storageProvider: this.providerCode,
      storageBucket: input.storageBucket,
      storageKey: input.storageKey,
      objectVersion,
      mediaType: input.mediaType,
      byteSize: input.byteSize,
      contentSha256: input.contentSha256,
    });
    this.#objects.set(identity, { metadata, content });
    return copyMetadata(metadata);
  }

  async headPrivate(input: HeadPrivateFileInput): Promise<PrivateStoredObject | null> {
    safeLocator(input);
    if (this.#failureMode === 'HEAD_FAILED') throw new FileError('FILE_STORAGE_FAILED');
    if (input.storageProvider !== this.providerCode) throw new FileError('FILE_STORAGE_FAILED');
    const stored = this.#objects.get(objectIdentity(input.storageBucket, input.storageKey));
    return stored ? copyMetadata(stored.metadata) : null;
  }

  async deletePrivate(input: DeletePrivateFileInput): Promise<void> {
    safeLocator(input);
    if (this.#failureMode === 'DELETE_FAILED') throw new FileError('FILE_STORAGE_FAILED');
    if (input.storageProvider !== this.providerCode || typeof input.objectVersion !== 'string') {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    const identity = objectIdentity(input.storageBucket, input.storageKey);
    const stored = this.#objects.get(identity);
    if (!stored) return;
    if (stored.metadata.objectVersion !== input.objectVersion) {
      throw new FileError('FILE_STORAGE_CONFLICT');
    }
    this.#objects.delete(identity);
  }

  /** Test-only defensive snapshot of the injected fake; no production service should expose it. */
  inspectForTesting(input: HeadPrivateFileInput):
    | { readonly metadata: PrivateStoredObject; readonly content: Uint8Array }
    | null {
    safeLocator(input);
    const stored = this.#objects.get(objectIdentity(input.storageBucket, input.storageKey));
    return stored
      ? Object.freeze({
          metadata: copyMetadata(stored.metadata),
          content: new Uint8Array(stored.content),
        })
      : null;
  }

  get objectCount(): number {
    return this.#objects.size;
  }
}
