import { BillingError } from './errors.js';
import type {
  BillingProvider,
  FakeBillingProviderOptions,
  ProviderPaymentRequest,
  ProviderPaymentResult,
  ProviderReconciliationRequest,
  ProviderReconciliationResult,
  ProviderRefundRequest,
  ProviderRefundResult,
  SandboxPaymentOutcome,
} from './types.js';

const FAILURE_CODE = /^[A-Z][A-Z0-9_]{1,127}$/;

/**
 * Deterministic, network-free provider for local and staging acceptance only.
 * Its outcome is server configuration, never caller-controlled input.
 */
export class FakeBillingProvider implements BillingProvider {
  static readonly providerCode = 'GREEN_HIVE_FAKE' as const;

  readonly #paymentOutcome: SandboxPaymentOutcome;
  readonly #failureCode: string;
  readonly #reconciliationOutcome: 'SUCCESS' | 'FAILURE' | 'REFUND' | undefined;

  constructor(options: FakeBillingProviderOptions = {}) {
    this.#paymentOutcome = options.paymentOutcome ?? 'SUCCESS';
    this.#failureCode = options.failureCode ?? 'SANDBOX_DECLINED';
    this.#reconciliationOutcome = options.reconciliationOutcome;
    if (
      !['SUCCESS', 'FAILURE'].includes(this.#paymentOutcome) ||
      (this.#reconciliationOutcome !== undefined &&
        !['SUCCESS', 'FAILURE', 'REFUND'].includes(this.#reconciliationOutcome)) ||
      !FAILURE_CODE.test(this.#failureCode)
    ) {
      throw new BillingError('BILLING_PROVIDER_FAILED');
    }
  }

  async processPayment(request: ProviderPaymentRequest): Promise<ProviderPaymentResult> {
    const providerPaymentId = `fake-payment:${request.paymentId}`;
    if (this.#paymentOutcome === 'FAILURE') {
      return {
        status: 'FAILED',
        providerCode: FakeBillingProvider.providerCode,
        providerPaymentId,
        failureCode: this.#failureCode,
      };
    }
    return {
      status: 'PAID',
      providerCode: FakeBillingProvider.providerCode,
      providerPaymentId,
    };
  }

  async refundPayment(request: ProviderRefundRequest): Promise<ProviderRefundResult> {
    return {
      status: 'REFUNDED',
      providerCode: FakeBillingProvider.providerCode,
      providerRefundId: `fake-refund:${request.paymentId}`,
    };
  }

  async reconcilePayment(
    request: ProviderReconciliationRequest,
  ): Promise<ProviderReconciliationResult> {
    const outcome = this.#reconciliationOutcome
      ?? (request.currentStatus === 'REFUNDED'
        ? 'REFUND'
        : request.currentStatus === 'FAILED'
          ? 'FAILURE'
          : this.#paymentOutcome);
    if (outcome === 'REFUND') {
      return {
        status: 'REFUNDED',
        providerCode: FakeBillingProvider.providerCode,
        providerRefundId: `fake-refund:${request.paymentId}`,
      };
    }
    const providerPaymentId = `fake-payment:${request.paymentId}`;
    if (outcome === 'FAILURE') {
      return {
        status: 'FAILED',
        providerCode: FakeBillingProvider.providerCode,
        providerPaymentId,
        failureCode: this.#failureCode,
      };
    }
    return {
      status: 'PAID',
      providerCode: FakeBillingProvider.providerCode,
      providerPaymentId,
    };
  }
}
