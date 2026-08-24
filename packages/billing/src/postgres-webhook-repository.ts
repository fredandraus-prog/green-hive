import { BillingError } from './errors.js';
import type {
  BillingSqlExecutor,
  BillingWebhookEffect,
  BillingWebhookProcessingResult,
  BillingWebhookRepository,
  VerifiedProviderWebhookEvent,
} from './types.js';

interface AppliedWebhookRow extends Record<string, unknown> {
  readonly event_record_id: string;
  readonly provider_event_id: string;
  readonly purchase_id: string;
  readonly payment_id: string;
  readonly effect: BillingWebhookEffect;
  readonly duplicate: boolean;
  readonly delivery_count: number;
}

function mapKnownDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  for (const code of [
    'BILLING_WEBHOOK_IDEMPOTENCY_CONFLICT',
    'INVALID_BILLING_WEBHOOK_INPUT',
    'INVALID_PAYMENT_TRANSITION',
  ] as const) {
    if (message.includes(code)) throw new BillingError(code);
  }
  throw error;
}

export class PostgresBillingWebhookRepository implements BillingWebhookRepository {
  readonly #database: BillingSqlExecutor;

  constructor(database: BillingSqlExecutor) {
    this.#database = database;
  }

  async applyVerifiedEvent(
    event: VerifiedProviderWebhookEvent,
    payloadSha256: string,
  ): Promise<BillingWebhookProcessingResult> {
    if (!/^[0-9a-f]{64}$/.test(payloadSha256)) {
      throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');
    }
    try {
      const applied = await this.#database.query<AppliedWebhookRow>(
        `SELECT
           event_record_id::text,
           provider_event_id,
           purchase_id::text,
           payment_id::text,
           effect,
           duplicate,
           delivery_count
         FROM hive.apply_verified_payment_webhook(
           $1::text,
           $2::text,
           $3::text,
           $4::uuid,
           $5::text,
           $6::text,
           $7::text,
           $8::text
         )`,
        [
          event.providerCode,
          event.providerEventId,
          event.eventType,
          event.purchaseId,
          event.providerPaymentId,
          payloadSha256,
          event.providerRefundId,
          event.failureCode,
        ],
      );
      const row = applied.rows[0];
      if (
        !row ||
        !['PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'NO_CHANGE'].includes(
          row.effect,
        ) ||
        typeof row.duplicate !== 'boolean' ||
        !Number.isSafeInteger(row.delivery_count) ||
        row.delivery_count < 1
      ) {
        throw new Error('Verified webhook function returned an invalid result');
      }
      return {
        eventRecordId: row.event_record_id,
        providerEventId: row.provider_event_id,
        purchaseId: row.purchase_id,
        paymentId: row.payment_id,
        effect: row.effect,
        duplicate: row.duplicate,
        deliveryCount: row.delivery_count,
      };
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }
}
