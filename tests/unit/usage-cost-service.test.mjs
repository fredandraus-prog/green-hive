import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNTING_EVENT_KINDS,
  COST_GUARD_STATUS,
  USAGE_BUDGET_TYPES,
  USAGE_COST_ERROR_CODES,
  USAGE_MEASUREMENT_KINDS,
  UsageCostError,
  UsageCostService,
} from '../../packages/cost-guard/dist/index.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const APP_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const BUDGET_ID = '90000000-0000-4000-8000-000000000001';
const context = {
  userId: USER_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_ID,
};

function hasCode(code) {
  return (error) => error instanceof UsageCostError && error.code === code;
}

class FakeUsageCostRepository {
  budgetInput;
  usageInput;
  costInput;

  async configureBudget(_context, input) {
    this.budgetInput = input;
    return {
      id: BUDGET_ID,
      organizationId: ORGANIZATION_ID,
      appId: APP_ID,
      projectId: input.projectId,
      ownerUserId: USER_ID,
      budgetType: input.budgetType,
      measurementKind: input.measurementKind,
      unitCode: input.unitCode,
      ceilingAmount: input.ceilingAmount,
      consumedAmount: '0',
      reservedAmount: '0',
      cycleId: input.cycleId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'ACTIVE',
      metadata: input.metadata,
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    };
  }

  async recordUsage(_context, input) {
    this.usageInput = input;
    return {
      id: '91000000-0000-4000-8000-000000000001',
      organizationId: ORGANIZATION_ID,
      appId: APP_ID,
      projectId: input.projectId,
      ownerUserId: USER_ID,
      budgetId: input.budgetId,
      operationId: input.operationId,
      eventKind: input.eventKind,
      usageCode: input.usageCode,
      quantity: input.quantity,
      unitCode: input.unitCode,
      capabilityCode: input.capabilityCode,
      cycleId: input.cycleId,
      providerCode: input.providerCode,
      serviceCode: input.serviceCode,
      occurredAt: input.occurredAt ?? new Date('2026-08-24T00:01:00.000Z'),
      metadata: input.metadata,
      createdAt: new Date('2026-08-24T00:01:00.000Z'),
    };
  }

  async recordCost(_context, input) {
    this.costInput = input;
    return {
      id: '92000000-0000-4000-8000-000000000001',
      organizationId: ORGANIZATION_ID,
      appId: APP_ID,
      projectId: input.projectId,
      ownerUserId: USER_ID,
      budgetId: input.budgetId,
      operationId: input.operationId,
      eventKind: input.eventKind,
      amount: input.amount,
      currency: input.currency,
      providerCode: input.providerCode,
      serviceCode: input.serviceCode,
      modelCode: input.modelCode,
      cycleId: input.cycleId,
      occurredAt: input.occurredAt ?? new Date('2026-08-24T00:02:00.000Z'),
      metadata: input.metadata,
      createdAt: new Date('2026-08-24T00:02:00.000Z'),
    };
  }

  async listBudgets() { return []; }
  async listUsageEvents() { return []; }
  async summarizeUsage() { return []; }
}

test('Usage/Cost service normalizes exact decimals and supplies no caller-controlled scope', async () => {
  const repository = new FakeUsageCostRepository();
  const service = new UsageCostService(repository);
  const budget = await service.configureBudget(context, {
    projectId: PROJECT_ID,
    budgetType: 'AI',
    measurementKind: 'USAGE',
    unitCode: 'TOKENS',
    ceilingAmount: '1000.00000000',
    idempotencyKey: 'budget-unit-0001',
  });
  assert.equal(budget.ceilingAmount, '1000');
  assert.deepEqual(repository.budgetInput, {
    projectId: PROJECT_ID,
    budgetType: 'AI',
    measurementKind: 'USAGE',
    unitCode: 'TOKENS',
    ceilingAmount: '1000',
    cycleId: null,
    periodStart: null,
    periodEnd: null,
    idempotencyKey: 'budget-unit-0001',
    metadata: {},
  });

  const usage = await service.recordUsage(context, {
    projectId: PROJECT_ID,
    budgetId: BUDGET_ID,
    operationId: 'operation-unit-001',
    idempotencyKey: 'usage-unit-0001',
    eventKind: 'DEBIT',
    usageCode: 'AI_INPUT_TOKENS',
    quantity: '12.50000000',
    unitCode: 'TOKENS',
  });
  assert.equal(usage.quantity, '12.5');
  assert.equal(repository.usageInput.organizationId, undefined);
  assert.equal(repository.usageInput.ownerUserId, undefined);
  assert.equal(repository.usageInput.appId, undefined);

  const cost = await service.recordCost(context, {
    projectId: PROJECT_ID,
    operationId: 'cost-unit-001',
    idempotencyKey: 'cost-unit-0001',
    eventKind: 'DEBIT',
    amount: '0.01000000',
    currency: 'BRL',
    providerCode: 'SANDBOX',
    serviceCode: 'REFERENCE_APP',
  });
  assert.equal(cost.amount, '0.01');
});

test('Usage/Cost service rejects malformed values and confidential metadata', async () => {
  const service = new UsageCostService(new FakeUsageCostRepository());
  await assert.rejects(
    service.configureBudget(context, {
      projectId: PROJECT_ID,
      budgetType: 'TOTAL_COST',
      measurementKind: 'COST',
      unitCode: 'TOKENS',
      ceilingAmount: '10',
      idempotencyKey: 'budget-invalid-0001',
    }),
    hasCode('USAGE_COST_INVALID_INPUT'),
  );
  await assert.rejects(
    service.recordUsage(context, {
      projectId: PROJECT_ID,
      operationId: 'operation-invalid-001',
      idempotencyKey: 'usage-invalid-0001',
      eventKind: 'DEBIT',
      usageCode: 'AI_INPUT_TOKENS',
      quantity: '0',
      unitCode: 'TOKENS',
    }),
    hasCode('USAGE_COST_INVALID_INPUT'),
  );
  await assert.rejects(
    service.recordCost(context, {
      projectId: PROJECT_ID,
      operationId: 'cost-invalid-001',
      idempotencyKey: 'cost-invalid-0001',
      eventKind: 'DEBIT',
      amount: '1',
      currency: 'BRL',
      providerCode: 'SANDBOX',
      serviceCode: 'REFERENCE_APP',
      metadata: { Token: 'must-not-pass' },
    }),
    hasCode('USAGE_COST_INVALID_INPUT'),
  );
});

test('Usage/Cost service rejects forged scope and platform-admin write reuse', async () => {
  const service = new UsageCostService(new FakeUsageCostRepository());
  await assert.rejects(
    service.listBudgets({ ...context, ownerUserId: USER_ID }, PROJECT_ID),
    hasCode('USAGE_COST_ACCESS_DENIED'),
  );
  await assert.rejects(
    service.listBudgets({ ...context, platformRole: 'PLATFORM_ADMIN' }, PROJECT_ID),
    hasCode('USAGE_COST_ACCESS_DENIED'),
  );
});

test('Usage/Cost errors stay stable and storage details never escape', async () => {
  const service = new UsageCostService({
    async configureBudget() { throw new Error('SELECT secret password from hive.usage_budgets'); },
    async recordUsage() { throw new Error('private SQL'); },
    async recordCost() { throw new Error('private SQL'); },
    async listBudgets() { throw new Error('private SQL'); },
    async listUsageEvents() { throw new Error('private SQL'); },
    async summarizeUsage() { throw new Error('private SQL'); },
  });
  await assert.rejects(
    service.listBudgets(context, PROJECT_ID),
    (error) => {
      assert.ok(error instanceof UsageCostError);
      assert.equal(error.code, 'USAGE_COST_OPERATION_FAILED');
      assert.doesNotMatch(error.message, /SELECT|secret|password|hive/i);
      return true;
    },
  );
  assert.deepEqual(USAGE_COST_ERROR_CODES, [
    'USAGE_COST_ACCESS_DENIED',
    'USAGE_COST_INVALID_INPUT',
    'USAGE_COST_IDEMPOTENCY_CONFLICT',
    'USAGE_COST_OPERATION_FAILED',
  ]);
  assert.deepEqual(USAGE_BUDGET_TYPES, [
    'AI', 'SEARCH', 'DOCUMENT', 'FILE_PROCESSING', 'TOTAL_COST', 'SAFETY_RESERVE',
  ]);
  assert.deepEqual(USAGE_MEASUREMENT_KINDS, ['USAGE', 'COST']);
  assert.deepEqual(ACCOUNTING_EVENT_KINDS, ['DEBIT', 'CREDIT']);
  assert.equal(COST_GUARD_STATUS, 'ATOMIC_RESERVATIONS');
});
