import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BILLING_ERROR_CODES,
  BillingError,
  BillingService,
} from '../../packages/billing/dist/index.js';

const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
const ORGANIZATION_B_ID = '30000000-0000-4000-8000-000000000002';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_APP_ID = '00000000-0000-4000-8000-000000000002';
const PROJECT_A_ID = '20000000-0000-4000-8000-000000000001';
const PROJECT_B_ID = '20000000-0000-4000-8000-000000000002';
const PROJECT_A_SECOND_ID = '20000000-0000-4000-8000-000000000003';
const PRODUCT_ID = '40000000-0000-4000-8000-000000000001';
const PRICE_ID = '50000000-0000-4000-8000-000000000001';

const contextA = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
};
const contextB = {
  userId: USER_B_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_B_ID,
};

function clone(value) {
  return structuredClone(value);
}

class FakeBillingRepository {
  products = [
    {
      id: PRODUCT_ID,
      appId: REFERENCE_APP_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      productType: 'ONE_TIME',
      name: 'Reference App Sandbox',
      description: null,
      active: true,
      metadata: {},
      prices: [
        {
          id: PRICE_ID,
          productId: PRODUCT_ID,
          appId: REFERENCE_APP_ID,
          version: 1,
          currency: 'BRL',
          amount: '0.000000',
          locale: 'pt-BR',
          active: true,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      appId: OTHER_APP_ID,
      productCode: 'OTHER_TEST_APP_PRODUCT',
      productType: 'ONE_TIME',
      name: 'Other product',
      description: null,
      active: true,
      metadata: {},
      prices: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];
  purchases = new Map();
  idempotency = new Map();
  nextId = 1;

  appId(context) {
    return context.appCode === 'REFERENCE_APP' ? REFERENCE_APP_ID : OTHER_APP_ID;
  }

  async listCatalog(context) {
    return clone(this.products.filter((product) => product.appId === this.appId(context)));
  }

  async getProduct(context, productCode) {
    return clone(
      this.products.find(
        (product) => product.appId === this.appId(context) && product.productCode === productCode,
      ) ?? null,
    );
  }

  async createPurchase(context, input) {
    const ownedByA = input.projectId === PROJECT_A_ID || input.projectId === PROJECT_A_SECOND_ID;
    const projectOwner = ownedByA ? USER_A_ID : USER_B_ID;
    const projectOrganization = ownedByA ? ORGANIZATION_A_ID : ORGANIZATION_B_ID;
    if (context.userId !== projectOwner || context.organizationId !== projectOrganization) {
      throw new BillingError('BILLING_ACCESS_DENIED');
    }
    const product = await this.getProduct(context, input.productCode);
    if (!product) throw new BillingError('PRODUCT_NOT_FOUND');
    const price = product.prices.find((entry) => entry.id === input.priceId);
    if (!price) throw new BillingError('PRICE_NOT_FOUND');

    const scopedKey = `${context.organizationId}:${context.userId}:${input.idempotencyKey}`;
    const existingId = this.idempotency.get(scopedKey);
    if (existingId) {
      const existing = this.purchases.get(existingId);
      if (
        existing.projectId !== input.projectId ||
        existing.productId !== product.id ||
        existing.priceId !== price.id
      ) {
        throw new BillingError('BILLING_IDEMPOTENCY_CONFLICT');
      }
      return clone(existing);
    }

    const suffix = String(this.nextId).padStart(12, '0');
    const now = new Date(`2026-08-23T02:10:0${this.nextId}.000Z`);
    const purchase = {
      id: `60000000-0000-4000-8000-${suffix}`,
      organizationId: context.organizationId,
      appId: this.appId(context),
      projectId: input.projectId,
      ownerUserId: context.userId,
      productId: product.id,
      priceId: price.id,
      productCode: product.productCode,
      priceVersion: price.version,
      status: 'PENDING',
      amount: price.amount,
      currency: price.currency,
      createdAt: now,
      updatedAt: now,
      confirmedAt: null,
      canceledAt: null,
      payment: {
        id: `70000000-0000-4000-8000-${suffix}`,
        purchaseId: `60000000-0000-4000-8000-${suffix}`,
        status: 'PENDING',
        attemptNumber: 1,
        amount: price.amount,
        currency: price.currency,
        confirmedAt: null,
        failedAt: null,
        refundedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    };
    this.nextId += 1;
    this.purchases.set(purchase.id, purchase);
    this.idempotency.set(scopedKey, purchase.id);
    return clone(purchase);
  }

  async listPurchases(context, projectId) {
    return clone(
      [...this.purchases.values()].filter(
        (purchase) =>
          purchase.projectId === projectId &&
          purchase.ownerUserId === context.userId &&
          purchase.organizationId === context.organizationId &&
          purchase.appId === this.appId(context),
      ),
    );
  }

  async getPurchase(context, purchaseId) {
    const purchase = this.purchases.get(purchaseId);
    if (
      !purchase ||
      purchase.ownerUserId !== context.userId ||
      purchase.organizationId !== context.organizationId ||
      purchase.appId !== this.appId(context)
    ) {
      return null;
    }
    return clone(purchase);
  }
}

function hasCode(code) {
  return (error) => error instanceof BillingError && error.code === code;
}

test('Billing Service lists only the app catalog and creates a server-scoped pending purchase', async () => {
  const service = new BillingService(new FakeBillingRepository());
  const catalog = await service.listCatalog(contextA);
  assert.deepEqual(catalog.map((product) => product.productCode), ['REFERENCE_APP_SANDBOX']);
  assert.equal(catalog[0].prices[0].amount, '0.000000');

  const purchase = await service.createPurchase(contextA, {
    projectId: PROJECT_A_ID,
    productCode: 'REFERENCE_APP_SANDBOX',
    priceId: PRICE_ID,
    idempotencyKey: 'purchase-unit-0001',
  });
  assert.equal(purchase.organizationId, ORGANIZATION_A_ID);
  assert.equal(purchase.ownerUserId, USER_A_ID);
  assert.equal(purchase.appId, REFERENCE_APP_ID);
  assert.equal(purchase.amount, '0.000000');
  assert.equal(purchase.status, 'PENDING');
  assert.equal(purchase.payment.status, 'PENDING');
  assert.deepEqual((await service.listPurchases(contextA, PROJECT_A_ID)).map((row) => row.id), [purchase.id]);
  assert.equal((await service.getPurchase(contextA, purchase.id)).id, purchase.id);
  await assert.rejects(service.getPurchase(contextB, purchase.id), hasCode('PURCHASE_NOT_FOUND'));
});

test('purchase creation is idempotent and rejects key reuse with a different request', async () => {
  const service = new BillingService(new FakeBillingRepository());
  const input = {
    projectId: PROJECT_A_ID,
    productCode: 'REFERENCE_APP_SANDBOX',
    priceId: PRICE_ID,
    idempotencyKey: 'purchase-unit-0002',
  };
  const first = await service.createPurchase(contextA, input);
  const repeated = await service.createPurchase(contextA, input);
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.payment.id, first.payment.id);
  await assert.rejects(
    service.createPurchase(contextA, { ...input, projectId: PROJECT_A_SECOND_ID }),
    hasCode('BILLING_IDEMPOTENCY_CONFLICT'),
  );
});

test('runtime validation rejects caller-controlled commercial authority fields', async () => {
  const service = new BillingService(new FakeBillingRepository());
  const base = {
    projectId: PROJECT_A_ID,
    productCode: 'REFERENCE_APP_SANDBOX',
    priceId: PRICE_ID,
    idempotencyKey: 'purchase-unit-0003',
  };
  for (const forged of [
    { ...base, ownerUserId: USER_B_ID },
    { ...base, appId: OTHER_APP_ID },
    { ...base, organizationId: ORGANIZATION_B_ID },
    { ...base, amount: '999999.00' },
    { ...base, currency: 'USD' },
    { ...base, status: 'PAID' },
  ]) {
    await assert.rejects(service.createPurchase(contextA, forged), hasCode('INVALID_BILLING_INPUT'));
  }
  await assert.rejects(
    service.createPurchase(contextA, { ...base, idempotencyKey: 'short' }),
    hasCode('INVALID_BILLING_INPUT'),
  );
  await assert.rejects(
    service.listCatalog({ ...contextA, source: 'free-header' }),
    hasCode('BILLING_ACCESS_DENIED'),
  );
});

test('platform administrators cannot reuse owner Billing commands', async () => {
  const service = new BillingService(new FakeBillingRepository());
  const admin = { ...contextA, platformRole: 'PLATFORM_ADMIN' };
  await assert.rejects(service.listCatalog(admin), hasCode('BILLING_ACCESS_DENIED'));
  await assert.rejects(
    service.createPurchase(admin, {
      projectId: PROJECT_A_ID,
      productCode: 'REFERENCE_APP_SANDBOX',
      priceId: PRICE_ID,
      idempotencyKey: 'purchase-unit-admin',
    }),
    hasCode('BILLING_ACCESS_DENIED'),
  );
});

test('storage failures become stable Billing errors without SQL or provider details', async () => {
  const repository = {
    async listCatalog() {
      throw new Error('SQLSTATE 23505 payment_provider_secret stack');
    },
    async getProduct() {
      return null;
    },
    async createPurchase() {
      throw new Error('provider_token SQL table internals');
    },
    async listPurchases() {
      return [];
    },
    async getPurchase() {
      return null;
    },
  };
  const service = new BillingService(repository);
  await assert.rejects(service.listCatalog(contextA), (error) => {
    assert.ok(error instanceof BillingError);
    assert.equal(error.code, 'BILLING_OPERATION_FAILED');
    assert.equal(error.message, 'Billing operation could not be completed');
    assert.doesNotMatch(error.message, /SQLSTATE|provider|secret|stack|table/i);
    assert.equal('cause' in error, false);
    return true;
  });
  assert.ok(BILLING_ERROR_CODES.includes('INVALID_PAYMENT_TRANSITION'));
});
