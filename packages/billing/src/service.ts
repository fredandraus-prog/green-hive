import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { BillingError } from './errors.js';
import type { BillingRepository, CreatePurchaseInput, Product, Purchase } from './types.js';
import {
  validateBillingId,
  validateCreatePurchaseInput,
  validateProductCode,
  validateTrustedBillingContext,
} from './validation.js';

export class BillingService {
  readonly #repository: BillingRepository;

  constructor(repository: BillingRepository) {
    this.#repository = repository;
  }

  async listCatalog(context: TrustedAppContext): Promise<readonly Product[]> {
    const trustedContext = this.#ownerContext(context);
    return this.#execute(() => this.#repository.listCatalog(trustedContext));
  }

  async getProduct(context: TrustedAppContext, productCode: string): Promise<Product> {
    const trustedContext = this.#ownerContext(context);
    const validatedProductCode = validateProductCode(productCode);
    const product = await this.#execute(() =>
      this.#repository.getProduct(trustedContext, validatedProductCode),
    );
    if (!product) throw new BillingError('PRODUCT_NOT_FOUND');
    return product;
  }

  async createPurchase(context: TrustedAppContext, input: CreatePurchaseInput): Promise<Purchase> {
    const trustedContext = this.#ownerContext(context);
    const validatedInput = validateCreatePurchaseInput(input);
    return this.#execute(() => this.#repository.createPurchase(trustedContext, validatedInput));
  }

  async listPurchases(
    context: TrustedAppContext,
    projectId: string,
  ): Promise<readonly Purchase[]> {
    const trustedContext = this.#ownerContext(context);
    const validatedProjectId = validateBillingId(projectId);
    return this.#execute(() =>
      this.#repository.listPurchases(trustedContext, validatedProjectId),
    );
  }

  async getPurchase(context: TrustedAppContext, purchaseId: string): Promise<Purchase> {
    const trustedContext = this.#ownerContext(context);
    const validatedPurchaseId = validateBillingId(purchaseId);
    const purchase = await this.#execute(() =>
      this.#repository.getPurchase(trustedContext, validatedPurchaseId),
    );
    if (!purchase) throw new BillingError('PURCHASE_NOT_FOUND');
    return purchase;
  }

  #ownerContext(context: TrustedAppContext): TrustedOrganizationContext {
    const trustedContext = validateTrustedBillingContext(context);
    if (trustedContext.platformRole === 'PLATFORM_ADMIN') {
      throw new BillingError('BILLING_ACCESS_DENIED');
    }
    return trustedContext;
  }

  async #execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BillingError) throw error;
      throw new BillingError('BILLING_OPERATION_FAILED');
    }
  }
}
