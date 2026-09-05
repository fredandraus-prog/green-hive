import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FILE_ERROR_CODES,
  FILE_SENSITIVITIES,
  FILE_STATUSES,
  FakeFileStorage,
  FileError,
  FileService,
  SupabasePrivateStorageProvider,
} from '../../packages/files/dist/index.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const APP_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000161';
const FILE_ID = '81000000-0000-4000-8000-000000000001';
const context = Object.freeze({
  userId: USER_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_ID,
});
const configuration = Object.freeze({
  requiredCapability: 'REFERENCE_APP_GENERATE_FILE',
  sensitivity: 'INTERNAL',
  storageProvider: FakeFileStorage.providerCode,
  storageBucket: 'green-hive-generated',
  maxBytes: 1024,
  allowedMediaTypes: Object.freeze(['text/plain', 'application/json']),
  downloadTtlSeconds: 120,
});

function hasCode(code) {
  return (error) => error instanceof FileError && error.code === code;
}

function input(overrides = {}) {
  return {
    projectId: PROJECT_ID,
    idempotencyKey: 'generated-file-operation-0001',
    originalFilename: 'monthly-summary.txt',
    mediaType: 'text/plain',
    content: new TextEncoder().encode('private generated report'),
    ...overrides,
  };
}

class MemoryFileRepository {
  #records = new Map();
  #next = 0;
  prepareCalls = 0;
  exportCalls = 0;

  #record(input) {
    const key = `${input.projectId}:${input.idempotencyKeySha256}`;
    const existing = this.#records.get(key);
    if (existing) {
      if (existing.requestFingerprintSha256 !== input.requestFingerprintSha256) {
        throw new FileError('FILE_IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }
    this.#next += 1;
    const record = Object.freeze({
      id: FILE_ID.slice(0, -1) + this.#next,
      organizationId: ORGANIZATION_ID,
      appId: APP_ID,
      projectId: input.projectId,
      ownerUserId: USER_ID,
      originalFilename: input.originalFilename,
      mediaType: input.mediaType,
      byteSize: input.byteSize,
      sensitivity: input.sensitivity,
      status: 'PROCESSING',
      requiredCapability: input.requiredCapability,
      storageProvider: input.storageProvider,
      storageBucket: input.storageBucket,
      storageKey: `ghf/${String(this.#next).padStart(64, 'a')}`,
      contentSha256: input.contentSha256,
      idempotencyKeySha256: input.idempotencyKeySha256,
      requestFingerprintSha256: input.requestFingerprintSha256,
      objectVersion: null,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      readyAt: null,
      deletedAt: null,
      updatedAt: new Date('2026-09-05T12:00:00.000Z'),
    });
    this.#records.set(key, record);
    return record;
  }

  async prepare(_context, value) {
    this.prepareCalls += 1;
    return this.#record(value);
  }

  async complete(_context, id, objectVersion) {
    const current = [...this.#records.values()].find((record) => record.id === id);
    if (!current) throw new FileError('FILE_NOT_FOUND');
    if (current.status === 'READY') {
      if (current.objectVersion !== objectVersion) throw new FileError('FILE_IDEMPOTENCY_CONFLICT');
      return current;
    }
    const updated = Object.freeze({
      ...current,
      status: 'READY',
      objectVersion,
      readyAt: new Date('2026-09-05T12:01:00.000Z'),
      updatedAt: new Date('2026-09-05T12:01:00.000Z'),
    });
    this.#replace(updated);
    return updated;
  }

  async abort(_context, id) {
    const current = [...this.#records.values()].find((record) => record.id === id);
    if (current?.status === 'PROCESSING') this.#records.delete(`${current.projectId}:${current.idempotencyKeySha256}`);
  }

  async list(_context, projectId) {
    return [...this.#records.values()].filter((record) => record.projectId === projectId && record.status === 'READY');
  }

  async find(_context, projectId, id) {
    if (_context.userId !== USER_ID || _context.appCode !== 'REFERENCE_APP') return null;
    return [...this.#records.values()].find((record) => record.projectId === projectId && record.id === id) ?? null;
  }

  async softDelete(_context, id) {
    const current = [...this.#records.values()].find((record) => record.id === id);
    if (!current) return false;
    if (current.status === 'DELETED') return true;
    const updated = Object.freeze({
      ...current,
      status: 'DELETED',
      deletedAt: new Date('2026-09-05T12:02:00.000Z'),
      updatedAt: new Date('2026-09-05T12:02:00.000Z'),
    });
    this.#replace(updated);
    return true;
  }

  async recordExport(_context, projectId, id) {
    const record = await this.find(_context, projectId, id);
    if (!record || record.status !== 'READY') throw new FileError('FILE_ACCESS_DENIED');
    this.exportCalls += 1;
  }

  #replace(record) {
    this.#records.set(`${record.projectId}:${record.idempotencyKeySha256}`, record);
  }
}

function createService({ entitled = true, storage = new FakeFileStorage(), repository = new MemoryFileRepository() } = {}) {
  return {
    storage,
    repository,
    service: new FileService(configuration, {
      repository,
      storage,
      entitlements: { async can() { return entitled; } },
    }),
  };
}

test('GH-0601 stores private generated bytes idempotently and returns metadata without storage authority', async () => {
  const { service, storage, repository } = createService();
  const generated = input();
  const first = await service.storeGenerated(context, generated);
  generated.content[0] = 0;
  const second = await service.storeGenerated(context, input());

  assert.equal(first.id, second.id);
  assert.equal(first.status, 'READY');
  assert.equal(first.storageKey, undefined);
  assert.equal(first.storageBucket, undefined);
  assert.equal(first.contentSha256, undefined);
  assert.deepEqual(Object.keys(first).sort(), [
    'byteSize', 'createdAt', 'id', 'mediaType', 'originalFilename', 'projectId', 'readyAt', 'sensitivity', 'status',
  ]);
  assert.equal(storage.objectCount, 1);
  assert.equal(repository.prepareCalls, 2);
  const privateObject = storage.inspectForTesting({
    storageProvider: FakeFileStorage.providerCode,
    storageBucket: 'green-hive-generated',
    storageKey: `ghf/${'a'.repeat(63)}1`,
  });
  assert.ok(privateObject);
  assert.equal(new TextDecoder().decode(privateObject.content), 'private generated report');
  assert.deepEqual(FILE_STATUSES, ['PROCESSING', 'READY', 'DELETED']);
  assert.deepEqual(FILE_SENSITIVITIES, ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL']);
});

test('GH-0601 rejects forged authority, malformed input, unsupported MIME and admin writes before storage', async () => {
  const { service, storage } = createService();
  await assert.rejects(
    service.storeGenerated(context, { ...input(), ownerUserId: USER_ID }),
    hasCode('FILE_INVALID_INPUT'),
  );
  await assert.rejects(
    service.storeGenerated(context, input({ originalFilename: '../private.txt' })),
    hasCode('FILE_INVALID_INPUT'),
  );
  await assert.rejects(
    service.storeGenerated(context, input({ mediaType: 'image/png' })),
    hasCode('FILE_INVALID_INPUT'),
  );
  await assert.rejects(
    service.storeGenerated({ ...context, platformRole: 'PLATFORM_ADMIN' }, input()),
    hasCode('FILE_ACCESS_DENIED'),
  );
  assert.equal(storage.objectCount, 0);
});

test('GH-0601 blocks storage when entitlement is missing and compensates a controlled storage failure', async () => {
  const denied = createService({ entitled: false });
  await assert.rejects(denied.service.storeGenerated(context, input()), hasCode('FILE_ENTITLEMENT_REQUIRED'));
  assert.equal(denied.storage.objectCount, 0);

  const failed = createService({ storage: new FakeFileStorage({ failureMode: 'PUT_FAILED' }) });
  await assert.rejects(failed.service.storeGenerated(context, input()), hasCode('FILE_STORAGE_FAILED'));
  assert.equal(failed.storage.objectCount, 0);
  assert.equal((await failed.repository.list(context, PROJECT_ID)).length, 0);
});

test('GH-0601 conflicts on idempotency reuse with changed bytes and performs an idempotent private soft delete', async () => {
  const { service, storage } = createService();
  const stored = await service.storeGenerated(context, input());
  await assert.rejects(
    service.storeGenerated(context, input({ content: new TextEncoder().encode('changed content') })),
    hasCode('FILE_IDEMPOTENCY_CONFLICT'),
  );
  await service.softDelete(context, PROJECT_ID, stored.id);
  await service.softDelete(context, PROJECT_ID, stored.id);
  assert.equal(storage.objectCount, 0);
  assert.deepEqual(await service.list(context, PROJECT_ID), []);
  await assert.rejects(service.get(context, PROJECT_ID, stored.id), hasCode('FILE_NOT_FOUND'));
});

test('GH-0602 issues a short owner-authorized download grant and records it before returning', async () => {
  const { service, repository } = createService();
  const stored = await service.storeGenerated(context, input());
  const grant = await service.createDownload(context, PROJECT_ID, stored.id);

  assert.match(grant.url, /^https:\/\/files\.green-hive\.invalid\/download\/[0-9a-f]{64}$/);
  assert.equal(grant.url.includes('monthly-summary.txt'), false);
  assert.ok(grant.expiresAt instanceof Date);
  assert.ok(grant.expiresAt.getTime() > Date.now());
  assert.equal(repository.exportCalls, 1);

  await assert.rejects(
    service.createDownload({ ...context, userId: '10000000-0000-4000-8000-000000000002' }, PROJECT_ID, stored.id),
    hasCode('FILE_NOT_FOUND'),
  );
  await assert.rejects(
    service.createDownload({ ...context, appCode: 'OTHER_TEST_APP' }, PROJECT_ID, stored.id),
    hasCode('FILE_NOT_FOUND'),
  );
  await assert.rejects(
    service.createDownload({ ...context, platformRole: 'PLATFORM_ADMIN' }, PROJECT_ID, stored.id),
    hasCode('FILE_ACCESS_DENIED'),
  );

  await service.softDelete(context, PROJECT_ID, stored.id);
  await assert.rejects(service.createDownload(context, PROJECT_ID, stored.id), hasCode('FILE_NOT_FOUND'));
  assert.equal(repository.exportCalls, 1);

  const signingFailure = createService({ storage: new FakeFileStorage({ failureMode: 'SIGN_FAILED' }) });
  const second = await signingFailure.service.storeGenerated(context, input({
    idempotencyKey: 'generated-file-operation-0002',
  }));
  await assert.rejects(
    signingFailure.service.createDownload(context, PROJECT_ID, second.id),
    hasCode('FILE_STORAGE_FAILED'),
  );
  assert.equal(signingFailure.repository.exportCalls, 0);
});

test('GH-0601 uses stable error contracts without leaking internal provider details', async () => {
  const repository = new MemoryFileRepository();
  repository.prepare = async () => { throw new Error('SELECT storage_key FROM private_bucket'); };
  const service = new FileService(configuration, {
    repository,
    storage: new FakeFileStorage(),
    entitlements: { async can() { return true; } },
  });
  await assert.rejects(service.storeGenerated(context, input()), (error) => {
    assert.ok(error instanceof FileError);
    assert.equal(error.code, 'FILE_OPERATION_FAILED');
    assert.doesNotMatch(error.message, /SELECT|storage_key|private_bucket/i);
    return true;
  });
  assert.deepEqual(FILE_ERROR_CODES, [
    'FILE_ACCESS_DENIED', 'FILE_INVALID_INPUT', 'FILE_NOT_FOUND', 'FILE_ENTITLEMENT_REQUIRED',
    'FILE_IDEMPOTENCY_CONFLICT', 'FILE_INVALID_TRANSITION', 'FILE_STORAGE_CONFLICT',
    'FILE_STORAGE_FAILED', 'FILE_CONFIGURATION_INVALID', 'FILE_OPERATION_FAILED',
  ]);
});

test('GH-0601 Supabase adapter accepts only the configured private bucket and preserves opaque metadata', async () => {
  const objects = new Map();
  const bucket = {
    async upload(key, content, options) {
      objects.set(key, {
        content: new Uint8Array(content),
        contentType: options.contentType,
        metadata: options.metadata,
        version: 'version-0001',
      });
      return { data: { path: key }, error: null };
    },
    async info(key) {
      const object = objects.get(key);
      if (!object) return { data: null, error: { status: 404 } };
      return {
        data: {
          version: object.version,
          size: object.content.byteLength,
          contentType: object.contentType,
          metadata: object.metadata,
        },
        error: null,
      };
    },
    async createSignedUrl(key, expiresIn, options) {
      if (!objects.has(key) || expiresIn !== 120 || options.download !== 'monthly-summary.txt') {
        return { data: null, error: { status: 400 } };
      }
      return { data: { signedUrl: `https://storage.example.test/signed/${'b'.repeat(48)}` }, error: null };
    },
    async remove(keys) {
      for (const key of keys) objects.delete(key);
      return { data: {}, error: null };
    },
  };
  const provider = new SupabasePrivateStorageProvider({
    storage: { from(name) { return name === 'green-hive-generated' ? bucket : null; } },
  }, {
    providerCode: 'SUPABASE_PRIVATE_STORAGE',
    privateBuckets: ['green-hive-generated'],
  });
  const content = new TextEncoder().encode('adapter private report');
  const contentSha256 = (await import('node:crypto')).createHash('sha256').update(content).digest('hex');
  const locator = {
    storageProvider: 'SUPABASE_PRIVATE_STORAGE',
    storageBucket: 'green-hive-generated',
    storageKey: `ghf/${'f'.repeat(64)}`,
  };
  const stored = await provider.putPrivate({
    ...locator,
    mediaType: 'text/plain',
    byteSize: content.byteLength,
    contentSha256,
    content,
  });
  assert.equal(stored.objectVersion, 'version-0001');
  assert.equal(objects.get(locator.storageKey).metadata.greenHiveContentSha256, contentSha256);
  const signed = await provider.createSignedDownload({
    ...locator,
    objectVersion: stored.objectVersion,
    downloadFilename: 'monthly-summary.txt',
    expiresInSeconds: 120,
  });
  assert.equal(signed.url, `https://storage.example.test/signed/${'b'.repeat(48)}`);
  await assert.rejects(
    provider.putPrivate({
      ...locator,
      storageBucket: 'public-files',
      mediaType: 'text/plain',
      byteSize: content.byteLength,
      contentSha256,
      content,
    }),
    hasCode('FILE_STORAGE_FAILED'),
  );
  await provider.deletePrivate({ ...locator, objectVersion: stored.objectVersion });
  assert.equal(await provider.headPrivate(locator), null);
});
