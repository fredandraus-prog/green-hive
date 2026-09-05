import { createHash } from 'node:crypto';
import { FileError } from './errors.js';
import type {
  CreateSignedPrivateDownloadInput,
  DeletePrivateFileInput,
  HeadPrivateFileInput,
  PrivateSignedDownload,
  PrivateStorageProvider,
  PrivateStoredObject,
  PutPrivateFileInput,
} from './server-types.js';

interface SupabaseStorageErrorLike {
  readonly message?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
}

interface SupabaseStorageResult<Data> {
  readonly data: Data | null;
  readonly error: SupabaseStorageErrorLike | null;
}

interface SupabaseUploadData {
  readonly id?: unknown;
  readonly path?: unknown;
  readonly fullPath?: unknown;
}

interface SupabaseInfoData {
  readonly id?: unknown;
  readonly version?: unknown;
  readonly etag?: unknown;
  readonly size?: unknown;
  readonly contentType?: unknown;
  readonly content_type?: unknown;
  readonly metadata?: unknown;
}

interface SupabaseSignedUrlData {
  readonly signedUrl?: unknown;
}

export interface SupabasePrivateBucketClient {
  upload(
    path: string,
    content: Uint8Array,
    options: {
      readonly cacheControl: string;
      readonly contentType: string;
      readonly upsert: false;
      readonly metadata: Readonly<Record<string, string>>;
    },
  ): Promise<SupabaseStorageResult<SupabaseUploadData>>;
  info(path: string): Promise<SupabaseStorageResult<SupabaseInfoData>>;
  createSignedUrl(
    path: string,
    expiresIn: number,
    options: { readonly download: string },
  ): Promise<SupabaseStorageResult<SupabaseSignedUrlData>>;
  remove(paths: readonly string[]): Promise<SupabaseStorageResult<unknown>>;
}

/** Minimal injected server client. The service-role credential remains owned by its composition. */
export interface SupabasePrivateStorageClient {
  readonly storage: {
    from(bucket: string): SupabasePrivateBucketClient;
  };
}

export interface SupabasePrivateStorageOptions {
  readonly providerCode: string;
  readonly privateBuckets: readonly string[];
}

const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const BUCKET = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const SHA256 = /^[0-9a-f]{64}$/;
const OBJECT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const STORAGE_KEY = /^ghf\/[0-9a-f]{64}$/;
const OPTION_KEYS = new Set(['providerCode', 'privateBuckets']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorStatus(error: SupabaseStorageErrorLike | null): number | null {
  if (!error) return null;
  const value = error.status ?? error.statusCode;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  return null;
}

function notFound(error: SupabaseStorageErrorLike | null): boolean {
  const status = errorStatus(error);
  return status === 400 || status === 404;
}

function customHash(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const value = metadata.greenHiveContentSha256;
  return typeof value === 'string' && SHA256.test(value) ? value : null;
}

function mediaType(data: SupabaseInfoData): string | null {
  const value = data.contentType ?? data.content_type;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function objectVersion(data: SupabaseInfoData): string | null {
  for (const candidate of [data.version, data.id, data.etag]) {
    if (typeof candidate === 'string' && OBJECT_VERSION.test(candidate)) return candidate;
  }
  return null;
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

export class SupabasePrivateStorageProvider implements PrivateStorageProvider {
  readonly providerCode: string;
  readonly #client: SupabasePrivateStorageClient;
  readonly #privateBuckets: ReadonlySet<string>;

  constructor(
    client: SupabasePrivateStorageClient,
    options: SupabasePrivateStorageOptions,
  ) {
    if (
      !client?.storage
      || typeof client.storage.from !== 'function'
      || !isRecord(options)
      || Object.keys(options).some((key) => !OPTION_KEYS.has(key))
      || typeof options.providerCode !== 'string'
      || !PROVIDER_CODE.test(options.providerCode)
      || !Array.isArray(options.privateBuckets)
      || options.privateBuckets.length < 1
      || options.privateBuckets.some((bucket) => typeof bucket !== 'string' || !BUCKET.test(bucket))
      || new Set(options.privateBuckets).size !== options.privateBuckets.length
    ) {
      throw new FileError('FILE_CONFIGURATION_INVALID');
    }
    this.providerCode = options.providerCode;
    this.#privateBuckets = new Set(options.privateBuckets);
    this.#client = client;
  }

  async putPrivate(input: PutPrivateFileInput): Promise<PrivateStoredObject> {
    this.#assertAllowed(input);
    if (
      !(input.content instanceof Uint8Array)
      || !Number.isSafeInteger(input.byteSize)
      || input.byteSize !== input.content.byteLength
      || !SHA256.test(input.contentSha256)
      || createHash('sha256').update(input.content).digest('hex') !== input.contentSha256
    ) {
      throw new FileError('FILE_STORAGE_CONFLICT');
    }

    const existing = await this.headPrivate(input);
    if (existing) return this.#reconcile(existing, input);

    const bucket = this.#bucket(input.storageBucket);
    let uploaded: SupabaseStorageResult<SupabaseUploadData>;
    try {
      uploaded = await bucket.upload(input.storageKey, new Uint8Array(input.content), {
        cacheControl: '0',
        contentType: input.mediaType,
        upsert: false,
        metadata: Object.freeze({ greenHiveContentSha256: input.contentSha256 }),
      });
    } catch {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    if (uploaded.error || !uploaded.data) {
      const raced = await this.headPrivate(input).catch(() => null);
      if (raced) return this.#reconcile(raced, input);
      throw new FileError('FILE_STORAGE_FAILED');
    }
    const stored = await this.headPrivate(input);
    if (!stored) throw new FileError('FILE_STORAGE_FAILED');
    return this.#reconcile(stored, input);
  }

  async headPrivate(input: HeadPrivateFileInput): Promise<PrivateStoredObject | null> {
    this.#assertAllowed(input);
    let result: SupabaseStorageResult<SupabaseInfoData>;
    try {
      result = await this.#bucket(input.storageBucket).info(input.storageKey);
    } catch {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    if (result.error) {
      if (notFound(result.error)) return null;
      throw new FileError('FILE_STORAGE_FAILED');
    }
    if (!result.data) return null;
    const version = objectVersion(result.data);
    const size = result.data.size;
    const type = mediaType(result.data);
    const hash = customHash(result.data.metadata);
    if (
      !version
      || typeof size !== 'number'
      || !Number.isSafeInteger(size)
      || size < 1
      || !type
      || !hash
    ) {
      throw new FileError('FILE_STORAGE_CONFLICT');
    }
    return Object.freeze({
      storageProvider: this.providerCode,
      storageBucket: input.storageBucket,
      storageKey: input.storageKey,
      objectVersion: version,
      mediaType: type,
      byteSize: size,
      contentSha256: hash,
    });
  }

  async deletePrivate(input: DeletePrivateFileInput): Promise<void> {
    this.#assertAllowed(input);
    if (typeof input.objectVersion !== 'string' || !OBJECT_VERSION.test(input.objectVersion)) {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    const existing = await this.headPrivate(input);
    if (!existing) return;
    if (existing.objectVersion !== input.objectVersion) {
      throw new FileError('FILE_STORAGE_CONFLICT');
    }
    let result: SupabaseStorageResult<unknown>;
    try {
      result = await this.#bucket(input.storageBucket).remove([input.storageKey]);
    } catch {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    if (result.error && !notFound(result.error)) throw new FileError('FILE_STORAGE_FAILED');
  }

  async createSignedDownload(
    input: CreateSignedPrivateDownloadInput,
  ): Promise<PrivateSignedDownload> {
    this.#assertAllowed(input);
    if (
      typeof input.objectVersion !== 'string'
      || !OBJECT_VERSION.test(input.objectVersion)
      || typeof input.downloadFilename !== 'string'
      || input.downloadFilename.length < 1
      || !Number.isSafeInteger(input.expiresInSeconds)
      || input.expiresInSeconds < 60
      || input.expiresInSeconds > 300
    ) {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    const existing = await this.headPrivate(input);
    if (!existing || existing.objectVersion !== input.objectVersion) {
      throw new FileError('FILE_STORAGE_CONFLICT');
    }
    let result: SupabaseStorageResult<SupabaseSignedUrlData>;
    try {
      result = await this.#bucket(input.storageBucket).createSignedUrl(
        input.storageKey,
        input.expiresInSeconds,
        { download: input.downloadFilename },
      );
    } catch {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    if (result.error || !result.data || typeof result.data.signedUrl !== 'string') {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    const url = this.#safeSignedUrl(result.data.signedUrl);
    return Object.freeze({ url });
  }

  #reconcile(
    stored: PrivateStoredObject,
    expected: PutPrivateFileInput,
  ): PrivateStoredObject {
    if (
      stored.storageProvider !== expected.storageProvider
      || stored.storageBucket !== expected.storageBucket
      || stored.storageKey !== expected.storageKey
      || stored.mediaType !== expected.mediaType
      || stored.byteSize !== expected.byteSize
      || stored.contentSha256 !== expected.contentSha256
    ) {
      throw new FileError('FILE_STORAGE_CONFLICT');
    }
    return stored;
  }

  #assertAllowed(input: HeadPrivateFileInput): void {
    safeLocator(input);
    if (
      input.storageProvider !== this.providerCode
      || !this.#privateBuckets.has(input.storageBucket)
    ) {
      throw new FileError('FILE_STORAGE_FAILED');
    }
  }

  #bucket(bucket: string): SupabasePrivateBucketClient {
    try {
      return this.#client.storage.from(bucket);
    } catch {
      throw new FileError('FILE_STORAGE_FAILED');
    }
  }

  #safeSignedUrl(value: string): string {
    try {
      const parsed = new URL(value);
      const localHttp = parsed.protocol === 'http:'
        && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
      if (
        (parsed.protocol !== 'https:' && !localHttp)
        || parsed.username
        || parsed.password
        || !parsed.pathname
      ) {
        throw new Error('unsafe URL');
      }
      return parsed.toString();
    } catch {
      throw new FileError('FILE_STORAGE_FAILED');
    }
  }
}
