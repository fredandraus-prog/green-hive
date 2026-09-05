import { createHash } from 'node:crypto';
import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { FileError } from './errors.js';
import type {
  DeletePrivateFileInput,
  FileServiceConfiguration,
  FileServiceDependencies,
  InternalFileRecord,
  PrepareGeneratedFileInput,
  PrivateSignedDownload,
  PrivateStoredObject,
} from './server-types.js';
import type { FileDownloadGrant, FileRecord, StoreGeneratedFileInput } from './types.js';
import {
  validateFileId,
  validateFileProjectId,
  validateFileServiceConfiguration,
  validateStoreGeneratedFileInput,
  validateTrustedFileContext,
} from './validation.js';

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requestFingerprint(
  context: TrustedOrganizationContext,
  input: PrepareGeneratedFileInput,
): string {
  return sha256(JSON.stringify({
    organizationId: context.organizationId,
    appCode: context.appCode,
    ownerUserId: context.userId,
    ...input,
    requestFingerprintSha256: undefined,
  }));
}

function safeProjection(file: InternalFileRecord): FileRecord {
  if (file.status !== 'READY' || file.readyAt === null) {
    throw new FileError('FILE_INVALID_TRANSITION');
  }
  return Object.freeze({
    id: file.id,
    projectId: file.projectId,
    originalFilename: file.originalFilename,
    mediaType: file.mediaType,
    byteSize: file.byteSize,
    sensitivity: file.sensitivity,
    status: 'READY' as const,
    createdAt: new Date(file.createdAt.getTime()),
    readyAt: new Date(file.readyAt.getTime()),
  });
}

function assertDependencies(value: FileServiceDependencies): void {
  if (
    !value
    || typeof value !== 'object'
    || typeof value.repository?.prepare !== 'function'
    || typeof value.repository.complete !== 'function'
    || typeof value.repository.abort !== 'function'
    || typeof value.repository.list !== 'function'
    || typeof value.repository.find !== 'function'
    || typeof value.repository.softDelete !== 'function'
    || typeof value.repository.recordExport !== 'function'
    || typeof value.storage?.putPrivate !== 'function'
    || typeof value.storage.headPrivate !== 'function'
    || typeof value.storage.deletePrivate !== 'function'
    || typeof value.storage.createSignedDownload !== 'function'
    || typeof value.storage.providerCode !== 'string'
    || typeof value.entitlements?.can !== 'function'
  ) {
    throw new FileError('FILE_CONFIGURATION_INVALID');
  }
}

export class FileService {
  readonly #configuration: FileServiceConfiguration;
  readonly #dependencies: FileServiceDependencies;

  constructor(configuration: FileServiceConfiguration, dependencies: FileServiceDependencies) {
    this.#configuration = validateFileServiceConfiguration(configuration);
    assertDependencies(dependencies);
    if (dependencies.storage.providerCode !== this.#configuration.storageProvider) {
      throw new FileError('FILE_CONFIGURATION_INVALID');
    }
    this.#dependencies = dependencies;
  }

  async storeGenerated(
    context: TrustedAppContext,
    generatedInput: StoreGeneratedFileInput,
  ): Promise<FileRecord> {
    const trustedContext = this.#ownerContext(context);
    const input = validateStoreGeneratedFileInput(generatedInput);
    if (
      input.content.byteLength > this.#configuration.maxBytes
      || !this.#configuration.allowedMediaTypes.includes(input.mediaType)
    ) {
      throw new FileError('FILE_INVALID_INPUT');
    }
    if (!this.#configuration.requiredCapability.startsWith(`${trustedContext.appCode}_`)) {
      throw new FileError('FILE_CONFIGURATION_INVALID');
    }
    const entitled = await this.#repositoryOperation(() =>
      this.#dependencies.entitlements.can(
        trustedContext,
        input.projectId,
        this.#configuration.requiredCapability,
      ),
    );
    if (!entitled) throw new FileError('FILE_ENTITLEMENT_REQUIRED');

    const idempotencyKeySha256 = sha256(input.idempotencyKey);
    const contentSha256 = sha256(input.content);
    const draft: PrepareGeneratedFileInput = {
      projectId: input.projectId,
      idempotencyKeySha256,
      requestFingerprintSha256: '',
      originalFilename: input.originalFilename,
      mediaType: input.mediaType,
      byteSize: input.content.byteLength,
      sensitivity: this.#configuration.sensitivity,
      contentSha256,
      requiredCapability: this.#configuration.requiredCapability,
      storageProvider: this.#configuration.storageProvider,
      storageBucket: this.#configuration.storageBucket,
    };
    const prepareInput: PrepareGeneratedFileInput = {
      ...draft,
      requestFingerprintSha256: requestFingerprint(trustedContext, draft),
    };
    const prepared = await this.#repositoryOperation(() =>
      this.#dependencies.repository.prepare(trustedContext, prepareInput),
    );
    this.#assertPreparedRecord(trustedContext, prepared, prepareInput);
    if (prepared.status === 'READY') return safeProjection(prepared);
    if (prepared.status !== 'PROCESSING') throw new FileError('FILE_IDEMPOTENCY_CONFLICT');

    let stored: PrivateStoredObject | null = null;
    try {
      stored = await this.#storageOperation(() => this.#dependencies.storage.putPrivate({
        storageProvider: prepared.storageProvider,
        storageBucket: prepared.storageBucket,
        storageKey: prepared.storageKey,
        mediaType: prepared.mediaType,
        byteSize: prepared.byteSize,
        contentSha256: prepared.contentSha256,
        content: new Uint8Array(input.content),
      }));
      this.#assertStoredObject(prepared, stored);
    } catch (error) {
      if (stored) {
        await this.#compensateUnverifiedStorage(trustedContext, prepared, stored);
      } else {
        await this.#abortBestEffort(trustedContext, prepared.id);
      }
      throw error;
    }

    try {
      const completed = await this.#repositoryOperation(() =>
        this.#dependencies.repository.complete(
          trustedContext,
          prepared.id,
          stored.objectVersion,
        ),
      );
      this.#assertPreparedRecord(trustedContext, completed, prepareInput);
      if (completed.status !== 'READY' || completed.objectVersion !== stored.objectVersion) {
        throw new FileError('FILE_OPERATION_FAILED');
      }
      return safeProjection(completed);
    } catch (error) {
      await this.#compensateCompletedStorage(trustedContext, prepared.id, stored);
      throw error;
    }
  }

  async list(context: TrustedAppContext, projectId: string): Promise<readonly FileRecord[]> {
    const trustedContext = this.#ownerContext(context);
    const validatedProjectId = validateFileProjectId(projectId);
    const files = await this.#repositoryOperation(() =>
      this.#dependencies.repository.list(trustedContext, validatedProjectId),
    );
    return Object.freeze(files
      .filter((file) => file.status === 'READY')
      .map((file) => safeProjection(file)));
  }

  async get(
    context: TrustedAppContext,
    projectId: string,
    fileId: string,
  ): Promise<FileRecord> {
    const trustedContext = this.#ownerContext(context);
    const file = await this.#repositoryOperation(() => this.#dependencies.repository.find(
      trustedContext,
      validateFileProjectId(projectId),
      validateFileId(fileId),
    ));
    if (!file || file.status !== 'READY') throw new FileError('FILE_NOT_FOUND');
    return safeProjection(file);
  }

  async softDelete(
    context: TrustedAppContext,
    projectId: string,
    fileId: string,
  ): Promise<void> {
    const trustedContext = this.#ownerContext(context);
    const validatedProjectId = validateFileProjectId(projectId);
    const validatedFileId = validateFileId(fileId);
    const file = await this.#repositoryOperation(() => this.#dependencies.repository.find(
      trustedContext,
      validatedProjectId,
      validatedFileId,
    ));
    if (!file) throw new FileError('FILE_NOT_FOUND');
    if (file.status === 'DELETED') return;
    if (file.status !== 'READY' || file.objectVersion === null) {
      throw new FileError('FILE_INVALID_TRANSITION');
    }
    this.#assertConfiguredStorage(file);

    await this.#storageOperation(() => this.#dependencies.storage.deletePrivate({
      storageProvider: file.storageProvider,
      storageBucket: file.storageBucket,
      storageKey: file.storageKey,
      objectVersion: file.objectVersion as string,
    }));
    const deleted = await this.#repositoryOperation(() =>
      this.#dependencies.repository.softDelete(trustedContext, file.id),
    );
    if (!deleted) {
      throw new FileError('FILE_OPERATION_FAILED');
    }
  }

  async createDownload(
    context: TrustedAppContext,
    projectId: string,
    fileId: string,
  ): Promise<FileDownloadGrant> {
    const trustedContext = this.#ownerContext(context);
    const validatedProjectId = validateFileProjectId(projectId);
    const validatedFileId = validateFileId(fileId);
    const file = await this.#repositoryOperation(() => this.#dependencies.repository.find(
      trustedContext,
      validatedProjectId,
      validatedFileId,
    ));
    if (!file || file.status !== 'READY' || file.objectVersion === null) {
      throw new FileError('FILE_NOT_FOUND');
    }
    const objectVersion = file.objectVersion;
    this.#assertConfiguredStorage(file);
    const issuedAt = new Date();
    const signed = await this.#storageOperation(() => this.#dependencies.storage.createSignedDownload({
      storageProvider: file.storageProvider,
      storageBucket: file.storageBucket,
      storageKey: file.storageKey,
      objectVersion,
      downloadFilename: file.originalFilename,
      expiresInSeconds: this.#configuration.downloadTtlSeconds,
    }));
    const url = this.#assertSignedDownload(signed, file);
    await this.#repositoryOperation(() => this.#dependencies.repository.recordExport(
      trustedContext,
      validatedProjectId,
      validatedFileId,
    ));
    return Object.freeze({
      url,
      expiresAt: new Date(issuedAt.getTime() + (this.#configuration.downloadTtlSeconds * 1000)),
    });
  }

  #ownerContext(context: TrustedAppContext): TrustedOrganizationContext {
    const trustedContext = validateTrustedFileContext(context);
    if (trustedContext.platformRole === 'PLATFORM_ADMIN') {
      throw new FileError('FILE_ACCESS_DENIED');
    }
    return trustedContext;
  }

  #assertConfiguredStorage(file: InternalFileRecord): void {
    if (
      file.storageProvider !== this.#configuration.storageProvider
      || file.storageBucket !== this.#configuration.storageBucket
    ) {
      throw new FileError('FILE_OPERATION_FAILED');
    }
  }

  #assertPreparedRecord(
    context: TrustedOrganizationContext,
    file: InternalFileRecord,
    input: PrepareGeneratedFileInput,
  ): void {
    if (
      file.organizationId !== context.organizationId
      || file.ownerUserId !== context.userId
      || file.projectId !== input.projectId
      || file.originalFilename !== input.originalFilename
      || file.mediaType !== input.mediaType
      || file.byteSize !== input.byteSize
      || file.sensitivity !== input.sensitivity
      || file.requiredCapability !== input.requiredCapability
      || file.storageProvider !== input.storageProvider
      || file.storageBucket !== input.storageBucket
    ) {
      throw new FileError('FILE_OPERATION_FAILED');
    }
    if (
      file.idempotencyKeySha256 !== input.idempotencyKeySha256
      || file.requestFingerprintSha256 !== input.requestFingerprintSha256
      || file.contentSha256 !== input.contentSha256
    ) {
      throw new FileError('FILE_IDEMPOTENCY_CONFLICT');
    }
  }

  #assertStoredObject(file: InternalFileRecord, stored: PrivateStoredObject): void {
    if (
      stored.storageProvider !== file.storageProvider
      || stored.storageBucket !== file.storageBucket
      || stored.storageKey !== file.storageKey
      || stored.mediaType !== file.mediaType
      || stored.byteSize !== file.byteSize
      || stored.contentSha256 !== file.contentSha256
      || !stored.objectVersion
    ) {
      throw new FileError('FILE_STORAGE_CONFLICT');
    }
  }

  #assertSignedDownload(signed: PrivateSignedDownload, file: InternalFileRecord): string {
    if (!signed || typeof signed.url !== 'string' || signed.url.length > 2048) {
      throw new FileError('FILE_STORAGE_FAILED');
    }
    try {
      const parsed = new URL(signed.url);
      const localHttp = parsed.protocol === 'http:'
        && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
      if (
        (parsed.protocol !== 'https:' && !localHttp)
        || parsed.username
        || parsed.password
        || !parsed.pathname
        || parsed.toString().includes(file.originalFilename)
      ) {
        throw new Error('unsafe signed download');
      }
      return parsed.toString();
    } catch {
      throw new FileError('FILE_STORAGE_FAILED');
    }
  }

  async #abortBestEffort(context: TrustedOrganizationContext, fileId: string): Promise<void> {
    await this.#dependencies.repository.abort(context, fileId).catch(() => undefined);
  }

  async #compensateCompletedStorage(
    context: TrustedOrganizationContext,
    fileId: string,
    stored: PrivateStoredObject,
  ): Promise<void> {
    const deletion: DeletePrivateFileInput = {
      storageProvider: stored.storageProvider,
      storageBucket: stored.storageBucket,
      storageKey: stored.storageKey,
      objectVersion: stored.objectVersion,
    };
    try {
      await this.#dependencies.storage.deletePrivate(deletion);
    } catch {
      return;
    }
    await this.#abortBestEffort(context, fileId);
  }

  async #compensateUnverifiedStorage(
    context: TrustedOrganizationContext,
    file: InternalFileRecord,
    stored: PrivateStoredObject,
  ): Promise<void> {
    if (typeof stored.objectVersion !== 'string' || !stored.objectVersion) return;
    try {
      await this.#dependencies.storage.deletePrivate({
        storageProvider: file.storageProvider,
        storageBucket: file.storageBucket,
        storageKey: file.storageKey,
        objectVersion: stored.objectVersion,
      });
    } catch {
      return;
    }
    await this.#abortBestEffort(context, file.id);
  }

  async #repositoryOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof FileError) throw error;
      throw new FileError('FILE_OPERATION_FAILED');
    }
  }

  async #storageOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof FileError
        && (error.code === 'FILE_STORAGE_FAILED' || error.code === 'FILE_STORAGE_CONFLICT')
      ) {
        throw error;
      }
      throw new FileError('FILE_STORAGE_FAILED');
    }
  }
}
