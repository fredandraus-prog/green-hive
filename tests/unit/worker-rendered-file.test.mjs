import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FakeFileStorage,
  FileError,
  WorkerRenderedFileService,
} from '../../packages/files/dist/index.js';

const LEASE = Object.freeze({
  jobId: '90000000-0000-4000-8000-000000000001',
  workerId: 'reference-render-worker-01',
  leaseToken: '80000000-0000-4000-8000-000000000001',
});
const FILE_ID = '81000000-0000-4000-8000-000000000021';
const BUCKET = 'green-hive-generated';

function input(overrides = {}) {
  return {
    originalFilename: 'project-document.pdf',
    mediaType: 'application/pdf',
    content: new TextEncoder().encode('%PDF-1.4\nprivate document\n'),
    storageBucket: BUCKET,
    ...overrides,
  };
}

function hasCode(code) {
  return (error) => error instanceof FileError && error.code === code;
}

class MemoryWorkerFileRepository {
  record = null;
  abortCalls = 0;
  completeCalls = 0;
  failComplete = false;

  async prepare(lease, value) {
    assert.deepEqual(lease, LEASE);
    if (this.record) return this.record;
    this.record = {
      id: FILE_ID,
      storageKey: `ghf/${'b'.repeat(64)}`,
      status: 'PROCESSING',
      objectVersion: null,
      ...value,
    };
    return this.record;
  }

  async complete(lease, id, objectVersion) {
    assert.deepEqual(lease, LEASE);
    assert.equal(id, FILE_ID);
    this.completeCalls += 1;
    if (this.failComplete) throw new Error('database implementation detail');
    this.record = { ...this.record, status: 'READY', objectVersion };
  }

  async abort(lease, id) {
    assert.deepEqual(lease, LEASE);
    assert.equal(id, FILE_ID);
    this.abortCalls += 1;
    if (this.record?.status === 'PROCESSING') this.record = null;
  }
}

function createService(options = {}) {
  const repository = options.repository ?? new MemoryWorkerFileRepository();
  const storage = options.storage ?? new FakeFileStorage();
  return { repository, storage, service: new WorkerRenderedFileService(repository, storage) };
}

test('GH-0603 stores a worker-rendered document privately using only the claimed lease', async () => {
  const { service, storage, repository } = createService();
  const stored = await service.store(LEASE, input());

  assert.equal(stored.id, FILE_ID);
  assert.match(stored.storageKey, /^ghf\/[0-9a-f]{64}$/);
  assert.match(stored.objectVersion, /^[0-9a-f]{64}$/);
  assert.match(stored.contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(repository.completeCalls, 1);
  assert.equal(storage.objectCount, 1);
  assert.ok(storage.inspectForTesting({
    storageProvider: FakeFileStorage.providerCode,
    storageBucket: BUCKET,
    storageKey: stored.storageKey,
  }));
});

test('GH-0603 rejects forged scope and malformed generated-file input before storage', async () => {
  const { service, storage } = createService();
  await assert.rejects(service.store({ ...LEASE, projectId: 'forged' }, input()), hasCode('FILE_CONFIGURATION_INVALID'));
  await assert.rejects(service.store(LEASE, input({ originalFilename: '../document.pdf' })), hasCode('FILE_INVALID_INPUT'));
  await assert.rejects(service.store(LEASE, input({ mediaType: 'image/png' })), hasCode('FILE_INVALID_INPUT'));
  await assert.rejects(service.store(LEASE, input({ storageBucket: 'not valid' })), hasCode('FILE_INVALID_INPUT'));
  assert.equal(storage.objectCount, 0);
});

test('GH-0603 compensates the private object and processing record if database completion fails', async () => {
  const repository = new MemoryWorkerFileRepository();
  repository.failComplete = true;
  const { service, storage } = createService({ repository });

  await assert.rejects(service.store(LEASE, input()), hasCode('FILE_OPERATION_FAILED'));
  assert.equal(storage.objectCount, 0);
  assert.equal(repository.abortCalls, 1);
  assert.equal(repository.record, null);
});

test('GH-0603 cancels the processing record if private storage rejects the write', async () => {
  const repository = new MemoryWorkerFileRepository();
  const { service, storage } = createService({
    repository,
    storage: new FakeFileStorage({ failureMode: 'PUT_FAILED' }),
  });

  await assert.rejects(service.store(LEASE, input()), hasCode('FILE_STORAGE_FAILED'));
  assert.equal(storage.objectCount, 0);
  assert.equal(repository.abortCalls, 1);
  assert.equal(repository.record, null);
});
