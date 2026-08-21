import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditError, AuditService } from '../../packages/audit/dist/index.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const EVENT_ID = '40000000-0000-4000-8000-000000000001';
const APP_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = '50000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-08-20T12:00:00.000Z');

const context = {
  userId: USER_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_ID,
};

function event() {
  return {
    id: EVENT_ID,
    eventCode: 'ORGANIZATION_CREATED',
    actorUserId: USER_ID,
    actorType: 'USER',
    organizationId: ORGANIZATION_ID,
    appId: APP_ID,
    projectId: null,
    subjectType: 'ORGANIZATION',
    subjectId: ORGANIZATION_ID,
    outcome: 'SUCCEEDED',
    requestId: REQUEST_ID,
    correlationId: REQUEST_ID,
    metadata: { kind: 'PERSONAL' },
    occurredAt: NOW,
  };
}

function hasAuditCode(code) {
  return (error) => error instanceof AuditError && error.code === code;
}

test('Audit Service lists only a validated tenant window', async () => {
  const calls = [];
  const service = new AuditService({
    async list(trustedContext, input) {
      calls.push([trustedContext, input]);
      return [event()];
    },
  });
  const events = await service.list(context, { limit: 25, before: NOW });
  assert.equal(events[0].eventCode, 'ORGANIZATION_CREATED');
  assert.equal(calls[0][0].organizationId, ORGANIZATION_ID);
  assert.equal(calls[0][1].limit, 25);
  assert.notEqual(calls[0][1].before, NOW);
  assert.equal(calls[0][1].before.toISOString(), NOW.toISOString());
});

test('Audit Service rejects forged scope, invalid windows and admin tenant reuse', async () => {
  const service = new AuditService({ async list() { return []; } });
  await assert.rejects(
    service.list({ ...context, source: 'free-header' }),
    hasAuditCode('AUDIT_ACCESS_DENIED'),
  );
  await assert.rejects(
    service.list({ ...context, platformRole: 'PLATFORM_ADMIN' }),
    hasAuditCode('AUDIT_ACCESS_DENIED'),
  );
  await assert.rejects(
    service.list(context, { limit: 101 }),
    hasAuditCode('AUDIT_INVALID_INPUT'),
  );
});

test('Audit Service maps storage details to a stable safe error', async () => {
  const service = new AuditService({ async list() { throw new Error('SQL secret payload'); } });
  await assert.rejects(service.list(context), (error) => {
    assert.ok(error instanceof AuditError);
    assert.equal(error.code, 'AUDIT_OPERATION_FAILED');
    assert.doesNotMatch(error.message, /SQL|secret|payload/i);
    return true;
  });
});
