import type { TrustedOrganizationContext } from '@green-hive/core';
import { FileError, type FileErrorCode } from './errors.js';
import type {
  FileRepository,
  FileSqlExecutor,
  InternalFileRecord,
  PrepareGeneratedFileInput,
} from './server-types.js';
import {
  FILE_SENSITIVITIES,
  FILE_STATUSES,
  type FileSensitivity,
  type FileStatus,
} from './types.js';

interface AuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly app_id: string | null;
  readonly organization_id: string | null;
  readonly trusted: boolean;
  readonly is_platform_admin: boolean;
}

interface FileRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly original_filename: string;
  readonly media_type: string;
  readonly byte_size: number | string;
  readonly sensitivity: FileSensitivity;
  readonly status: FileStatus;
  readonly required_capability: string;
  readonly storage_provider: string;
  readonly storage_bucket: string;
  readonly storage_key: string;
  readonly content_sha256: string;
  readonly idempotency_key_sha256: string;
  readonly request_fingerprint_sha256: string;
  readonly object_version: string | null;
  readonly created_at: Date | string;
  readonly ready_at: Date | string | null;
  readonly deleted_at: Date | string | null;
  readonly updated_at: Date | string;
}

const FILE_COLUMNS = `
  id, organization_id, app_id, project_id, owner_user_id, original_filename,
  media_type, byte_size, sensitivity, status, required_capability, storage_provider,
  storage_bucket, storage_key, content_sha256, idempotency_key_sha256,
  request_fingerprint_sha256, object_version, created_at, ready_at, deleted_at, updated_at`;

const DATABASE_CODES = new Set<FileErrorCode>([
  'FILE_ACCESS_DENIED',
  'FILE_INVALID_INPUT',
  'FILE_NOT_FOUND',
  'FILE_ENTITLEMENT_REQUIRED',
  'FILE_IDEMPOTENCY_CONFLICT',
  'FILE_INVALID_TRANSITION',
]);

function asDate(value: Date | string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new FileError('FILE_OPERATION_FAILED');
  return parsed;
}

function asOptionalDate(value: Date | string | null): Date | null {
  return value === null ? null : asDate(value);
}

function asByteSize(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new FileError('FILE_OPERATION_FAILED');
  return parsed;
}

function mapFile(row: FileRow): InternalFileRecord {
  if (
    !FILE_STATUSES.includes(row.status)
    || !FILE_SENSITIVITIES.includes(row.sensitivity)
  ) {
    throw new FileError('FILE_OPERATION_FAILED');
  }
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    originalFilename: row.original_filename,
    mediaType: row.media_type,
    byteSize: asByteSize(row.byte_size),
    sensitivity: row.sensitivity,
    status: row.status,
    requiredCapability: row.required_capability,
    storageProvider: row.storage_provider,
    storageBucket: row.storage_bucket,
    storageKey: row.storage_key,
    contentSha256: row.content_sha256,
    idempotencyKeySha256: row.idempotency_key_sha256,
    requestFingerprintSha256: row.request_fingerprint_sha256,
    objectVersion: row.object_version,
    createdAt: asDate(row.created_at),
    readyAt: asOptionalDate(row.ready_at),
    deletedAt: asOptionalDate(row.deleted_at),
    updatedAt: asDate(row.updated_at),
  });
}

function databaseError(error: unknown): FileError {
  if (error instanceof FileError) return error;
  const message = error instanceof Error ? error.message : '';
  const code = [...DATABASE_CODES].find((candidate) => message.includes(candidate));
  return new FileError(code ?? 'FILE_OPERATION_FAILED');
}

export class PostgresFileRepository implements FileRepository {
  readonly #database: FileSqlExecutor;

  constructor(database: FileSqlExecutor) {
    this.#database = database;
  }

  async prepare(
    context: TrustedOrganizationContext,
    input: PrepareGeneratedFileInput,
  ): Promise<InternalFileRecord> {
    await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<FileRow>(
        `SELECT ${FILE_COLUMNS}
         FROM hive.prepare_generated_file(
           $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::bigint,
           $7::text, $8::text, $9::text, $10::text, $11::text
         )`,
        [
          input.projectId,
          input.idempotencyKeySha256,
          input.requestFingerprintSha256,
          input.originalFilename,
          input.mediaType,
          input.byteSize,
          input.sensitivity,
          input.contentSha256,
          input.requiredCapability,
          input.storageProvider,
          input.storageBucket,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new FileError('FILE_OPERATION_FAILED');
      return mapFile(row);
    } catch (error) {
      throw databaseError(error);
    }
  }

  async complete(
    context: TrustedOrganizationContext,
    fileId: string,
    objectVersion: string,
  ): Promise<InternalFileRecord> {
    await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<FileRow>(
        `SELECT ${FILE_COLUMNS}
         FROM hive.complete_generated_file($1::uuid, $2::text)`,
        [fileId, objectVersion],
      );
      const row = result.rows[0];
      if (!row) throw new FileError('FILE_OPERATION_FAILED');
      return mapFile(row);
    } catch (error) {
      throw databaseError(error);
    }
  }

  async abort(context: TrustedOrganizationContext, fileId: string): Promise<void> {
    await this.#assertAuthority(context);
    try {
      await this.#database.query('SELECT hive.abort_generated_file($1::uuid)', [fileId]);
    } catch (error) {
      throw databaseError(error);
    }
  }

  async list(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly InternalFileRecord[]> {
    const authority = await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<FileRow>(
        `SELECT ${FILE_COLUMNS}
         FROM hive.files
         WHERE project_id = $1::uuid
           AND organization_id = $2::uuid
           AND app_id = $3::uuid
           AND owner_user_id = $4::uuid
           AND status = 'READY'
         ORDER BY created_at, id`,
        [projectId, authority.organization_id, authority.app_id, context.userId],
      );
      return Object.freeze(result.rows.map(mapFile));
    } catch (error) {
      throw databaseError(error);
    }
  }

  async find(
    context: TrustedOrganizationContext,
    projectId: string,
    fileId: string,
  ): Promise<InternalFileRecord | null> {
    const authority = await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<FileRow>(
        `SELECT ${FILE_COLUMNS}
         FROM hive.files
         WHERE id = $1::uuid
           AND project_id = $2::uuid
           AND organization_id = $3::uuid
           AND app_id = $4::uuid
           AND owner_user_id = $5::uuid`,
        [fileId, projectId, authority.organization_id, authority.app_id, context.userId],
      );
      return result.rows[0] ? mapFile(result.rows[0]) : null;
    } catch (error) {
      throw databaseError(error);
    }
  }

  async softDelete(context: TrustedOrganizationContext, fileId: string): Promise<boolean> {
    await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<{ deleted: boolean }>(
        'SELECT hive.soft_delete_file($1::uuid) AS deleted',
        [fileId],
      );
      return result.rows[0]?.deleted === true;
    } catch (error) {
      throw databaseError(error);
    }
  }

  async #assertAuthority(context: TrustedOrganizationContext): Promise<AuthorityRow> {
    try {
      const result = await this.#database.query<AuthorityRow>(
        `SELECT
           auth.uid()::text AS user_id,
           hive.current_app_code() AS app_code,
           hive.current_app_id()::text AS app_id,
           hive.current_organization_id()::text AS organization_id,
           hive.has_trusted_organization_context() AS trusted,
           hive.is_platform_admin() AS is_platform_admin`,
      );
      const authority = result.rows[0];
      if (
        !authority?.trusted
        || authority.is_platform_admin
        || !authority.app_id
        || !authority.organization_id
        || authority.user_id !== context.userId
        || authority.app_code !== context.appCode
        || authority.organization_id !== context.organizationId
      ) {
        throw new FileError('FILE_ACCESS_DENIED');
      }
      return authority;
    } catch (error) {
      throw databaseError(error);
    }
  }
}
