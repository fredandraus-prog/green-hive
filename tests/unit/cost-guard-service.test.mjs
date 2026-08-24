import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COST_GUARD_DECISION_OUTCOMES,
  COST_GUARD_ERROR_CODES,
  COST_GUARD_REASON_CODES,
  COST_RESERVATION_STATUSES,
  CostGuardError,
  CostGuardService,
} from '../../packages/cost-guard/dist/index.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const APP_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const BUDGET_ID = '90000000-0000-4000-8000-000000000001';
const DECISION_ID = '93000000-0000-4000-8000-000000000001';
const RESERVATION_ID = '94000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-08-24T18:00:00.000Z');
const context = {
  userId: USER_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_ID,
};

function hasCode(code) {
  return (error) => error instanceof CostGuardError && error.code === code;
}

function reservation(status = 'RESERVED', consumedAmount = '0') {
  return {
    id: RESERVATION_ID,
    organizationId: ORGANIZATION_ID,
    appId: APP_ID,
    projectId: PROJECT_ID,
    ownerUserId: USER_ID,
    budgetId: BUDGET_ID,
    decisionId: DECISION_ID,
    operationId: 'operation-cost-guard-001',
    capabilityCode: 'REFERENCE_APP_RUN_JOB',
    estimatedAmount: '2.5',
    consumedAmount,
    currency: 'BRL',
    status,
    costEventId: status === 'CONSUMED' ? '92000000-0000-4000-8000-000000000001' : null,
    metadata: {},
    reservedAt: NOW,
    consumedAt: status === 'CONSUMED' ? NOW : null,
    releasedAt: status === 'RELEASED' ? NOW : null,
    updatedAt: NOW,
  };
}

class FakeCostGuardRepository {
  reserveInput;
  consumeInput;
  releaseInput;

  async reserveCost(_context, input) {
    this.reserveInput = input;
    const currentReservation = reservation();
    return {
      decision: {
        id: DECISION_ID,
        organizationId: ORGANIZATION_ID,
        appId: APP_ID,
        projectId: PROJECT_ID,
        ownerUserId: USER_ID,
        budgetId: BUDGET_ID,
        reservationId: RESERVATION_ID,
        operationId: input.operationId,
        capabilityCode: input.capabilityCode,
        outcome: 'ALLOW',
        reasonCode: 'BUDGET_RESERVED',
        estimatedAmount: input.estimatedAmount,
        currency: input.currency,
        metadata: input.metadata,
        createdAt: NOW,
      },
      reservation: currentReservation,
    };
  }

  async consumeCostReservation(_context, input) {
    this.consumeInput = input;
    return reservation('CONSUMED', input.actualAmount);
  }

  async releaseCostReservation(_context, input) {
    this.releaseInput = input;
    return reservation('RELEASED');
  }
}

test('Cost Guard normalizes a bounded estimate without accepting caller authority', async () => {
  const repository = new FakeCostGuardRepository();
  const service = new CostGuardService(repository);
  const result = await service.reserve(context, {
    projectId: PROJECT_ID,
    budgetId: BUDGET_ID,
    operationId: 'operation-cost-guard-001',
    capabilityCode: 'REFERENCE_APP_RUN_JOB',
    estimatedAmount: '2.50000000',
    currency: 'BRL',
  });

  assert.equal(result.decision.outcome, 'ALLOW');
  assert.equal(result.reservation.status, 'RESERVED');
  assert.deepEqual(repository.reserveInput, {
    projectId: PROJECT_ID,
    budgetId: BUDGET_ID,
    operationId: 'operation-cost-guard-001',
    capabilityCode: 'REFERENCE_APP_RUN_JOB',
    estimatedAmount: '2.5',
    currency: 'BRL',
    metadata: {},
  });
  assert.equal(repository.reserveInput.organizationId, undefined);
  assert.equal(repository.reserveInput.appId, undefined);
  assert.equal(repository.reserveInput.ownerUserId, undefined);

  const consumed = await service.consume(context, {
    reservationId: RESERVATION_ID,
    actualAmount: '2.00000000',
    providerCode: 'SANDBOX',
    serviceCode: 'REFERENCE_APP',
  });
  assert.equal(consumed.status, 'CONSUMED');
  assert.equal(repository.consumeInput.actualAmount, '2');

  const released = await service.release(context, { reservationId: RESERVATION_ID });
  assert.equal(released.status, 'RELEASED');
  assert.deepEqual(repository.releaseInput.metadata, {});
});

test('Cost Guard rejects forged scope, malformed amounts and confidential metadata', async () => {
  const service = new CostGuardService(new FakeCostGuardRepository());
  await assert.rejects(
    service.reserve(context, {
      projectId: PROJECT_ID,
      budgetId: BUDGET_ID,
      operationId: 'operation-cost-guard-001',
      capabilityCode: 'REFERENCE_APP_RUN_JOB',
      estimatedAmount: '0',
      currency: 'BRL',
    }),
    hasCode('COST_GUARD_INVALID_INPUT'),
  );
  await assert.rejects(
    service.reserve(context, {
      projectId: PROJECT_ID,
      budgetId: BUDGET_ID,
      operationId: 'operation-cost-guard-001',
      capabilityCode: 'REFERENCE_APP_RUN_JOB',
      estimatedAmount: '1',
      currency: 'BRL',
      ownerUserId: USER_ID,
    }),
    hasCode('COST_GUARD_INVALID_INPUT'),
  );
  await assert.rejects(
    service.consume(context, {
      reservationId: RESERVATION_ID,
      actualAmount: '1',
      providerCode: 'SANDBOX',
      serviceCode: 'REFERENCE_APP',
      metadata: { Token: 'must-not-pass' },
    }),
    hasCode('COST_GUARD_INVALID_INPUT'),
  );
  await assert.rejects(
    service.release({ ...context, platformRole: 'PLATFORM_ADMIN' }, { reservationId: RESERVATION_ID }),
    hasCode('COST_GUARD_ACCESS_DENIED'),
  );
  await assert.rejects(
    service.release({ ...context, appId: APP_ID }, { reservationId: RESERVATION_ID }),
    hasCode('COST_GUARD_ACCESS_DENIED'),
  );
});

test('Cost Guard exposes canonical outcomes and sanitizes storage failures', async () => {
  const service = new CostGuardService({
    async reserveCost() { throw new Error('SELECT provider_secret FROM internal_table'); },
    async consumeCostReservation() { throw new Error('raw SQL'); },
    async releaseCostReservation() { throw new Error('raw SQL'); },
  });
  await assert.rejects(
    service.reserve(context, {
      projectId: PROJECT_ID,
      budgetId: BUDGET_ID,
      operationId: 'operation-cost-guard-001',
      capabilityCode: 'REFERENCE_APP_RUN_JOB',
      estimatedAmount: '1',
      currency: 'BRL',
    }),
    (error) => {
      assert.ok(error instanceof CostGuardError);
      assert.equal(error.code, 'COST_GUARD_OPERATION_FAILED');
      assert.doesNotMatch(error.message, /SELECT|provider|secret|internal/i);
      return true;
    },
  );
  assert.deepEqual(COST_GUARD_DECISION_OUTCOMES, [
    'ALLOW', 'ALLOW_CACHED', 'ALLOW_CHEAPER_PROVIDER', 'ALLOW_REDUCED_CONTEXT',
    'ALLOW_REDUCED_SCOPE', 'DENY_ENTITLEMENT', 'DENY_BUDGET',
  ]);
  assert.deepEqual(COST_GUARD_REASON_CODES, [
    'BUDGET_RESERVED', 'ENTITLEMENT_REQUIRED', 'BUDGET_EXHAUSTED',
  ]);
  assert.deepEqual(COST_RESERVATION_STATUSES, ['RESERVED', 'CONSUMED', 'RELEASED']);
  assert.deepEqual(COST_GUARD_ERROR_CODES, [
    'COST_GUARD_ACCESS_DENIED', 'COST_GUARD_INVALID_INPUT',
    'COST_GUARD_IDEMPOTENCY_CONFLICT', 'COST_GUARD_INVALID_TRANSITION',
    'COST_GUARD_OPERATION_FAILED',
  ]);
});
