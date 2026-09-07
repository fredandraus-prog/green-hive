import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REFERENCE_APP_RENDER_PROJECT_DOCUMENT,
  ReferenceDocumentRenderWorker,
} from '../../apps/hive-reference-app/dist/index.js';

const IDENTITY = Object.freeze({ workerId: 'reference-render-worker-01' });
const LEASE = Object.freeze({
  jobId: '90000000-0000-4000-8000-000000000001',
  organizationId: '30000000-0000-4000-8000-000000000001',
  appId: '00000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000001',
  ownerUserId: '10000000-0000-4000-8000-000000000001',
  jobType: REFERENCE_APP_RENDER_PROJECT_DOCUMENT,
  inputReference: 'render:pdf',
  inputHash: 'a'.repeat(64),
  attemptCount: 1,
  maxAttempts: 3,
  retryPolicy: 'FIXED',
  timeoutClass: 'MEDIUM',
  correlationId: '60000000-0000-4000-8000-000000000001',
  leaseToken: '80000000-0000-4000-8000-000000000001',
  leaseExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
});

function createWorker({ fileError = null } = {}) {
  const calls = { store: [], complete: [], fail: [] };
  const worker = new ReferenceDocumentRenderWorker({
    files: {
      async store(lease, input) {
        calls.store.push({ lease, input });
        if (fileError) throw fileError;
        return {
          id: '81000000-0000-4000-8000-000000000021',
          storageKey: `ghf/${'b'.repeat(64)}`,
          objectVersion: 'object-version-001',
          contentSha256: 'c'.repeat(64),
        };
      },
    },
    lifecycle: {
      async complete(identity, input) { calls.complete.push({ identity, input }); },
      async fail(identity, input) { calls.fail.push({ identity, input }); return 'RETRYING'; },
    },
  });
  return { worker, calls };
}

test('GH-0603 Reference App renders the claimed PDF, writes privately, then completes with opaque file reference', async () => {
  const { worker, calls } = createWorker();
  const result = await worker.process(IDENTITY, LEASE);

  assert.deepEqual(result, { status: 'COMPLETED', fileId: '81000000-0000-4000-8000-000000000021' });
  assert.equal(calls.store.length, 1);
  assert.deepEqual(calls.store[0].lease, {
    jobId: LEASE.jobId,
    workerId: IDENTITY.workerId,
    leaseToken: LEASE.leaseToken,
  });
  assert.equal(calls.store[0].input.originalFilename, 'project-document.pdf');
  assert.equal(calls.store[0].input.mediaType, 'application/pdf');
  assert.match(new TextDecoder().decode(calls.store[0].input.content), /^%PDF-1\.4/);
  assert.equal(calls.complete.length, 1);
  assert.equal(calls.complete[0].input.outputReference, 'file:81000000-0000-4000-8000-000000000021');
  assert.match(calls.complete[0].input.outputHash, /^[0-9a-f]{64}$/);
  assert.equal(calls.fail.length, 0);
});

test('GH-0603 Reference App rejects an untrusted render directive as a permanent safe failure', async () => {
  const { worker, calls } = createWorker();
  const result = await worker.process(IDENTITY, { ...LEASE, inputReference: 'https://untrusted.example/template' });

  assert.deepEqual(result, { status: 'RETRYING' });
  assert.equal(calls.store.length, 0);
  assert.equal(calls.complete.length, 0);
  assert.deepEqual(calls.fail[0].input, {
    jobId: LEASE.jobId,
    leaseToken: LEASE.leaseToken,
    failureKind: 'PERMANENT',
    safeErrorCode: 'RENDER_REQUEST_INVALID',
  });
});

test('GH-0603 Reference App maps private-file operational failure to retry without leaking the provider', async () => {
  const { worker, calls } = createWorker({ fileError: new Error('provider private credentials detail') });
  const result = await worker.process(IDENTITY, LEASE);

  assert.deepEqual(result, { status: 'RETRYING' });
  assert.deepEqual(calls.fail[0].input, {
    jobId: LEASE.jobId,
    leaseToken: LEASE.leaseToken,
    failureKind: 'TRANSIENT',
    safeErrorCode: 'RENDER_PRIVATE_STORAGE_FAILED',
  });
});

test('GH-0603 refuses to process another job type before touching files or lifecycle state', async () => {
  const { worker, calls } = createWorker();
  await assert.rejects(
    worker.process(IDENTITY, { ...LEASE, jobType: 'REFERENCE_APP_FAKE_AI' }),
    /Worker input is invalid/,
  );
  assert.equal(calls.store.length, 0);
  assert.equal(calls.complete.length, 0);
  assert.equal(calls.fail.length, 0);
});
