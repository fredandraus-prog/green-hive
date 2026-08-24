import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
  EntitlementService,
} from '../../packages/entitlements/dist/index.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const APP_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '40000000-0000-4000-8000-000000000001';
const PURCHASE_ID = '60000000-0000-4000-8000-000000000001';
const PAYMENT_ID = '70000000-0000-4000-8000-000000000001';

const context = {
  userId: USER_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_ID,
};

function entitlement(capabilityCode, status = 'ACTIVE') {
  return {
    id: capabilityCode.endsWith('RUN_JOB')
      ? '80000000-0000-4000-8000-000000000001'
      : '80000000-0000-4000-8000-000000000002',
    organizationId: ORGANIZATION_ID,
    appId: APP_ID,
    projectId: PROJECT_ID,
    ownerUserId: USER_ID,
    productId: PRODUCT_ID,
    purchaseId: PURCHASE_ID,
    paymentId: PAYMENT_ID,
    productCode: 'REFERENCE_APP_SANDBOX',
    priceVersion: 1,
    capabilityCode,
    sourceType: 'PURCHASE',
    status,
    grantedAt: new Date('2026-08-23T23:00:00.000Z'),
    revokedAt: status === 'REVOKED' ? new Date('2026-08-23T23:05:00.000Z') : null,
    createdAt: new Date('2026-08-23T23:00:00.000Z'),
    updatedAt: new Date('2026-08-23T23:05:00.000Z'),
  };
}

class FakeEntitlementRepository {
  rows = [
    entitlement('REFERENCE_APP_RUN_JOB'),
    entitlement('REFERENCE_APP_GENERATE_FILE', 'REVOKED'),
  ];
  canCalls = 0;

  async can(_context, projectId, capabilityCode) {
    this.canCalls += 1;
    return this.rows.some(
      (row) =>
        row.projectId === projectId
        && row.capabilityCode === capabilityCode
        && row.status === 'ACTIVE',
    );
  }

  async list(_context, projectId) {
    return structuredClone(this.rows.filter((row) => row.projectId === projectId));
  }
}

function hasCode(code) {
  return (error) => error instanceof EntitlementError && error.code === code;
}

test('Entitlement Service checks only app-namespaced active project capabilities', async () => {
  const repository = new FakeEntitlementRepository();
  const service = new EntitlementService(repository);

  assert.equal(await service.can(context, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'), true);
  assert.equal(await service.can(context, PROJECT_ID, 'REFERENCE_APP_GENERATE_FILE'), false);
  assert.equal(await service.can(context, PROJECT_ID, 'OTHER_APP_RUN_JOB'), false);
  assert.equal(repository.canCalls, 2);
});

test('Entitlement Service lists immutable grant and revocation snapshots', async () => {
  const service = new EntitlementService(new FakeEntitlementRepository());
  const rows = await service.list(context, PROJECT_ID);

  assert.deepEqual(rows.map((row) => [row.capabilityCode, row.status]), [
    ['REFERENCE_APP_RUN_JOB', 'ACTIVE'],
    ['REFERENCE_APP_GENERATE_FILE', 'REVOKED'],
  ]);
  assert.equal(rows[0].purchaseId, PURCHASE_ID);
  assert.equal(rows[0].paymentId, PAYMENT_ID);
  assert.equal(rows[0].priceVersion, 1);
});

test('Entitlement Service rejects untrusted context, administrators and malformed inputs', async () => {
  const service = new EntitlementService(new FakeEntitlementRepository());

  await assert.rejects(
    () => service.can({ ...context, platformRole: 'PLATFORM_ADMIN' }, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'),
    hasCode('ENTITLEMENT_ACCESS_DENIED'),
  );
  await assert.rejects(
    () => service.can({ ...context, appId: APP_ID }, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'),
    hasCode('ENTITLEMENT_ACCESS_DENIED'),
  );
  await assert.rejects(
    () => service.can(context, 'not-a-uuid', 'REFERENCE_APP_RUN_JOB'),
    hasCode('INVALID_ENTITLEMENT_INPUT'),
  );
  await assert.rejects(
    () => service.can(context, PROJECT_ID, 'invalid capability'),
    hasCode('INVALID_ENTITLEMENT_INPUT'),
  );
});

test('Entitlement Service maps storage failures to a stable safe error', async () => {
  const repository = {
    async can() {
      throw new Error('SELECT hive.private_entitlement failed at password=secret');
    },
    async list() {
      throw new Error('SELECT hive.private_entitlement failed at password=secret');
    },
  };
  const service = new EntitlementService(repository);

  await assert.rejects(
    () => service.can(context, PROJECT_ID, 'REFERENCE_APP_RUN_JOB'),
    (error) => {
      assert.ok(error instanceof EntitlementError);
      assert.equal(error.code, 'ENTITLEMENT_OPERATION_FAILED');
      assert.doesNotMatch(error.message, /SELECT|password|secret/i);
      return true;
    },
  );
  assert.deepEqual(ENTITLEMENT_ERROR_CODES, [
    'ENTITLEMENT_ACCESS_DENIED',
    'INVALID_ENTITLEMENT_INPUT',
    'ENTITLEMENT_OPERATION_FAILED',
  ]);
});
