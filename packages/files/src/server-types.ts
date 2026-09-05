import type { TrustedOrganizationContext } from '@green-hive/core';
import type { FileRecord, FileSensitivity, FileStatus } from './types.js';

/** Server-owned configuration. Never construct this from browser input. */
export interface FileServiceConfiguration {
  readonly requiredCapability: string;
  readonly sensitivity: FileSensitivity;
  readonly storageProvider: string;
  readonly storageBucket: string;
  readonly maxBytes: number;
  readonly allowedMediaTypes: readonly string[];
  /** Fixed server-owned lifetime for download grants; callers cannot select it. */
  readonly downloadTtlSeconds: number;
}

export interface ValidatedStoreGeneratedFileInput {
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly originalFilename: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
}

/** Internal metadata. It must never be returned as FileRecord or serialized to a browser. */
export interface InternalFileRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly originalFilename: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sensitivity: FileSensitivity;
  readonly status: FileStatus;
  readonly requiredCapability: string;
  readonly storageProvider: string;
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly contentSha256: string;
  readonly idempotencyKeySha256: string;
  readonly requestFingerprintSha256: string;
  readonly objectVersion: string | null;
  readonly createdAt: Date;
  readonly readyAt: Date | null;
  readonly deletedAt: Date | null;
  readonly updatedAt: Date;
}

export interface PrepareGeneratedFileInput {
  readonly projectId: string;
  readonly idempotencyKeySha256: string;
  readonly requestFingerprintSha256: string;
  readonly originalFilename: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sensitivity: FileSensitivity;
  readonly contentSha256: string;
  readonly requiredCapability: string;
  readonly storageProvider: string;
  readonly storageBucket: string;
}

export interface FileRepository {
  prepare(
    context: TrustedOrganizationContext,
    input: PrepareGeneratedFileInput,
  ): Promise<InternalFileRecord>;
  complete(
    context: TrustedOrganizationContext,
    fileId: string,
    objectVersion: string,
  ): Promise<InternalFileRecord>;
  abort(context: TrustedOrganizationContext, fileId: string): Promise<void>;
  list(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly InternalFileRecord[]>;
  find(
    context: TrustedOrganizationContext,
    projectId: string,
    fileId: string,
  ): Promise<InternalFileRecord | null>;
  softDelete(
    context: TrustedOrganizationContext,
    fileId: string,
  ): Promise<boolean>;
  recordExport(
    context: TrustedOrganizationContext,
    projectId: string,
    fileId: string,
  ): Promise<void>;
}

export interface FileCapabilityAuthorizer {
  can(
    context: TrustedOrganizationContext,
    projectId: string,
    capabilityCode: string,
  ): Promise<boolean>;
}

export interface PrivateStorageLocator {
  readonly storageProvider: string;
  readonly storageBucket: string;
  readonly storageKey: string;
}

export interface PutPrivateFileInput extends PrivateStorageLocator {
  readonly mediaType: string;
  readonly byteSize: number;
  readonly contentSha256: string;
  readonly content: Uint8Array;
}

export interface HeadPrivateFileInput extends PrivateStorageLocator {}

export interface DeletePrivateFileInput extends PrivateStorageLocator {
  readonly objectVersion: string;
}

export interface CreateSignedPrivateDownloadInput extends PrivateStorageLocator {
  readonly objectVersion: string;
  readonly downloadFilename: string;
  readonly expiresInSeconds: number;
}

/** Storage-provider response. This stays server-only until FileService returns its bounded grant. */
export interface PrivateSignedDownload {
  readonly url: string;
}

export interface PrivateStoredObject extends PrivateStorageLocator {
  readonly objectVersion: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly contentSha256: string;
}

/** Server-side provider. It deliberately has no permanent public-URL operation. */
export interface PrivateStorageProvider {
  readonly providerCode: string;
  putPrivate(input: PutPrivateFileInput): Promise<PrivateStoredObject>;
  headPrivate(input: HeadPrivateFileInput): Promise<PrivateStoredObject | null>;
  deletePrivate(input: DeletePrivateFileInput): Promise<void>;
  createSignedDownload(input: CreateSignedPrivateDownloadInput): Promise<PrivateSignedDownload>;
}

export interface FileSqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface FileSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<FileSqlResult<Row>>;
}

export interface FileServiceDependencies {
  readonly repository: FileRepository;
  readonly storage: PrivateStorageProvider;
  readonly entitlements: FileCapabilityAuthorizer;
}

export type SafeFileProjection = FileRecord;
