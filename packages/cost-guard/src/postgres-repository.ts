import type { TrustedOrganizationContext } from '@green-hive/core';
import { CostGuardError, UsageCostError } from './errors.js';
import type {
  AccountingEventKind,
  CostGuardDecision,
  CostGuardDecisionOutcome,
  CostGuardReasonCode,
  CostGuardReservationResult,
  CostReservation,
  CostReservationStatus,
  CostEvent,
  UsageBudget,
  UsageBudgetStatus,
  UsageBudgetType,
  UsageCostMetadata,
  UsageCostRepository,
  UsageCostSqlExecutor,
  UsageEvent,
  UsageMeasurementKind,
  UsageSummary,
  ValidatedConfigureUsageBudgetInput,
  ValidatedConsumeCostReservationInput,
  ValidatedRecordCostEventInput,
  ValidatedRecordUsageEventInput,
  ValidatedReleaseCostReservationInput,
  ValidatedReserveCostInput,
} from './types.js';

interface AuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly app_id: string | null;
  readonly organization_id: string | null;
  readonly trusted: boolean;
  readonly is_platform_admin: boolean;
}

interface BudgetRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly budget_type: UsageBudgetType;
  readonly measurement_kind: UsageMeasurementKind;
  readonly unit_code: string;
  readonly ceiling_amount: string;
  readonly consumed_amount: string;
  readonly reserved_amount: string;
  readonly cycle_id: string | null;
  readonly period_start: Date | string | null;
  readonly period_end: Date | string | null;
  readonly status: UsageBudgetStatus;
  readonly metadata: UsageCostMetadata;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface UsageRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly budget_id: string | null;
  readonly operation_id: string;
  readonly event_kind: AccountingEventKind;
  readonly usage_code: string;
  readonly quantity: string;
  readonly unit_code: string;
  readonly capability_code: string | null;
  readonly cycle_id: string | null;
  readonly provider_code: string | null;
  readonly service_code: string | null;
  readonly occurred_at: Date | string;
  readonly metadata: UsageCostMetadata;
  readonly created_at: Date | string;
}

interface CostRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly budget_id: string | null;
  readonly operation_id: string;
  readonly event_kind: AccountingEventKind;
  readonly amount: string;
  readonly currency: string;
  readonly provider_code: string;
  readonly service_code: string;
  readonly model_code: string | null;
  readonly cycle_id: string | null;
  readonly occurred_at: Date | string;
  readonly metadata: UsageCostMetadata;
  readonly created_at: Date | string;
}

interface SummaryRow extends Record<string, unknown> {
  readonly usage_code: string;
  readonly unit_code: string;
  readonly cycle_id: string | null;
  readonly debited_quantity: string;
  readonly credited_quantity: string;
  readonly net_quantity: string;
}

interface CostGuardDecisionRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly budget_id: string;
  readonly reservation_id: string | null;
  readonly operation_id: string;
  readonly capability_code: string;
  readonly decision: CostGuardDecisionOutcome;
  readonly reason_code: CostGuardReasonCode;
  readonly estimated_amount: string;
  readonly currency: string;
  readonly metadata: UsageCostMetadata;
  readonly created_at: Date | string;
}

interface CostReservationRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly project_id: string;
  readonly owner_user_id: string;
  readonly budget_id: string;
  readonly decision_id: string;
  readonly operation_id: string;
  readonly capability_code: string;
  readonly estimated_amount: string;
  readonly consumed_amount: string;
  readonly currency: string;
  readonly status: CostReservationStatus;
  readonly cost_event_id: string | null;
  readonly metadata: UsageCostMetadata;
  readonly reserved_at: Date | string;
  readonly consumed_at: Date | string | null;
  readonly released_at: Date | string | null;
  readonly updated_at: Date | string;
}

const BUDGET_COLUMNS = `
  id, organization_id, app_id, project_id, owner_user_id, budget_type,
  measurement_kind, unit_code, ceiling_amount::text AS ceiling_amount,
  consumed_amount::text AS consumed_amount, reserved_amount::text AS reserved_amount,
  cycle_id, period_start, period_end, status, metadata, created_at, updated_at`;

const USAGE_COLUMNS = `
  id, organization_id, app_id, project_id, owner_user_id, budget_id,
  operation_id, event_kind, usage_code, quantity::text AS quantity, unit_code,
  capability_code, cycle_id, provider_code, service_code, occurred_at, metadata, created_at`;

const COST_COLUMNS = `
  id, organization_id, app_id, project_id, owner_user_id, budget_id,
  operation_id, event_kind, amount::text AS amount, currency, provider_code,
  service_code, model_code, cycle_id, occurred_at, metadata, created_at`;

const COST_GUARD_DECISION_COLUMNS = `
  id, organization_id, app_id, project_id, owner_user_id, budget_id,
  reservation_id, operation_id, capability_code, decision, reason_code,
  estimated_amount::text AS estimated_amount, currency, metadata, created_at`;

const COST_RESERVATION_COLUMNS = `
  id, organization_id, app_id, project_id, owner_user_id, budget_id,
  decision_id, operation_id, capability_code,
  estimated_amount::text AS estimated_amount,
  consumed_amount::text AS consumed_amount,
  currency, status, cost_event_id, metadata,
  reserved_at, consumed_at, released_at, updated_at`;

function asDate(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}

function asOptionalDate(value: Date | string | null, field: string): Date | null {
  return value === null ? null : asDate(value, field);
}

function mapBudget(row: BudgetRow): UsageBudget {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    budgetType: row.budget_type,
    measurementKind: row.measurement_kind,
    unitCode: row.unit_code,
    ceilingAmount: row.ceiling_amount,
    consumedAmount: row.consumed_amount,
    reservedAmount: row.reserved_amount,
    cycleId: row.cycle_id,
    periodStart: asOptionalDate(row.period_start, 'period_start'),
    periodEnd: asOptionalDate(row.period_end, 'period_end'),
    status: row.status,
    metadata: row.metadata,
    createdAt: asDate(row.created_at, 'created_at'),
    updatedAt: asDate(row.updated_at, 'updated_at'),
  };
}

function mapUsage(row: UsageRow): UsageEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    budgetId: row.budget_id,
    operationId: row.operation_id,
    eventKind: row.event_kind,
    usageCode: row.usage_code,
    quantity: row.quantity,
    unitCode: row.unit_code,
    capabilityCode: row.capability_code,
    cycleId: row.cycle_id,
    providerCode: row.provider_code,
    serviceCode: row.service_code,
    occurredAt: asDate(row.occurred_at, 'occurred_at'),
    metadata: row.metadata,
    createdAt: asDate(row.created_at, 'created_at'),
  };
}

function mapCost(row: CostRow): CostEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    budgetId: row.budget_id,
    operationId: row.operation_id,
    eventKind: row.event_kind,
    amount: row.amount,
    currency: row.currency,
    providerCode: row.provider_code,
    serviceCode: row.service_code,
    modelCode: row.model_code,
    cycleId: row.cycle_id,
    occurredAt: asDate(row.occurred_at, 'occurred_at'),
    metadata: row.metadata,
    createdAt: asDate(row.created_at, 'created_at'),
  };
}

function mapCostGuardDecision(row: CostGuardDecisionRow): CostGuardDecision {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    budgetId: row.budget_id,
    reservationId: row.reservation_id,
    operationId: row.operation_id,
    capabilityCode: row.capability_code,
    outcome: row.decision,
    reasonCode: row.reason_code,
    estimatedAmount: row.estimated_amount,
    currency: row.currency,
    metadata: row.metadata,
    createdAt: asDate(row.created_at, 'created_at'),
  };
}

function mapCostReservation(row: CostReservationRow): CostReservation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    budgetId: row.budget_id,
    decisionId: row.decision_id,
    operationId: row.operation_id,
    capabilityCode: row.capability_code,
    estimatedAmount: row.estimated_amount,
    consumedAmount: row.consumed_amount,
    currency: row.currency,
    status: row.status,
    costEventId: row.cost_event_id,
    metadata: row.metadata,
    reservedAt: asDate(row.reserved_at, 'reserved_at'),
    consumedAt: asOptionalDate(row.consumed_at, 'consumed_at'),
    releasedAt: asOptionalDate(row.released_at, 'released_at'),
    updatedAt: asDate(row.updated_at, 'updated_at'),
  };
}

function mapKnownDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  for (const code of [
    'USAGE_COST_ACCESS_DENIED',
    'USAGE_COST_INVALID_INPUT',
    'USAGE_COST_IDEMPOTENCY_CONFLICT',
  ] as const) {
    if (message.includes(code)) throw new UsageCostError(code);
  }
  for (const code of [
    'COST_GUARD_ACCESS_DENIED',
    'COST_GUARD_INVALID_INPUT',
    'COST_GUARD_IDEMPOTENCY_CONFLICT',
    'COST_GUARD_INVALID_TRANSITION',
  ] as const) {
    if (message.includes(code)) throw new CostGuardError(code);
  }
  throw error;
}

export class PostgresUsageCostRepository implements UsageCostRepository {
  readonly #database: UsageCostSqlExecutor;

  constructor(database: UsageCostSqlExecutor) {
    this.#database = database;
  }

  async configureBudget(
    context: TrustedOrganizationContext,
    input: ValidatedConfigureUsageBudgetInput,
  ): Promise<UsageBudget> {
    await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<{ budget_id: string }>(
        `SELECT hive.configure_usage_budget(
           $1::uuid, $2::text, $3::text, $4::text, $5::numeric,
           $6::text, $7::timestamptz, $8::timestamptz, $9::text, $10::jsonb
         )::text AS budget_id`,
        [
          input.projectId, input.budgetType, input.measurementKind, input.unitCode,
          input.ceilingAmount, input.cycleId, input.periodStart, input.periodEnd,
          input.idempotencyKey, JSON.stringify(input.metadata),
        ],
      );
      const id = result.rows[0]?.budget_id;
      if (!id) throw new Error('Budget function returned no id');
      const budget = await this.#getBudget(context, id);
      if (!budget) throw new Error('Created budget was not found');
      return budget;
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }

  async recordUsage(
    context: TrustedOrganizationContext,
    input: ValidatedRecordUsageEventInput,
  ): Promise<UsageEvent> {
    await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<{ event_id: string }>(
        `SELECT hive.record_usage_event(
           $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text,
           $7::numeric, $8::text, $9::text, $10::text, $11::text, $12::text,
           $13::timestamptz, $14::jsonb
         )::text AS event_id`,
        [
          input.projectId, input.budgetId, input.operationId, input.idempotencyKey,
          input.eventKind, input.usageCode, input.quantity, input.unitCode,
          input.capabilityCode, input.cycleId, input.providerCode, input.serviceCode,
          input.occurredAt, JSON.stringify(input.metadata),
        ],
      );
      const id = result.rows[0]?.event_id;
      if (!id) throw new Error('Usage function returned no id');
      const event = await this.#getUsage(context, id);
      if (!event) throw new Error('Recorded usage event was not found');
      return event;
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }

  async recordCost(
    context: TrustedOrganizationContext,
    input: ValidatedRecordCostEventInput,
  ): Promise<CostEvent> {
    await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<{ event_id: string }>(
        `SELECT hive.record_cost_event(
           $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::numeric,
           $7::text, $8::text, $9::text, $10::text, $11::text,
           $12::timestamptz, $13::jsonb
         )::text AS event_id`,
        [
          input.projectId, input.budgetId, input.operationId, input.idempotencyKey,
          input.eventKind, input.amount, input.currency, input.providerCode,
          input.serviceCode, input.modelCode, input.cycleId, input.occurredAt,
          JSON.stringify(input.metadata),
        ],
      );
      const id = result.rows[0]?.event_id;
      if (!id) throw new Error('Cost function returned no id');
      const event = await this.#getCost(context, id);
      if (!event) throw new Error('Recorded cost event was not found');
      return event;
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }

  async listBudgets(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly UsageBudget[]> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<BudgetRow>(
      `SELECT ${BUDGET_COLUMNS}
       FROM hive.usage_budgets
       WHERE project_id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid
       ORDER BY budget_type, measurement_kind, unit_code, cycle_id NULLS FIRST`,
      [projectId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows.map(mapBudget);
  }

  async listUsageEvents(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly UsageEvent[]> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<UsageRow>(
      `SELECT ${USAGE_COLUMNS}
       FROM hive.usage_events
       WHERE project_id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid
       ORDER BY occurred_at, id`,
      [projectId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows.map(mapUsage);
  }

  async summarizeUsage(
    context: TrustedOrganizationContext,
    projectId: string,
  ): Promise<readonly UsageSummary[]> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<SummaryRow>(
      `SELECT
         usage_code,
         unit_code,
         cycle_id,
         sum(CASE WHEN event_kind = 'DEBIT' THEN quantity ELSE 0 END)::text
           AS debited_quantity,
         sum(CASE WHEN event_kind = 'CREDIT' THEN quantity ELSE 0 END)::text
           AS credited_quantity,
         sum(CASE WHEN event_kind = 'DEBIT' THEN quantity ELSE -quantity END)::text
           AS net_quantity
       FROM hive.usage_events
       WHERE project_id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid
       GROUP BY usage_code, unit_code, cycle_id
       ORDER BY usage_code, unit_code, cycle_id NULLS FIRST`,
      [projectId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows.map((row) => ({
      usageCode: row.usage_code,
      unitCode: row.unit_code,
      cycleId: row.cycle_id,
      debitedQuantity: row.debited_quantity,
      creditedQuantity: row.credited_quantity,
      netQuantity: row.net_quantity,
    }));
  }

  async reserveCost(
    context: TrustedOrganizationContext,
    input: ValidatedReserveCostInput,
  ): Promise<CostGuardReservationResult> {
    await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<{ decision_id: string }>(
        `SELECT hive.reserve_project_cost(
           $1::uuid, $2::uuid, $3::text, $4::text, $5::numeric, $6::text, $7::jsonb
         )::text AS decision_id`,
        [
          input.projectId,
          input.budgetId,
          input.operationId,
          input.capabilityCode,
          input.estimatedAmount,
          input.currency,
          JSON.stringify(input.metadata),
        ],
      );
      const decisionId = result.rows[0]?.decision_id;
      if (!decisionId) throw new Error('Cost Guard function returned no decision');
      const decision = await this.#getCostGuardDecision(context, decisionId);
      if (!decision) throw new Error('Cost Guard decision was not found');
      const reservation = decision.reservationId
        ? await this.#getCostReservation(context, decision.reservationId)
        : null;
      if (decision.reservationId && !reservation) {
        throw new Error('Cost Guard reservation was not found');
      }
      return { decision, reservation };
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }

  async consumeCostReservation(
    context: TrustedOrganizationContext,
    input: ValidatedConsumeCostReservationInput,
  ): Promise<CostReservation> {
    await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<{ reservation_id: string }>(
        `SELECT hive.consume_cost_reservation(
           $1::uuid, $2::numeric, $3::text, $4::text, $5::text,
           $6::timestamptz, $7::jsonb
         )::text AS reservation_id`,
        [
          input.reservationId,
          input.actualAmount,
          input.providerCode,
          input.serviceCode,
          input.modelCode,
          input.occurredAt,
          JSON.stringify(input.metadata),
        ],
      );
      const reservationId = result.rows[0]?.reservation_id;
      if (!reservationId) throw new Error('Cost Guard consume returned no reservation');
      const reservation = await this.#getCostReservation(context, reservationId);
      if (!reservation) throw new Error('Consumed Cost Guard reservation was not found');
      return reservation;
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }

  async releaseCostReservation(
    context: TrustedOrganizationContext,
    input: ValidatedReleaseCostReservationInput,
  ): Promise<CostReservation> {
    await this.#assertAuthority(context);
    try {
      const result = await this.#database.query<{ reservation_id: string }>(
        `SELECT hive.release_cost_reservation($1::uuid, $2::jsonb)::text AS reservation_id`,
        [input.reservationId, JSON.stringify(input.metadata)],
      );
      const reservationId = result.rows[0]?.reservation_id;
      if (!reservationId) throw new Error('Cost Guard release returned no reservation');
      const reservation = await this.#getCostReservation(context, reservationId);
      if (!reservation) throw new Error('Released Cost Guard reservation was not found');
      return reservation;
    } catch (error) {
      mapKnownDatabaseError(error);
    }
  }

  async #getBudget(
    context: TrustedOrganizationContext,
    budgetId: string,
  ): Promise<UsageBudget | null> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<BudgetRow>(
      `SELECT ${BUDGET_COLUMNS}
       FROM hive.usage_budgets
       WHERE id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid`,
      [budgetId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows[0] ? mapBudget(result.rows[0]) : null;
  }

  async #getUsage(
    context: TrustedOrganizationContext,
    eventId: string,
  ): Promise<UsageEvent | null> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<UsageRow>(
      `SELECT ${USAGE_COLUMNS}
       FROM hive.usage_events
       WHERE id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid`,
      [eventId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows[0] ? mapUsage(result.rows[0]) : null;
  }

  async #getCost(
    context: TrustedOrganizationContext,
    eventId: string,
  ): Promise<CostEvent | null> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<CostRow>(
      `SELECT ${COST_COLUMNS}
       FROM hive.cost_events
       WHERE id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid`,
      [eventId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows[0] ? mapCost(result.rows[0]) : null;
  }

  async #getCostGuardDecision(
    context: TrustedOrganizationContext,
    decisionId: string,
  ): Promise<CostGuardDecision | null> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<CostGuardDecisionRow>(
      `SELECT ${COST_GUARD_DECISION_COLUMNS}
       FROM hive.cost_guard_decisions
       WHERE id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid`,
      [decisionId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows[0] ? mapCostGuardDecision(result.rows[0]) : null;
  }

  async #getCostReservation(
    context: TrustedOrganizationContext,
    reservationId: string,
  ): Promise<CostReservation | null> {
    const authority = await this.#assertAuthority(context);
    const result = await this.#database.query<CostReservationRow>(
      `SELECT ${COST_RESERVATION_COLUMNS}
       FROM hive.cost_guard_reservations
       WHERE id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid`,
      [reservationId, context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows[0] ? mapCostReservation(result.rows[0]) : null;
  }

  async #assertAuthority(context: TrustedOrganizationContext): Promise<AuthorityRow> {
    const result = await this.#database.query<AuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         hive.current_app_id()::text AS app_id,
         hive.current_organization_id()::text AS organization_id,
         hive.has_trusted_organization_context() AS trusted,
         hive.is_platform_admin() AS is_platform_admin`,
    );
    const authority = result.rows[0];
    if (
      !authority?.trusted
      || authority.is_platform_admin
      || authority.user_id !== context.userId
      || authority.app_code !== context.appCode
      || authority.organization_id !== context.organizationId
      || !authority.app_id
    ) {
      throw new UsageCostError('USAGE_COST_ACCESS_DENIED');
    }
    return authority;
  }
}
