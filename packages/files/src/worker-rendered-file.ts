import { createHash } from 'node:crypto';
import { FileError } from './errors.js';
import type {
  FileSqlExecutor,
  PrivateStorageProvider,
  PrivateStoredObject,
} from './server-types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEASE_TOKEN = /^[0-9a-f-]{36}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const STORAGE_KEY = /^ghf\/[0-9a-f]{64}$/;
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const BUCKET = /^[a-z0-9][a-z0-9._-]{2,62}$/;
const OBJECT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/** Server-only authority copied from a claimed job. Never derive this from a client request. */
export interface WorkerFileLease {
  readonly jobId: string;
  readonly workerId: string;
  readonly leaseToken: string;
}

export interface StoreWorkerRenderedFileInput {
  readonly originalFilename: string;
  readonly mediaType: 'text/plain' | 'application/pdf';
  readonly content: Uint8Array;
  readonly storageBucket: string;
}

export interface WorkerRenderedFile {
  readonly id: string;
  readonly storageKey: string;
  readonly objectVersion: string;
  readonly contentSha256: string;
}

interface PreparedWorkerRenderedFile extends Omit<WorkerRenderedFile, 'objectVersion'> {
  readonly status: 'PROCESSING' | 'READY';
  readonly objectVersion: string | null;
  readonly originalFilename: string;
  readonly mediaType: 'text/plain' | 'application/pdf';
  readonly byteSize: number;
  readonly storageProvider: string;
  readonly storageBucket: string;
}

interface PreparedWorkerRenderedFileRow extends Record<string, unknown> {
  readonly file_id: string;
  readonly storage_key: string;
  readonly status: string;
  readonly object_version: string | null;
}

export interface WorkerRenderedFileRepository {
  prepare(
    lease: WorkerFileLease,
    input: Omit<StoreWorkerRenderedFileInput, 'content'> & { readonly byteSize: number; readonly contentSha256: string; readonly storageProvider: string },
  ): Promise<PreparedWorkerRenderedFile>;
  complete(lease: WorkerFileLease, fileId: string, objectVersion: string): Promise<void>;
  abort(lease: WorkerFileLease, fileId: string): Promise<void>;
}

function invalid(): never {
  throw new FileError('FILE_CONFIGURATION_INVALID');
}

function validateLease(value: WorkerFileLease): WorkerFileLease {
  if (
    !value
    || Object.keys(value).length !== 3
    || Object.keys(value).some((key) => key !== 'jobId' && key !== 'workerId' && key !== 'leaseToken')
    || !UUID.test(value.jobId)
    || !WORKER_ID.test(value.workerId)
    || !LEASE_TOKEN.test(value.leaseToken)
  ) invalid();
  return Object.freeze({ ...value });
}

function validateInput(value: StoreWorkerRenderedFileInput): StoreWorkerRenderedFileInput {
  if (
    !value
    || typeof value.originalFilename !== 'string'
    || value.originalFilename.length < 1
    || value.originalFilename.length > 180
    || value.originalFilename !== value.originalFilename.trim()
    || CONTROL.test(value.originalFilename)
    || /[\\/]/.test(value.originalFilename)
    || (value.mediaType !== 'text/plain' && value.mediaType !== 'application/pdf')
    || !(value.content instanceof Uint8Array)
    || value.content.byteLength < 1
    || value.content.byteLength > 10 * 1024 * 1024
    || typeof value.storageBucket !== 'string'
    || !BUCKET.test(value.storageBucket)
  ) {
    throw new FileError('FILE_INVALID_INPUT');
  }
  return Object.freeze({
    originalFilename: value.originalFilename,
    mediaType: value.mediaType,
    content: new Uint8Array(value.content),
    storageBucket: value.storageBucket,
  });
}

function mapPrepared(row: PreparedWorkerRenderedFileRow, expected: {
  readonly originalFilename: string;
  readonly mediaType: 'text/plain' | 'application/pdf';
  readonly byteSize: number;
  readonly contentSha256: string;
  readonly storageProvider: string;
  readonly storageBucket: string;
}): PreparedWorkerRenderedFile {
  if (
    !UUID.test(row.file_id)
    || !STORAGE_KEY.test(row.storage_key)
    || (row.status !== 'PROCESSING' && row.status !== 'READY')
    || (row.object_version !== null && (typeof row.object_version !== 'string' || !OBJECT_VERSION.test(row.object_version)))
    || (row.status === 'READY' && row.object_version === null)
  ) {
    throw new FileError('FILE_OPERATION_FAILED');
  }
  return Object.freeze({
    id: row.file_id,
    storageKey: row.storage_key,
    status: row.status,
    objectVersion: row.object_version,
    originalFilename: expected.originalFilename,
    mediaType: expected.mediaType,
    byteSize: expected.byteSize,
    contentSha256: expected.contentSha256,
    storageProvider: expected.storageProvider,
    storageBucket: expected.storageBucket,
  });
}

function databaseError(error: unknown): FileError {
  if (error instanceof FileError) return error;
  return new FileError('FILE_OPERATION_FAILED');
}

/** Database adapter used only by a service-role worker session. */
export class PostgresWorkerRenderedFileRepository implements WorkerRenderedFileRepository {
  readonly #database: FileSqlExecutor;

  constructor(database: FileSqlExecutor) {
    if (!database || typeof database.query !== 'function') invalid();
    this.#database = database;
  }

  async prepare(
    lease: WorkerFileLease,
    input: Omit<StoreWorkerRenderedFileInput, 'content'> & { readonly byteSize: number; readonly contentSha256: string; readonly storageProvider: string },
  ): Promise<PreparedWorkerRenderedFile> {
    const safeLease = validateLease(lease);
    if (
      !Number.isSafeInteger(input.byteSize)
      || input.byteSize < 1
      || input.byteSize > 10 * 1024 * 1024
      || !SHA256.test(input.contentSha256)
      || !PROVIDER_CODE.test(input.storageProvider)
    ) invalid();
    try {
      const result = await this.#database.query<PreparedWorkerRenderedFileRow>(
        `SELECT * FROM hive.prepare_worker_rendered_file(
          $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::bigint,
          $7::text, $8::text, $9::text
        )`,
        [
          safeLease.jobId, safeLease.workerId, safeLease.leaseToken,
          input.originalFilename, input.mediaType, input.byteSize, input.contentSha256,
          input.storageProvider, input.storageBucket,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new FileError('FILE_OPERATION_FAILED');
      return mapPrepared(row, input);
    } catch (error) {
      throw databaseError(error);
    }
  }

  async complete(lease: WorkerFileLease, fileId: string, objectVersion: string): Promise<void> {
    const safeLease = validateLease(lease);
    if (!UUID.test(fileId) || !OBJECT_VERSION.test(objectVersion)) invalid();
    try {
      const result = await this.#database.query<{ completed: boolean }>(
        `SELECT hive.complete_worker_rendered_file($1::uuid, $2::text, $3::text, $4::uuid, $5::text)
           AS completed`,
        [safeLease.jobId, safeLease.workerId, safeLease.leaseToken, fileId, objectVersion],
      );
      if (result.rows[0]?.completed !== true) throw new FileError('FILE_OPERATION_FAILED');
    } catch (error) {
      throw databaseError(error);
    }
  }

  async abort(lease: WorkerFileLease, fileId: string): Promise<void> {
    const safeLease = validateLease(lease);
    if (!UUID.test(fileId)) invalid();
    try {
      await this.#database.query(
        'SELECT hive.abort_worker_rendered_file($1::uuid, $2::text, $3::text, $4::uuid)',
        [safeLease.jobId, safeLease.workerId, safeLease.leaseToken, fileId],
      );
    } catch (error) {
      throw databaseError(error);
    }
  }
}

/**
 * Handles one already-claimed render job. It has no browser entrypoint and never accepts tenant scope.
 * The database derives all tenant, project and owner fields from the verified worker lease.
 */
export class WorkerRenderedFileService {
  readonly #repository: WorkerRenderedFileRepository;
  readonly #storage: PrivateStorageProvider;

  constructor(repository: WorkerRenderedFileRepository, storage: PrivateStorageProvider) {
    if (
      !repository
      || typeof repository.prepare !== 'function'
      || typeof repository.complete !== 'function'
      || typeof repository.abort !== 'function'
      || !storage
      || typeof storage.providerCode !== 'string'
      || !PROVIDER_CODE.test(storage.providerCode)
      || typeof storage.putPrivate !== 'function'
      || typeof storage.deletePrivate !== 'function'
    ) invalid();
    this.#repository = repository;
    this.#storage = storage;
  }

  async store(lease: WorkerFileLease, value: StoreWorkerRenderedFileInput): Promise<WorkerRenderedFile> {
    const safeLease = validateLease(lease);
    const input = validateInput(value);
    const contentSha256 = createHash('sha256').update(input.content).digest('hex');
    const prepared = await this.#repository.prepare(safeLease, {
      originalFilename: input.originalFilename,
      mediaType: input.mediaType,
      byteSize: input.content.byteLength,
      contentSha256,
      storageProvider: this.#storage.providerCode,
      storageBucket: input.storageBucket,
    });
    this.#assertPrepared(prepared, input, contentSha256);
    if (prepared.status === 'READY') {
      return Object.freeze({
        id: prepared.id,
        storageKey: prepared.storageKey,
        objectVersion: prepared.objectVersion as string,
        contentSha256,
      });
    }

    let stored: PrivateStoredObject | null = null;
    try {
      stored = await this.#storage.putPrivate({
        storageProvider: prepared.storageProvider,
        storageBucket: prepared.storageBucket,
        storageKey: prepared.storageKey,
        mediaType: prepared.mediaType,
        byteSize: prepared.byteSize,
        contentSha256: prepared.contentSha256,
        content: input.content,
      });
      this.#assertStored(prepared, stored);
    } catch (error) {
      if (stored) await this.#deleteThenAbort(safeLease, prepared, stored);
      else await this.#abort(safeLease, prepared.id);
      throw this.#storageError(error);
    }

    try {
      await this.#repository.complete(safeLease, prepared.id, stored.objectVersion);
    } catch (error) {
      await this.#deleteThenAbort(safeLease, prepared, stored);
      throw databaseError(error);
    }
    return Object.freeze({
      id: prepared.id,
      storageKey: prepared.storageKey,
      objectVersion: stored.objectVersion,
      contentSha256,
    });
  }

  #assertPrepared(
    prepared: PreparedWorkerRenderedFile,
    input: StoreWorkerRenderedFileInput,
    contentSha256: string,
  ): void {
    if (
      prepared.originalFilename !== input.originalFilename
      || prepared.mediaType !== input.mediaType
      || prepared.byteSize !== input.content.byteLength
      || prepared.contentSha256 !== contentSha256
      || prepared.storageProvider !== this.#storage.providerCode
      || prepared.storageBucket !== input.storageBucket
    ) throw new FileError('FILE_STORAGE_CONFLICT');
  }

  #assertStored(prepared: PreparedWorkerRenderedFile, stored: PrivateStoredObject): void {
    if (
      stored.storageProvider !== prepared.storageProvider
      || stored.storageBucket !== prepared.storageBucket
      || stored.storageKey !== prepared.storageKey
      || stored.mediaType !== prepared.mediaType
      || stored.byteSize !== prepared.byteSize
      || stored.contentSha256 !== prepared.contentSha256
      || !OBJECT_VERSION.test(stored.objectVersion)
    ) throw new FileError('FILE_STORAGE_CONFLICT');
  }

  async #abort(lease: WorkerFileLease, fileId: string): Promise<void> {
    await this.#repository.abort(lease, fileId).catch(() => undefined);
  }

  async #deleteThenAbort(
    lease: WorkerFileLease,
    prepared: PreparedWorkerRenderedFile,
    stored: PrivateStoredObject,
  ): Promise<void> {
    try {
      await this.#storage.deletePrivate({
        storageProvider: prepared.storageProvider,
        storageBucket: prepared.storageBucket,
        storageKey: prepared.storageKey,
        objectVersion: stored.objectVersion,
      });
    } catch {
      return;
    }
    await this.#abort(lease, prepared.id);
  }

  #storageError(error: unknown): FileError {
    if (error instanceof FileError && (error.code === 'FILE_STORAGE_CONFLICT' || error.code === 'FILE_STORAGE_FAILED')) {
      return error;
    }
    return new FileError('FILE_STORAGE_FAILED');
  }
}
