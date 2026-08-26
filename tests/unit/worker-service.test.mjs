import assert from 'node:assert/strict';
import test from 'node:test';
import { JobError, WorkerService } from '../../packages/jobs/dist/index.js';

const identity = { workerId: 'worker.reference-01' };
const lease = {
  jobId: '20000000-0000-4000-8000-000000000001',
  organizationId: '30000000-0000-4000-8000-000000000001',
  appId: '00000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000002',
  ownerUserId: '10000000-0000-4000-8000-000000000001',
  jobType: 'REFERENCE_APP_FAKE_AI_JOB',
  inputReference: null,
  inputHash: 'a'.repeat(64),
  attemptCount: 1,
  maxAttempts: 3,
  retryPolicy: 'EXPONENTIAL_BACKOFF',
  timeoutClass: 'SHORT',
  correlationId: '40000000-0000-4000-8000-000000000001',
  leaseToken: '50000000-0000-4000-8000-000000000001',
  leaseExpiresAt: new Date('2026-08-26T20:00:00Z'),
};

class FakeWorkerRepository {
  calls = [];
  async claim(worker, seconds) { this.calls.push(['claim', worker, seconds]); return lease; }
  async heartbeat(worker, jobId, token, seconds) {
    this.calls.push(['heartbeat', worker, jobId, token, seconds]);
    return new Date('2026-08-26T20:05:00Z');
  }
  async complete(worker, input) { this.calls.push(['complete', worker, input]); }
  async fail(worker, input) { this.calls.push(['fail', worker, input]); return 'RETRYING'; }
  async cancel(worker, jobId, token) { this.calls.push(['cancel', worker, jobId, token]); }
  async recoverExpired(limit) { this.calls.push(['recover', limit]); return [{ jobId: lease.jobId, status: 'FAILED' }]; }
}

function hasCode(code) {
  return (error) => error instanceof JobError && error.code === code;
}

test('WorkerService exposes the complete server-side lifecycle with validated inputs', async () => {
  const repository = new FakeWorkerRepository();
  const service = new WorkerService(repository);
  assert.equal((await service.claim(identity)).jobId, lease.jobId);
  assert.equal((await service.heartbeat(identity, lease.jobId, lease.leaseToken)).toISOString(),
    '2026-08-26T20:05:00.000Z');
  await service.complete(identity, {
    jobId: lease.jobId,
    leaseToken: lease.leaseToken,
    outputHash: 'b'.repeat(64),
    outputReference: 'reference-app://outputs/result-01',
  });
  assert.equal(await service.fail(identity, {
    jobId: lease.jobId,
    leaseToken: lease.leaseToken,
    failureKind: 'TRANSIENT',
    safeErrorCode: 'UPSTREAM_TIMEOUT',
  }), 'RETRYING');
  await service.cancel(identity, lease.jobId, lease.leaseToken);
  assert.deepEqual(await service.recoverExpired(), [{ jobId: lease.jobId, status: 'FAILED' }]);
  assert.deepEqual(repository.calls.map(([operation]) => operation),
    ['claim', 'heartbeat', 'complete', 'fail', 'cancel', 'recover']);
});

test('WorkerService rejects forged shapes and invalid worker-controlled values', async () => {
  const service = new WorkerService(new FakeWorkerRepository());
  await assert.rejects(service.claim({ workerId: 'bad worker' }), hasCode('WORKER_INVALID_INPUT'));
  await assert.rejects(service.claim(identity, 14), hasCode('WORKER_INVALID_INPUT'));
  await assert.rejects(service.complete(identity, {
    jobId: lease.jobId, leaseToken: lease.leaseToken, outputHash: 'raw-payload',
  }), hasCode('WORKER_INVALID_INPUT'));
  await assert.rejects(service.fail(identity, {
    jobId: lease.jobId, leaseToken: lease.leaseToken,
    failureKind: 'TRANSIENT', safeErrorCode: 'unsafe detail',
  }), hasCode('WORKER_INVALID_INPUT'));
  await assert.rejects(service.recoverExpired(0), hasCode('WORKER_INVALID_INPUT'));
});

test('WorkerService converts unexpected repository errors into a stable safe error', async () => {
  const service = new WorkerService({
    claim() { throw new Error('password=secret SQL internals'); },
  });
  await assert.rejects(service.claim(identity), hasCode('WORKER_OPERATION_FAILED'));
});
