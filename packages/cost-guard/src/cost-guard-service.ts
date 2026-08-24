import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { CostGuardError } from './errors.js';
import type {
  ConsumeCostReservationInput,
  CostGuardReservationResult,
  CostReservation,
  ReleaseCostReservationInput,
  ReserveCostInput,
  UsageCostRepository,
} from './types.js';
import {
  validateConsumeCostReservationInput,
  validateReleaseCostReservationInput,
  validateReserveCostInput,
  validateTrustedCostGuardContext,
} from './validation.js';

/**
 * Trusted server-side Cost Guard boundary. Provider-specific estimation and routing stay outside
 * this service; callers submit an already bounded exact-decimal estimate for atomic reservation.
 */
export class CostGuardService {
  readonly #repository: UsageCostRepository;

  constructor(repository: UsageCostRepository) {
    this.#repository = repository;
  }

  async reserve(
    context: TrustedAppContext,
    input: ReserveCostInput,
  ): Promise<CostGuardReservationResult> {
    const trustedContext = this.#ownerContext(context);
    const validatedInput = validateReserveCostInput(input);
    return this.#execute(() => this.#repository.reserveCost(trustedContext, validatedInput));
  }

  async consume(
    context: TrustedAppContext,
    input: ConsumeCostReservationInput,
  ): Promise<CostReservation> {
    const trustedContext = this.#ownerContext(context);
    const validatedInput = validateConsumeCostReservationInput(input);
    return this.#execute(() =>
      this.#repository.consumeCostReservation(trustedContext, validatedInput),
    );
  }

  async release(
    context: TrustedAppContext,
    input: ReleaseCostReservationInput,
  ): Promise<CostReservation> {
    const trustedContext = this.#ownerContext(context);
    const validatedInput = validateReleaseCostReservationInput(input);
    return this.#execute(() =>
      this.#repository.releaseCostReservation(trustedContext, validatedInput),
    );
  }

  #ownerContext(context: TrustedAppContext): TrustedOrganizationContext {
    const trustedContext = validateTrustedCostGuardContext(context);
    if (trustedContext.platformRole === 'PLATFORM_ADMIN') {
      throw new CostGuardError('COST_GUARD_ACCESS_DENIED');
    }
    return trustedContext;
  }

  async #execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CostGuardError) throw error;
      throw new CostGuardError('COST_GUARD_OPERATION_FAILED');
    }
  }
}
