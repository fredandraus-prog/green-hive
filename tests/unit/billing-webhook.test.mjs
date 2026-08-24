import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  BillingError,
  BillingWebhookService,
  FakeBillingWebhookVerifier,
} from '../../packages/billing/dist/index.js';

const NOW = 1_800_000_000_000;
const PURCHASE_ID = '60000000-0000-4000-8000-000000000001';
const SECRET = Buffer.alloc(32, 7);

function delivery(payload, timestamp = Math.floor(NOW / 1000)) {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = createHmac('sha256', SECRET)
    .update(Buffer.from(`${timestamp}.`, 'utf8'))
    .update(rawBody)
    .digest('hex');
  return { rawBody, signature: `t=${timestamp},v1=${signature}` };
}

function paidEvent(overrides = {}) {
  return {
    eventId: 'evt_paid_0001',
    type: 'PAYMENT_PAID',
    purchaseId: PURCHASE_ID,
    providerPaymentId: 'pay_0001',
    ...overrides,
  };
}

class MemoryWebhookRepository {
  records = new Map();
  calls = [];

  async applyVerifiedEvent(event, payloadSha256) {
    this.calls.push({ event, payloadSha256 });
    const key = `${event.providerCode}:${event.providerEventId}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.payloadSha256 !== payloadSha256) {
        throw new BillingError('BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT');
      }
      existing.deliveryCount += 1;
      return { ...existing, duplicate: true };
    }
    const result = {
      eventRecordId: '80000000-0000-4000-8000-000000000001',
      providerEventId: event.providerEventId,
      purchaseId: event.purchaseId,
      paymentId: '70000000-0000-4000-8000-000000000001',
      effect: 'PAYMENT_CONFIRMED',
      duplicate: false,
      deliveryCount: 1,
      payloadSha256,
    };
    this.records.set(key, result);
    return result;
  }
}

function service(repository = new MemoryWebhookRepository(), now = () => NOW) {
  return {
    repository,
    processor: new BillingWebhookService(repository, [
      new FakeBillingWebhookVerifier({ secret: SECRET, now }),
    ]),
  };
}

test('verified fake-provider webhook has one effect across exact duplicate deliveries', async () => {
  const { processor, repository } = service();
  const request = delivery(paidEvent());

  const first = await processor.process('GREEN_HIVE_FAKE', request);
  const duplicate = await processor.process('GREEN_HIVE_FAKE', request);

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.deliveryCount, 2);
  assert.equal(repository.records.size, 1);
  assert.equal(repository.calls.length, 2);
  assert.match(repository.calls[0].payloadSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(repository.calls[0].event, {
    providerCode: 'GREEN_HIVE_FAKE',
    providerEventId: 'evt_paid_0001',
    eventType: 'PAYMENT_PAID',
    purchaseId: PURCHASE_ID,
    providerPaymentId: 'pay_0001',
    providerRefundId: null,
    failureCode: null,
  });
});

test('signature verification rejects tampering, replay and unrecognized payload fields', async () => {
  const { processor } = service();
  const valid = delivery(paidEvent());
  const tampered = { ...valid, rawBody: Buffer.from(JSON.stringify(paidEvent({ eventId: 'evt_other' }))) };

  await assert.rejects(
    processor.process('GREEN_HIVE_FAKE', tampered),
    (error) => error instanceof BillingError && error.code === 'BILLING_WEBHOOK_SIGNATURE_INVALID',
  );
  await assert.rejects(
    processor.process('GREEN_HIVE_FAKE', delivery(paidEvent(), Math.floor(NOW / 1000) - 301)),
    (error) => error instanceof BillingError && error.code === 'BILLING_WEBHOOK_SIGNATURE_INVALID',
  );
  await assert.rejects(
    processor.process('GREEN_HIVE_FAKE', delivery(paidEvent({ appCode: 'FORGED_APP' }))),
    (error) => error instanceof BillingError && error.code === 'INVALID_BILLING_WEBHOOK_INPUT',
  );
});

test('provider routing and provider-event identity conflicts fail with stable public errors', async () => {
  const { processor } = service();
  await assert.rejects(
    processor.process('UNCONFIGURED_PROVIDER', delivery(paidEvent())),
    (error) => error instanceof BillingError && error.code === 'BILLING_WEBHOOK_PROVIDER_UNSUPPORTED',
  );

  await processor.process('GREEN_HIVE_FAKE', delivery(paidEvent()));
  await assert.rejects(
    processor.process(
      'GREEN_HIVE_FAKE',
      delivery(paidEvent({ providerPaymentId: 'pay_conflicting' })),
    ),
    (error) => error instanceof BillingError && error.code === 'BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT',
  );
});
