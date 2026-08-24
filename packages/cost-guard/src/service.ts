import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { UsageCostError } from './errors.js';
import type {
  ConfigureUsageBudgetInput,
  CostEvent,
  RecordCostEventInput,
  RecordUsageEventInput,
  UsageBudget,
  UsageCostRepository,
  UsageEvent,
  UsageSummary,
} from './types.js';
import {
  validateConfigureUsageBudgetInput,
  validateRecordCostEventInput,
  validateRecordUsageEventInput,
  validateTrustedUsageCostContext,
  validateUsageCostProjectId,
} from './validation.js';

export class UsageCostService {
  readonly #repository: UsageCostRepository;

  constructor(repository: UsageCostRepository) {
    this.#repository = repository;
  }

  async configureBudget(
    context: TrustedAppContext,
    input: ConfigureUsageBudgetInput,
  ): Promise<UsageBudget> {
    const trustedContext = this.#ownerContext(context);
    const validatedInput = validateConfigureUsageBudgetInput(input);
    return this.#execute(() => this.#repository.configureBudget(trustedContext, validatedInput));
  }

  async recordUsage(
    context: TrustedAppContext,
    input: RecordUsageEventInput,
  ): Promise<UsageEvent> {
    const trustedContext = this.#ownerContext(context);
    const validatedInput = validateRecordUsageEventInput(input);
    return this.#execute(() => this.#repository.recordUsage(trustedContext, validatedInput));
  }

  async recordCost(
    context: TrustedAppContext,
    input: RecordCostEventInput,
  ): Promise<CostEvent> {
    const trustedContext = this.#ownerContext(context);
    const validatedInput = validateRecordCostEventInput(input);
    return this.#execute(() => this.#repository.recordCost(trustedContext, validatedInput));
  }

  async listBudgets(
    context: TrustedAppContext,
    projectId: string,
  ): Promise<readonly UsageBudget[]> {
    const trustedContext = this.#ownerContext(context);
    const validatedProjectId = validateUsageCostProjectId(projectId);
    return this.#execute(() => this.#repository.listBudgets(trustedContext, validatedProjectId));
  }

  async listUsageEvents(
    context: TrustedAppContext,
    projectId: string,
  ): Promise<readonly UsageEvent[]> {
    const trustedContext = this.#ownerContext(context);
    const validatedProjectId = validateUsageCostProjectId(projectId);
    return this.#execute(() => this.#repository.listUsageEvents(trustedContext, validatedProjectId));
  }

  async summarizeUsage(
    context: TrustedAppContext,
    projectId: string,
  ): Promise<readonly UsageSummary[]> {
    const trustedContext = this.#ownerContext(context);
    const validatedProjectId = validateUsageCostProjectId(projectId);
    return this.#execute(() => this.#repository.summarizeUsage(trustedContext, validatedProjectId));
  }

  #ownerContext(context: TrustedAppContext): TrustedOrganizationContext {
    const trustedContext = validateTrustedUsageCostContext(context);
    if (trustedContext.platformRole === 'PLATFORM_ADMIN') {
      throw new UsageCostError('USAGE_COST_ACCESS_DENIED');
    }
    return trustedContext;
  }

  async #execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof UsageCostError) throw error;
      throw new UsageCostError('USAGE_COST_OPERATION_FAILED');
    }
  }
}
