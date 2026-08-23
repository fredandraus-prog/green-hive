import type { TrustedOrganizationContext } from '@green-hive/core';

export const PRODUCT_TYPES = [
  'ONE_TIME',
  'REANALYSIS_OR_REPROCESS',
  'SUBSCRIPTION',
  'INTERNAL_GRANT',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PURCHASE_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELED'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'DISPUTED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type BillingJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BillingJsonValue[]
  | { readonly [key: string]: BillingJsonValue };

export interface Price {
  readonly id: string;
  readonly productId: string;
  readonly appId: string;
  readonly version: number;
  readonly currency: string;
  /** Exact PostgreSQL numeric value. Never convert this field to a JS float. */
  readonly amount: string;
  readonly locale: string | null;
  readonly active: boolean;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Product {
  readonly id: string;
  readonly appId: string;
  readonly productCode: string;
  readonly productType: ProductType;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly metadata: Readonly<Record<string, BillingJsonValue>>;
  readonly prices: readonly Price[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PaymentSummary {
  readonly id: string;
  readonly purchaseId: string;
  readonly status: PaymentStatus;
  readonly attemptNumber: number;
  /** Immutable price snapshot represented as an exact decimal string. */
  readonly amount: string;
  readonly currency: string;
  readonly confirmedAt: Date | null;
  readonly failedAt: Date | null;
  readonly refundedAt: Date | null;
  /** Exact refunded amount. Null until a refund is recorded. */
  readonly refundedAmount: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const SANDBOX_PAYMENT_OUTCOMES = ['SUCCESS', 'FAILURE'] as const;
export type SandboxPaymentOutcome = (typeof SANDBOX_PAYMENT_OUTCOMES)[number];

export interface ProviderPaymentRequest {
  readonly purchaseId: string;
  readonly paymentId: string;
  readonly productCode: string;
  /** Exact decimal string; providers must not convert it to a JS float. */
  readonly amount: string;
  readonly currency: string;
  readonly attemptNumber: number;
}

export interface ProviderPaymentPaidResult {
  readonly status: 'PAID';
  readonly providerCode: string;
  readonly providerPaymentId: string;
}

export interface ProviderPaymentFailedResult {
  readonly status: 'FAILED';
  readonly providerCode: string;
  readonly providerPaymentId: string;
  readonly failureCode: string;
}

export type ProviderPaymentResult =
  | ProviderPaymentPaidResult
  | ProviderPaymentFailedResult;

export interface ProviderRefundRequest {
  readonly purchaseId: string;
  readonly paymentId: string;
  /** Exact decimal string; providers must not convert it to a JS float. */
  readonly amount: string;
  readonly currency: string;
}

export interface ProviderRefundResult {
  readonly status: 'REFUNDED';
  readonly providerCode: string;
  readonly providerRefundId: string;
}

export interface BillingProvider {
  processPayment(request: ProviderPaymentRequest): Promise<ProviderPaymentResult>;
  refundPayment(request: ProviderRefundRequest): Promise<ProviderRefundResult>;
}

export interface FakeBillingProviderOptions {
  readonly paymentOutcome?: SandboxPaymentOutcome;
  readonly failureCode?: string;
}

export interface Purchase {
  readonly id: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly productId: string;
  readonly priceId: string;
  readonly productCode: string;
  readonly priceVersion: number;
  readonly status: PurchaseStatus;
  /** Immutable price snapshot represented as an exact decimal string. */
  readonly amount: string;
  readonly currency: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly confirmedAt: Date | null;
  readonly canceledAt: Date | null;
  readonly payment: PaymentSummary;
}

export interface CreatePurchaseInput {
  readonly projectId: string;
  readonly productCode: string;
  readonly priceId: string;
  readonly idempotencyKey: string;
}

export interface ValidatedCreatePurchaseInput extends CreatePurchaseInput {}

export interface BillingRepository {
  listCatalog(context: TrustedOrganizationContext): Promise<readonly Product[]>;
  getProduct(
    context: TrustedOrganizationContext,
    productCode: string,
  ): Promise<Product | null>;
  createPurchase(
    context: TrustedOrganizationContext,
    input: ValidatedCreatePurchaseInput,
  ): Promise<Purchase>;
  listPurchases(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly Purchase[]>;
  getPurchase(
    context: TrustedOrganizationContext,
    purchaseId: string,
  ): Promise<Purchase | null>;
  applyPaymentResult(
    context: TrustedOrganizationContext,
    purchaseId: string,
    result: ProviderPaymentResult,
  ): Promise<Purchase>;
  applyRefundResult(
    context: TrustedOrganizationContext,
    purchaseId: string,
    result: ProviderRefundResult,
  ): Promise<Purchase>;
}

export interface BillingSqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface BillingSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<BillingSqlResult<Row>>;
}
