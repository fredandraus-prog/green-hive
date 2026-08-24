import type { TrustedOrganizationContext } from '@green-hive/core';

export const USAGE_BUDGET_TYPES = [
  'AI',
  'SEARCH',
  'DOCUMENT',
  'FILE_PROCESSING',
  'TOTAL_COST',
  'SAFETY_RESERVE',
] as const;
export type UsageBudgetType = (typeof USAGE_BUDGET_TYPES)[number];

export const USAGE_MEASUREMENT_KINDS = ['USAGE', 'COST'] as const;
export type UsageMeasurementKind = (typeof USAGE_MEASUREMENT_KINDS)[number];

export const USAGE_BUDGET_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type UsageBudgetStatus = (typeof USAGE_BUDGET_STATUSES)[number];

export const ACCOUNTING_EVENT_KINDS = ['DEBIT', 'CREDIT'] as const;
export type AccountingEventKind = (typeof ACCOUNTING_EVENT_KINDS)[number];

export type UsageCostMetadataValue = boolean | number | string | null;
export type UsageCostMetadata = Readonly<Record<string, UsageCostMetadataValue>>;

export interface UsageBudget {
  readonly id: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly budgetType: UsageBudgetType;
  readonly measurementKind: UsageMeasurementKind;
  readonly unitCode: string;
  /** Exact PostgreSQL numeric value. Never convert this field to a JS float. */
  readonly ceilingAmount: string;
  /** Remains zero until GH-0402 owns atomic consume decisions. */
  readonly consumedAmount: string;
  /** Remains zero until GH-0402 owns atomic reservations. */
  readonly reservedAmount: string;
  readonly cycleId: string | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly status: UsageBudgetStatus;
  readonly metadata: UsageCostMetadata;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UsageEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly budgetId: string | null;
  readonly operationId: string;
  readonly eventKind: AccountingEventKind;
  readonly usageCode: string;
  /** Exact PostgreSQL numeric value. Never convert this field to a JS float. */
  readonly quantity: string;
  readonly unitCode: string;
  readonly capabilityCode: string | null;
  readonly cycleId: string | null;
  readonly providerCode: string | null;
  readonly serviceCode: string | null;
  readonly occurredAt: Date;
  readonly metadata: UsageCostMetadata;
  readonly createdAt: Date;
}

export interface CostEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly budgetId: string | null;
  readonly operationId: string;
  readonly eventKind: AccountingEventKind;
  /** Exact PostgreSQL numeric value. Never convert this field to a JS float. */
  readonly amount: string;
  readonly currency: string;
  readonly providerCode: string;
  readonly serviceCode: string;
  readonly modelCode: string | null;
  readonly cycleId: string | null;
  readonly occurredAt: Date;
  readonly metadata: UsageCostMetadata;
  readonly createdAt: Date;
}

export interface UsageSummary {
  readonly usageCode: string;
  readonly unitCode: string;
  readonly cycleId: string | null;
  readonly debitedQuantity: string;
  readonly creditedQuantity: string;
  readonly netQuantity: string;
}

export interface ConfigureUsageBudgetInput {
  readonly projectId: string;
  readonly budgetType: UsageBudgetType;
  readonly measurementKind: UsageMeasurementKind;
  readonly unitCode: string;
  readonly ceilingAmount: string;
  readonly cycleId?: string;
  readonly periodStart?: Date;
  readonly periodEnd?: Date;
  readonly idempotencyKey: string;
  readonly metadata?: UsageCostMetadata;
}

export interface RecordUsageEventInput {
  readonly projectId: string;
  readonly budgetId?: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly eventKind: AccountingEventKind;
  readonly usageCode: string;
  readonly quantity: string;
  readonly unitCode: string;
  readonly capabilityCode?: string;
  readonly cycleId?: string;
  readonly providerCode?: string;
  readonly serviceCode?: string;
  readonly occurredAt?: Date;
  readonly metadata?: UsageCostMetadata;
}

export interface RecordCostEventInput {
  readonly projectId: string;
  readonly budgetId?: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly eventKind: AccountingEventKind;
  readonly amount: string;
  readonly currency: string;
  readonly providerCode: string;
  readonly serviceCode: string;
  readonly modelCode?: string;
  readonly cycleId?: string;
  readonly occurredAt?: Date;
  readonly metadata?: UsageCostMetadata;
}

export interface ValidatedConfigureUsageBudgetInput {
  readonly projectId: string;
  readonly budgetType: UsageBudgetType;
  readonly measurementKind: UsageMeasurementKind;
  readonly unitCode: string;
  readonly ceilingAmount: string;
  readonly cycleId: string | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly idempotencyKey: string;
  readonly metadata: UsageCostMetadata;
}

export interface ValidatedRecordUsageEventInput {
  readonly projectId: string;
  readonly budgetId: string | null;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly eventKind: AccountingEventKind;
  readonly usageCode: string;
  readonly quantity: string;
  readonly unitCode: string;
  readonly capabilityCode: string | null;
  readonly cycleId: string | null;
  readonly providerCode: string | null;
  readonly serviceCode: string | null;
  readonly occurredAt: Date | null;
  readonly metadata: UsageCostMetadata;
}

export interface ValidatedRecordCostEventInput {
  readonly projectId: string;
  readonly budgetId: string | null;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly eventKind: AccountingEventKind;
  readonly amount: string;
  readonly currency: string;
  readonly providerCode: string;
  readonly serviceCode: string;
  readonly modelCode: string | null;
  readonly cycleId: string | null;
  readonly occurredAt: Date | null;
  readonly metadata: UsageCostMetadata;
}

export interface UsageCostRepository {
  configureBudget(
    context: TrustedOrganizationContext,
    input: ValidatedConfigureUsageBudgetInput,
  ): Promise<UsageBudget>;
  recordUsage(
    context: TrustedOrganizationContext,
    input: ValidatedRecordUsageEventInput,
  ): Promise<UsageEvent>;
  recordCost(
    context: TrustedOrganizationContext,
    input: ValidatedRecordCostEventInput,
  ): Promise<CostEvent>;
  listBudgets(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly UsageBudget[]>;
  listUsageEvents(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly UsageEvent[]>;
  summarizeUsage(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly UsageSummary[]>;
}

export interface UsageCostSqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface UsageCostSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<UsageCostSqlResult<Row>>;
}
