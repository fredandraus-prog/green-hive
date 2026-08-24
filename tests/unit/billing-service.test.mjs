import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BILLING_ERROR_CODES,
  BillingError,
  BillingService,
  FakeBillingProvider,
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
        refundedAmount: null,
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

  async applyPaymentResult(context, purchaseId, result) {
    const purchase = await this.getPurchase(context, purchaseId);
    if (!purchase) throw new BillingError('PURCHASE_NOT_FOUND');
    if (
      (result.status === 'PAID' && purchase.payment.status === 'PAID') ||
      (result.status === 'FAILED' && purchase.payment.status === 'FAILED')
    ) {
      return purchase;
    }
    if (purchase.status !== 'PENDING' || purchase.payment.status !== 'PENDING') {
      throw new BillingError('INVALID_PAYMENT_TRANSITION');
    }
    const retained = this.purchases.get(purchaseId);
    const transitionedAt = new Date('2026-08-23T03:00:00.000Z');
    retained.payment.status = result.status;
    retained.payment.updatedAt = transitionedAt;
    retained.updatedAt = transitionedAt;
    if (result.status === 'PAID') {
      retained.status = 'CONFIRMED';
      retained.confirmedAt = transitionedAt;
      retained.payment.confirmedAt = transitionedAt;
    } else {
      retained.status = 'CANCELED';
      retained.canceledAt = transitionedAt;
      retained.payment.failedAt = transitionedAt;
    }
    return clone(retained);
  }

  async applyRefundResult(context, purchaseId) {
    const purchase = await this.getPurchase(context, purchaseId);
    if (!purchase) throw new BillingError('PURCHASE_NOT_FOUND');
    if (purchase.payment.status === 'REFUNDED') return purchase;
    if (purchase.status !== 'CONFIRMED' || purchase.payment.status !== 'PAID') {
      throw new BillingError('INVALID_PAYMENT_TRANSITION');
    }
    const retained = this.purchases.get(purchaseId);
    const refundedAt = new Date('2026-08-23T03:05:00.000Z');
    retained.payment.status = 'REFUNDED';
    retained.payment.refundedAt = refundedAt;
    retained.payment.refundedAmount = retained.payment.amount;
    retained.payment.updatedAt = refundedAt;
    return clone(retained);
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

test('deterministic sandbox provider supports success, failure and refund without network access', async () => {
  const request = {
    purchaseId: '60000000-0000-4000-8000-000000000001',
    paymentId: '70000000-0000-4000-8000-000000000001',
    productCode: 'REFERENCE_APP_SANDBOX',
    amount: '0.000000',
    currency: 'BRL',
    attemptNumber: 1,
  };
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('network must not be used');
  };
  try {
    const success = new FakeBillingProvider({ paymentOutcome: 'SUCCESS' });
    const first = await success.processPayment(request);
    const repeated = await success.processPayment(request);
    assert.deepEqual(repeated, first);
    assert.deepEqual(first, {
      status: 'PAID',
      providerCode: 'GREEN_HIVE_FAKE',
      providerPaymentId: `fake-payment:${request.paymentId}`,
    });
    assert.deepEqual(await success.refundPayment(request), {
      status: 'REFUNDED',
      providerCode: 'GREEN_HIVE_FAKE',
      providerRefundId: `fake-refund:${request.paymentId}`,
    });

    const failure = new FakeBillingProvider({ paymentOutcome: 'FAILURE' });
    assert.deepEqual(await failure.processPayment(request), {
      status: 'FAILED',
      providerCode: 'GREEN_HIVE_FAKE',
      providerPaymentId: `fake-payment:${request.paymentId}`,
      failureCode: 'SANDBOX_DECLINED',
    });
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Billing Service applies sandbox success and full refund idempotently', async () => {
  const repository = new FakeBillingRepository();
  const service = new BillingService(
    repository,
    new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
  );
  const pending = await service.createPurchase(contextA, {
    projectId: PROJECT_A_ID,
    productCode: 'REFERENCE_APP_SANDBOX',
    priceId: PRICE_ID,
    idempotencyKey: 'purchase-provider-0001',
  });
  const paid = await service.processPayment(contextA, pending.id);
  assert.equal(paid.status, 'CONFIRMED');
  assert.equal(paid.payment.status, 'PAID');
  assert.equal((await service.processPayment(contextA, pending.id)).payment.status, 'PAID');

  const refunded = await service.refundPayment(contextA, pending.id);
  assert.equal(refunded.status, 'CONFIRMED');
  assert.equal(refunded.payment.status, 'REFUNDED');
  assert.equal(refunded.payment.refundedAmount, refunded.payment.amount);
  assert.equal((await service.refundPayment(contextA, pending.id)).payment.status, 'REFUNDED');
});

test('provider reconciliation applies authoritative success, failure and refund states', async () => {
  const repository = new FakeBillingRepository();
  const create = async (key) => new BillingService(repository).createPurchase(contextA, {
    projectId: PROJECT_A_ID,
    productCode: 'REFERENCE_APP_SANDBOX',
    priceId: PRICE_ID,
    idempotencyKey: key,
  });

  const successPurchase = await create('purchase-reconciliation-success-0001');
  const confirmed = await new BillingService(
    repository,
    new FakeBillingProvider({ reconciliationOutcome: 'SUCCESS' }),
  ).reconcilePayment(contextA, successPurchase.id);
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.payment.status, 'PAID');

  const failedPurchase = await create('purchase-reconciliation-failure-0001');
  const failed = await new BillingService(
    repository,
    new FakeBillingProvider({ reconciliationOutcome: 'FAILURE' }),
  ).reconcilePayment(contextA, failedPurchase.id);
  assert.equal(failed.status, 'CANCELED');
  assert.equal(failed.payment.status, 'FAILED');

  const refundPurchase = await create('purchase-reconciliation-refund-0001');
  const paidService = new BillingService(
    repository,
    new FakeBillingProvider({ paymentOutcome: 'SUCCESS' }),
  );
  await paidService.processPayment(contextA, refundPurchase.id);
  const refunded = await new BillingService(
    repository,
    new FakeBillingProvider({ reconciliationOutcome: 'REFUND' }),
  ).reconcilePayment(contextA, refundPurchase.id);
  assert.equal(refunded.status, 'CONFIRMED');
  assert.equal(refunded.payment.status, 'REFUNDED');
});

test('sandbox failure is server-configured and cannot be overridden by caller input', async () => {
  const repository = new FakeBillingRepository();
  const service = new BillingService(
    repository,
    new FakeBillingProvider({ paymentOutcome: 'FAILURE' }),
  );
  const pending = await service.createPurchase(contextA, {
    projectId: PROJECT_A_ID,
    productCode: 'REFERENCE_APP_SANDBOX',
    priceId: PRICE_ID,
    idempotencyKey: 'purchase-provider-0002',
  });
  const failed = await service.processPayment(contextA, pending.id, {
    paymentOutcome: 'SUCCESS',
    providerPaymentId: 'forged',
  });
  assert.equal(failed.status, 'CANCELED');
  assert.equal(failed.payment.status, 'FAILED');
  await assert.rejects(service.refundPayment(contextA, pending.id), hasCode('INVALID_PAYMENT_TRANSITION'));
});

test('provider absence, malformed output and failures use stable sanitized errors', async () => {
  const repository = new FakeBillingRepository();
  const pending = await new BillingService(repository).createPurchase(contextA, {
    projectId: PROJECT_A_ID,
    productCode: 'REFERENCE_APP_SANDBOX',
    priceId: PRICE_ID,
    idempotencyKey: 'purchase-provider-0003',
  });
  await assert.rejects(
    new BillingService(repository).processPayment(contextA, pending.id),
    hasCode('BILLING_PROVIDER_NOT_CONFIGURED'),
  );

  const malformedProvider = {
    async processPayment() {
      return {
        status: 'PAID',
        providerCode: 'GREEN_HIVE_FAKE',
        providerPaymentId: 'safe-reference',
        secret: 'must-not-cross-the-contract',
      };
    },
    async refundPayment() {
      throw new Error('provider token and stack details');
    },
  };
  await assert.rejects(
    new BillingService(repository, malformedProvider).processPayment(contextA, pending.id),
    (error) => {
      assert.ok(error instanceof BillingError);
      assert.equal(error.code, 'BILLING_PROVIDER_FAILED');
      assert.equal(error.message, 'Billing provider operation failed');
      assert.doesNotMatch(error.message, /secret|token|stack/i);
      return true;
    },
  );
});
