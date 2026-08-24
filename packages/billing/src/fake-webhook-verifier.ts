import { createHmac, timingSafeEqual } from 'node:crypto';
import { BillingError } from './errors.js';
import type {
  FakeBillingWebhookVerifierOptions,
  ProviderWebhookVerificationRequest,
  VerifiedProviderWebhookEvent,
} from './types.js';
import { validateVerifiedProviderWebhookEvent } from './validation.js';

const SIGNATURE = /^t=([0-9]{10}),v1=([0-9a-f]{64})$/;
const COMMON_KEYS = new Set(['eventId', 'type', 'purchaseId', 'providerPaymentId']);
const FAILED_KEYS = new Set([...COMMON_KEYS, 'failureCode']);
const REFUNDED_KEYS = new Set([...COMMON_KEYS, 'providerRefundId']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

export class FakeBillingWebhookVerifier {
  static readonly providerCode = 'GREEN_HIVE_FAKE' as const;

  readonly providerCode = FakeBillingWebhookVerifier.providerCode;
  readonly #secret: Uint8Array;
  readonly #now: () => number;
  readonly #toleranceSeconds: number;

  constructor(options: FakeBillingWebhookVerifierOptions) {
    this.#secret = typeof options.secret === 'string'
      ? Buffer.from(options.secret, 'utf8')
      : Uint8Array.from(options.secret);
    this.#now = options.now ?? Date.now;
    this.#toleranceSeconds = options.toleranceSeconds ?? 300;
    if (
      this.#secret.byteLength < 32 ||
      !Number.isSafeInteger(this.#toleranceSeconds) ||
      this.#toleranceSeconds < 1 ||
      this.#toleranceSeconds > 900
    ) {
      throw new BillingError('BILLING_WEBHOOK_PROCESSING_FAILED');
    }
  }

  async verify(
    request: ProviderWebhookVerificationRequest,
  ): Promise<VerifiedProviderWebhookEvent> {
    const match = SIGNATURE.exec(request.signature);
    if (!match) throw new BillingError('BILLING_WEBHOOK_SIGNATURE_INVALID');
    const timestamp = Number(match[1]);
    const nowSeconds = Math.floor(this.#now() / 1000);
    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(nowSeconds - timestamp) > this.#toleranceSeconds
    ) {
      throw new BillingError('BILLING_WEBHOOK_SIGNATURE_INVALID');
    }

    const rawBody = Buffer.from(request.rawBody);
    const expected = createHmac('sha256', this.#secret)
      .update(Buffer.from(`${timestamp}.`, 'utf8'))
      .update(rawBody)
      .digest();
    const received = Buffer.from(match[2]!, 'hex');
    if (expected.byteLength !== received.byteLength || !timingSafeEqual(expected, received)) {
      throw new BillingError('BILLING_WEBHOOK_SIGNATURE_INVALID');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody));
    } catch {
      throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');
    }
    if (!isRecord(payload)) throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');

    const expectedKeys = payload.type === 'PAYMENT_FAILED'
      ? FAILED_KEYS
      : payload.type === 'PAYMENT_REFUNDED'
        ? REFUNDED_KEYS
        : COMMON_KEYS;
    if (!exactKeys(payload, expectedKeys)) {
      throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');
    }

    return validateVerifiedProviderWebhookEvent({
      providerCode: this.providerCode,
      providerEventId: payload.eventId,
      eventType: payload.type,
      purchaseId: payload.purchaseId,
      providerPaymentId: payload.providerPaymentId,
      providerRefundId: payload.type === 'PAYMENT_REFUNDED' ? payload.providerRefundId : null,
      failureCode: payload.type === 'PAYMENT_FAILED' ? payload.failureCode : null,
    });
  }
}
