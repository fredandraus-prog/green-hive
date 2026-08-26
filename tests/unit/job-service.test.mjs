import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JOB_ERROR_CODES,
  JOB_STATUSES,
  JobError,
  JobService,
} from '../../packages/jobs/dist/index.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const APP_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const JOB_ID = '71000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-08-26T12:00:00.000Z');
const context = {
  userId: USER_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_ID,
};

function hasCode(code) {
  return (error) => error instanceof JobError && error.code === code;
}

function queuedJob() {
  return {
    id: JOB_ID,
    organizationId: ORGANIZATION_ID,
    appId: APP_ID,
    projectId: PROJECT_ID,
    ownerUserId: USER_ID,
    jobType: 'REFERENCE_APP_FAKE_AI_JOB',
    status: 'QUEUED',
    priority: 50,
    attemptCount: 0,
    maxAttempts: 3,
    retryPolicy: 'EXPONENTIAL_BACKOFF',
    timeoutClass: 'SHORT',
    correlationId: '72000000-0000-4000-8000-000000000001',
    safeErrorCode: null,
    queuedAt: NOW,
    availableAt: NOW,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class FakeJobRepository {
  enqueueInput;
  getInput;
  fail = false;

  async enqueue(_context, input) {
    if (this.fail) throw new Error('SELECT secret FROM internal_jobs');
    this.enqueueInput = input;
    return queuedJob();
  }

  async get(_context, projectId, jobId) {
    this.getInput = { projectId, jobId };
    return jobId === JOB_ID ? queuedJob() : null;
  }
}

test('Jobs validates and normalizes an enqueue request without caller authority fields', async () => {
  const repository = new FakeJobRepository();
  const service = new JobService(repository);
  const job = await service.enqueue(context, {
    projectId: PROJECT_ID,
    jobType: 'REFERENCE_APP_FAKE_AI_JOB',
    idempotencyKey: 'reference-job-0001',
    inputHash: 'a'.repeat(64),
    inputReference: 'reference-app://inputs/0001',
  });

  assert.equal(job.status, 'QUEUED');
  assert.deepEqual(repository.enqueueInput, {
    projectId: PROJECT_ID,
    jobType: 'REFERENCE_APP_FAKE_AI_JOB',
    idempotencyKey: 'reference-job-0001',
    inputHash: 'a'.repeat(64),
    inputReference: 'reference-app://inputs/0001',
    priority: 50,
  });
  assert.equal(repository.enqueueInput.ownerUserId, undefined);
  assert.equal(repository.enqueueInput.appId, undefined);
  assert.equal(repository.enqueueInput.organizationId, undefined);
  assert.equal(await service.get(context, PROJECT_ID, JOB_ID).then((value) => value.id), JOB_ID);
});

test('Jobs rejects forged scope, non-namespaced jobs, malformed hashes and admin writes', async () => {
  const service = new JobService(new FakeJobRepository());
  const input = {
    projectId: PROJECT_ID,
    jobType: 'REFERENCE_APP_FAKE_AI_JOB',
    idempotencyKey: 'reference-job-0001',
    inputHash: 'b'.repeat(64),
  };
  await assert.rejects(
    service.enqueue(context, { ...input, ownerUserId: USER_ID }),
    hasCode('JOB_INVALID_INPUT'),
  );
  await assert.rejects(
    service.enqueue(context, { ...input, jobType: 'OTHER_APP_FAKE_AI_JOB' }),
    hasCode('JOB_INVALID_INPUT'),
  );
  await assert.rejects(
    service.enqueue(context, { ...input, inputHash: 'not-a-hash' }),
    hasCode('JOB_INVALID_INPUT'),
  );
  await assert.rejects(
    service.enqueue({ ...context, platformRole: 'PLATFORM_ADMIN' }, input),
    hasCode('JOB_ACCESS_DENIED'),
  );
  await assert.rejects(
    service.get(context, PROJECT_ID, '71000000-0000-4000-8000-000000000099'),
    hasCode('JOB_NOT_FOUND'),
  );
});

test('Jobs maps unexpected repository failures to a stable public error', async () => {
  const repository = new FakeJobRepository();
  repository.fail = true;
  const service = new JobService(repository);
  await assert.rejects(
    service.enqueue(context, {
      projectId: PROJECT_ID,
      jobType: 'REFERENCE_APP_FAKE_AI_JOB',
      idempotencyKey: 'reference-job-0001',
      inputHash: 'c'.repeat(64),
    }),
    (error) => {
      assert.ok(error instanceof JobError);
      assert.equal(error.code, 'JOB_OPERATION_FAILED');
      assert.doesNotMatch(error.message, /SELECT|secret|internal/i);
      return true;
    },
  );
  assert.deepEqual(JOB_STATUSES, [
    'QUEUED', 'RUNNING', 'RETRYING', 'COMPLETED', 'FAILED', 'CANCELLED',
  ]);
  assert.deepEqual(JOB_ERROR_CODES, [
    'JOB_ACCESS_DENIED', 'JOB_INVALID_INPUT', 'JOB_NOT_FOUND', 'JOB_NOT_REGISTERED',
    'JOB_ENTITLEMENT_REQUIRED', 'JOB_IDEMPOTENCY_CONFLICT', 'JOB_OPERATION_FAILED',
  ]);
});
