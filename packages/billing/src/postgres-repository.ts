import type { TrustedOrganizationContext } from '@green-hive/core';
import { BillingError } from './errors.js';
import type {
  BillingJsonValue,
  BillingRepository,
  BillingSqlExecutor,
  PaymentStatus,
  Price,
  Product,
  ProductType,
  Purchase,
  PurchaseStatus,
  ProviderPaymentResult,
  ProviderRefundResult,
  ValidatedCreatePurchaseInput,
} from './types.js';

interface AuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly app_id: string | null;
  readonly organization_id: string | null;
  readonly has_trusted_organization_context: boolean;
  readonly is_platform_admin: boolean;
}

interface CatalogRow extends Record<string, unknown> {
  readonly product_id: string;
  readonly app_id: string;
  readonly product_code: string;
  readonly product_type: ProductType;
  readonly product_name: string;
  readonly product_description: string | null;
  readonly product_active: boolean;
  readonly product_metadata: Record<string, BillingJsonValue>;
  readonly product_created_at: Date | string;
  readonly product_updated_at: Date | string;
  readonly price_id: string | null;
  readonly price_version: number | null;
  readonly price_currency: string | null;
  readonly price_amount: string | null;
  readonly price_locale: string | null;
  readonly price_active: boolean | null;
  readonly price_valid_from: Date | string | null;
  readonly price_valid_until: Date | string | null;
  readonly price_created_at: Date | string | null;
  readonly price_updated_at: Date | string | null;
}

interface PurchaseRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly product_id: string;
  readonly price_id: string;
  readonly product_code: string;
  readonly price_version: number;
  readonly status: PurchaseStatus;
  readonly amount: string;
  readonly currency: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly confirmed_at: Date | string | null;
  readonly canceled_at: Date | string | null;
  readonly payment_id: string;
  readonly payment_status: PaymentStatus;
  readonly payment_attempt_number: number;
  readonly payment_amount: string;
  readonly payment_currency: string;
  readonly payment_confirmed_at: Date | string | null;
  readonly payment_failed_at: Date | string | null;
  readonly payment_refunded_at: Date | string | null;
  readonly payment_refunded_amount: string | null;
  readonly payment_created_at: Date | string;
  readonly payment_updated_at: Date | string;
}

const CATALOG_COLUMNS = `
  product.id AS product_id,
  product.app_id,
  product.product_code,
  product.product_type,
  product.name AS product_name,
  product.description AS product_description,
  product.active AS product_active,
  product.metadata AS product_metadata,
  product.created_at AS product_created_at,
  product.updated_at AS product_updated_at,
  price.id AS price_id,
  price.version AS price_version,
  price.currency AS price_currency,
  price.amount::text AS price_amount,
  price.locale AS price_locale,
  price.active AS price_active,
  price.valid_from AS price_valid_from,
  price.valid_until AS price_valid_until,
  price.created_at AS price_created_at,
  price.updated_at AS price_updated_at`;

const PURCHASE_COLUMNS = `
  purchase.id,
  purchase.organization_id,
  purchase.app_id,
  purchase.project_id,
  purchase.owner_user_id,
  purchase.product_id,
  purchase.price_id,
  purchase.product_code,
  purchase.price_version,
  purchase.status,
  purchase.amount::text AS amount,
  purchase.currency,
  purchase.created_at,
  purchase.updated_at,
  purchase.confirmed_at,
  purchase.canceled_at,
  payment.id AS payment_id,
  payment.status AS payment_status,
  payment.attempt_number AS payment_attempt_number,
  payment.amount::text AS payment_amount,
  payment.currency AS payment_currency,
  payment.confirmed_at AS payment_confirmed_at,
  payment.failed_at AS payment_failed_at,
  payment.refunded_at AS payment_refunded_at,
  payment.refunded_amount::text AS payment_refunded_amount,
  payment.created_at AS payment_created_at,
  payment.updated_at AS payment_updated_at`;

function asDate(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}

function asOptionalDate(value: Date | string | null, field: string): Date | null {
  return value === null ? null : asDate(value, field);
}

function mapCatalog(rows: readonly CatalogRow[]): readonly Product[] {
  const products = new Map<string, { base: Omit<Product, 'prices'>; prices: Price[] }>();
  for (const row of rows) {
    let product = products.get(row.product_id);
    if (!product) {
      product = {
        base: {
          id: row.product_id,
          appId: row.app_id,
          productCode: row.product_code,
          productType: row.product_type,
          name: row.product_name,
          description: row.product_description,
          active: row.product_active,
          metadata: row.product_metadata,
          createdAt: asDate(row.product_created_at, 'product_created_at'),
          updatedAt: asDate(row.product_updated_at, 'product_updated_at'),
        },
        prices: [],
      };
      products.set(row.product_id, product);
    }
    if (
      row.price_id &&
      row.price_version !== null &&
      row.price_currency &&
      row.price_amount !== null &&
      row.price_active !== null &&
      row.price_valid_from !== null &&
      row.price_created_at !== null &&
      row.price_updated_at !== null
    ) {
      product.prices.push({
        id: row.price_id,
        productId: row.product_id,
        appId: row.app_id,
        version: row.price_version,
        currency: row.price_currency,
        amount: row.price_amount,
        locale: row.price_locale,
        active: row.price_active,
        validFrom: asDate(row.price_valid_from, 'price_valid_from'),
        validUntil: asOptionalDate(row.price_valid_until, 'price_valid_until'),
        createdAt: asDate(row.price_created_at, 'price_created_at'),
        updatedAt: asDate(row.price_updated_at, 'price_updated_at'),
      });
    }
  }
  return [...products.values()].map(({ base, prices }) => ({ ...base, prices }));
}

function mapPurchase(row: PurchaseRow): Purchase {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    productId: row.product_id,
    priceId: row.price_id,
    productCode: row.product_code,
    priceVersion: row.price_version,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    createdAt: asDate(row.created_at, 'purchase_created_at'),
    updatedAt: asDate(row.updated_at, 'purchase_updated_at'),
    confirmedAt: asOptionalDate(row.confirmed_at, 'purchase_confirmed_at'),
    canceledAt: asOptionalDate(row.canceled_at, 'purchase_canceled_at'),
    payment: {
      id: row.payment_id,
      purchaseId: row.id,
      status: row.payment_status,
      attemptNumber: row.payment_attempt_number,
      amount: row.payment_amount,
      currency: row.payment_currency,
      confirmedAt: asOptionalDate(row.payment_confirmed_at, 'payment_confirmed_at'),
      failedAt: asOptionalDate(row.payment_failed_at, 'payment_failed_at'),
      refundedAt: asOptionalDate(row.payment_refunded_at, 'payment_refunded_at'),
      refundedAmount: row.payment_refunded_amount,
      createdAt: asDate(row.payment_created_at, 'payment_created_at'),
      updatedAt: asDate(row.payment_updated_at, 'payment_updated_at'),
    },
  };
}

function mapKnownDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  for (const code of [
    'BILLING_ACCESS_DENIED',
    'PRODUCT_NOT_FOUND',
    'PRICE_NOT_FOUND',
    'PURCHASE_NOT_FOUND',
    'BILLING_IDEMPOTENCY_CONFLICT',
    'INVALID_PAYMENT_TRANSITION',
  ] as const) {
    if (message.includes(code)) throw new BillingError(code);
  }
  throw error;
}

export class PostgresBillingRepository implements BillingRepository {
  readonly #database: BillingSqlExecutor;

  constructor(database: BillingSqlExecutor) {
    this.#database = database;
  }

  async listCatalog(context: TrustedOrganizationContext): Promise<readonly Product[]> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<CatalogRow>(
      `SELECT ${CATALOG_COLUMNS}
       FROM hive.products AS product
       LEFT JOIN hive.prices AS price
         ON price.product_id = product.id
        AND price.app_id = product.app_id
        AND price.active
        AND price.valid_from <= now()
        AND (price.valid_until IS NULL OR price.valid_until > now())
       WHERE product.app_id = $1::uuid
         AND product.active
       ORDER BY product.product_code, price.currency, price.version`,
      [authority.app_id],
    );
    return mapCatalog(result.rows);
  }

  async getProduct(
    context: TrustedOrganizationContext,
    productCode: string,
  ): Promise<Product | null> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<CatalogRow>(
      `SELECT ${CATALOG_COLUMNS}
       FROM hive.products AS product
       LEFT JOIN hive.prices AS price
         ON price.product_id = product.id
        AND price.app_id = product.app_id
        AND price.active
        AND price.valid_from <= now()
        AND (price.valid_until IS NULL OR price.valid_until > now())
       WHERE product.app_id = $1::uuid
         AND product.product_code = $2
         AND product.active
       ORDER BY price.currency, price.version`,
      [authority.app_id, productCode],
    );
    return mapCatalog(result.rows)[0] ?? null;
  }

  async createPurchase(
    context: TrustedOrganizationContext,
    input: ValidatedCreatePurchaseInput,
  ): Promise<Purchase> {
    await this.#assertAuthority(context);
    try {
      const created = await this.#database.query<{ purchase_id: string }>(
        `SELECT hive.create_pending_purchase(
           $1::uuid,
           $2::text,
           $3::uuid,
           $4::text
         )::text AS purchase_id`,
        [input.projectId, input.productCode, input.priceId, input.idempotencyKey],
      );
      const purchaseId = created.rows[0]?.purchase_id;
      if (!purchaseId) throw new Error('Purchase function returned no id');
      const purchase = await this.getPurchase(context, purchaseId);
      if (!purchase) throw new BillingError('PURCHASE_NOT_FOUND');
      return purchase;
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }

  async listPurchases(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly Purchase[]> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<PurchaseRow>(
      `SELECT ${PURCHASE_COLUMNS}
       FROM hive.purchases AS purchase
       JOIN hive.payments AS payment
         ON payment.purchase_id = purchase.id
        AND payment.attempt_number = (
          SELECT max(candidate.attempt_number)
          FROM hive.payments AS candidate
          WHERE candidate.purchase_id = purchase.id
        )
       WHERE purchase.project_id = $1::uuid
         AND purchase.owner_user_id = $2::uuid
         AND purchase.app_id = $3::uuid
         AND purchase.organization_id = $4::uuid
       ORDER BY purchase.created_at, purchase.id`,
      [projectId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows.map(mapPurchase);
  }

  async getPurchase(
    context: TrustedOrganizationContext,
    purchaseId: string,
  ): Promise<Purchase | null> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<PurchaseRow>(
      `SELECT ${PURCHASE_COLUMNS}
       FROM hive.purchases AS purchase
       JOIN hive.payments AS payment
         ON payment.purchase_id = purchase.id
        AND payment.attempt_number = (
          SELECT max(candidate.attempt_number)
          FROM hive.payments AS candidate
          WHERE candidate.purchase_id = purchase.id
        )
       WHERE purchase.id = $1::uuid
         AND purchase.owner_user_id = $2::uuid
         AND purchase.app_id = $3::uuid
         AND purchase.organization_id = $4::uuid`,
      [purchaseId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows[0] ? mapPurchase(result.rows[0]) : null;
  }

  async applyPaymentResult(
    context: TrustedOrganizationContext,
    purchaseId: string,
    result: ProviderPaymentResult,
  ): Promise<Purchase> {
    await this.#assertAuthority(context);
    try {
      const applied = await this.#database.query<{ purchase_id: string }>(
        `SELECT hive.apply_provider_payment_result(
           $1::uuid,
           $2::text,
           $3::text,
           $4::text,
           $5::text
         )::text AS purchase_id`,
        [
          purchaseId,
          result.providerCode,
          result.providerPaymentId,
          result.status,
          result.status === 'FAILED' ? result.failureCode : null,
        ],
      );
      if (applied.rows[0]?.purchase_id !== purchaseId) {
        throw new Error('Payment transition returned an unexpected purchase id');
      }
      const purchase = await this.getPurchase(context, purchaseId);
      if (!purchase) throw new BillingError('PURCHASE_NOT_FOUND');
      return purchase;
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }

  async applyRefundResult(
    context: TrustedOrganizationContext,
    purchaseId: string,
    result: ProviderRefundResult,
  ): Promise<Purchase> {
    await this.#assertAuthority(context);
    try {
      const applied = await this.#database.query<{ purchase_id: string }>(
        `SELECT hive.apply_provider_refund(
           $1::uuid,
           $2::text,
           $3::text
         )::text AS purchase_id`,
        [purchaseId, result.providerCode, result.providerRefundId],
      );
      if (applied.rows[0]?.purchase_id !== purchaseId) {
        throw new Error('Refund transition returned an unexpected purchase id');
      }
      const purchase = await this.getPurchase(context, purchaseId);
      if (!purchase) throw new BillingError('PURCHASE_NOT_FOUND');
      return purchase;
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }

  async #assertAuthority(context: TrustedOrganizationContext): Promise<AuthorityRow> {
    const result = await this.#database.query<AuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         hive.current_app_id()::text AS app_id,
         hive.current_organization_id()::text AS organization_id,
         hive.has_trusted_organization_context() AS has_trusted_organization_context,
         hive.is_platform_admin() AS is_platform_admin`,
    );
    const authority = result.rows[0];
    if (
      !authority?.app_id ||
      !authority.organization_id ||
      !authority.has_trusted_organization_context ||
      authority.is_platform_admin ||
      authority.user_id !== context.userId ||
      authority.app_code !== context.appCode ||
      authority.organization_id !== context.organizationId
    ) {
      throw new BillingError('BILLING_ACCESS_DENIED');
    }
    return authority;
  }
}
