import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import type {
  CostGuardReservationResult,
  CostReservation,
  ReserveCostInput,
  ConsumeCostReservationInput,
  ReleaseCostReservationInput,
  RecordUsageEventInput,
  UsageEvent,
} from '@green-hive/cost-guard';
import type {
  DataClassification,
  TrustPolicyEvaluation,
  TrustPolicyEvaluationInput,
  TrustSanitizationMode,
} from '@green-hive/trust';
import type {
  AIFinishReason,
  AIJsonValue,
  AIOutputMode,
  AIProvider,
  AIProviderUsage,
} from './types.js';

export const AI_CACHE_POLICIES = ['NONE', 'PROJECT_SCOPED', 'PUBLIC_SAFE'] as const;
export type AICachePolicy = (typeof AI_CACHE_POLICIES)[number];

export const AI_RETRYABLE_PROVIDER_ERRORS = ['UNAVAILABLE', 'TIMEOUT'] as const;
export type AIRetryableProviderError = (typeof AI_RETRYABLE_PROVIDER_ERRORS)[number];

export const AI_OPERATION_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type AIOperationStatus = (typeof AI_OPERATION_STATUSES)[number];

export interface AIRetryPolicy {
  readonly maxAttempts: number;
  readonly retryableProviderErrors: readonly AIRetryableProviderError[];
}

export interface AISanitizerRegistration {
  readonly mode: TrustSanitizationMode;
  sanitize(input: string): string;
}

export interface AIOutputSchemaRegistration {
  readonly schemaId: string;
  /** Application-owned runtime validator. It must return a JSON-compatible isolated value. */
  validate(value: AIJsonValue): AIJsonValue;
}

export interface AITaskRegistration {
  readonly taskType: string;
  readonly outputMode: AIOutputMode;
  readonly outputSchemaId?: string;
  readonly sensitivityMax: DataClassification;
  readonly preferredModelClass: string;
  readonly maxInputTokensInternal: number;
  readonly maxOutputTokensInternal: number;
  readonly costBudgetType: 'AI';
  readonly cachePolicy: AICachePolicy;
  readonly retryPolicy: AIRetryPolicy;
  /** Server-owned entitlement capability; never accepted in execute input. */
  readonly capabilityCode: string;
  readonly sanitizer?: AISanitizerRegistration;
}

export interface AIModelRegistration {
  readonly modelClass: string;
  readonly providerCode: string;
  readonly modelCode: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  /**
   * Conservative server-owned allowance for provider instructions, structured-output
   * schemas and other request framing that is absent from the caller input. It is used
   * only while reserving cost; actual cost always uses provider-reported usage.
   */
  readonly inputTokenOverhead: number;
  /** Exact decimal cost per one thousand normalized tokens. */
  readonly inputCostPerThousandTokens: string;
  readonly outputCostPerThousandTokens: string;
  readonly currency: string;
}

export interface AIGatewayConfiguration {
  readonly configurationRelease: string;
  readonly providers: readonly AIProvider[];
  readonly models: readonly AIModelRegistration[];
  readonly tasks: readonly AITaskRegistration[];
  readonly schemas: readonly AIOutputSchemaRegistration[];
}

export interface AIExecuteInput {
  readonly projectId: string;
  readonly budgetId: string;
  readonly operationId: string;
  readonly taskType: string;
  readonly input: string;
  readonly classification: DataClassification;
  readonly confidentialMode?: boolean;
}

export interface ValidatedAIExecuteInput {
  readonly projectId: string;
  readonly budgetId: string;
  readonly operationId: string;
  readonly taskType: string;
  readonly input: string;
  readonly classification: DataClassification;
  readonly confidentialMode: boolean;
}

export interface AIGatewayCostSummary {
  readonly reservationId: string;
  readonly estimatedAmount: string;
  readonly actualAmount: string;
  readonly currency: string;
}

interface AIGatewayResultBase {
  readonly operationId: string;
  readonly taskType: string;
  readonly providerCode: string;
  readonly modelCode: string;
  readonly finishReason: AIFinishReason;
  readonly usage: AIProviderUsage;
  readonly trust: Pick<
    TrustPolicyEvaluation,
    'configurationRelease' | 'policyCode' | 'decision' | 'sanitizationMode'
  >;
  readonly cost: AIGatewayCostSummary;
}

export interface AITextGatewayResult extends AIGatewayResultBase {
  readonly outputMode: 'TEXT';
  readonly content: string;
}

export interface AIStructuredGatewayResult extends AIGatewayResultBase {
  readonly outputMode: 'STRUCTURED';
  readonly outputSchemaId: string;
  readonly value: AIJsonValue;
}

export type AIGatewayResult = AITextGatewayResult | AIStructuredGatewayResult;

export interface AICostGuardPort {
  reserve(context: TrustedAppContext, input: ReserveCostInput): Promise<CostGuardReservationResult>;
  consume(context: TrustedAppContext, input: ConsumeCostReservationInput): Promise<CostReservation>;
  release(context: TrustedAppContext, input: ReleaseCostReservationInput): Promise<CostReservation>;
}

export interface AIUsageCostPort {
  recordUsage(context: TrustedAppContext, input: RecordUsageEventInput): Promise<UsageEvent>;
}

export interface AITrustPolicyPort {
  evaluate(context: TrustedAppContext, input: TrustPolicyEvaluationInput): TrustPolicyEvaluation;
}

export interface AIOperationStartInput {
  readonly projectId: string;
  readonly operationId: string;
  readonly taskType: string;
  readonly outputMode: AIOutputMode;
  readonly outputSchemaId: string | null;
  readonly classification: DataClassification;
  readonly providerCode: string;
  readonly modelCode: string;
  readonly trustPolicyCode: string;
  readonly trustDecision: TrustPolicyEvaluation['decision'];
  readonly sanitizationMode: TrustSanitizationMode | null;
  readonly estimatedCost: string;
  readonly currency: string;
  readonly requestFingerprint: string;
}

export interface AIOperationCompleteInput {
  readonly operationId: string;
  readonly finishReason: AIFinishReason;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly actualCost: string;
}

export interface AIOperationFailInput {
  readonly operationId: string;
  readonly errorCode: string;
}

export interface AIOperationRepository {
  start(context: TrustedOrganizationContext, input: AIOperationStartInput): Promise<void>;
  complete(context: TrustedOrganizationContext, input: AIOperationCompleteInput): Promise<void>;
  fail(context: TrustedOrganizationContext, input: AIOperationFailInput): Promise<void>;
}

export interface AIGatewayDependencies {
  readonly trustPolicy: AITrustPolicyPort;
  readonly costGuard: AICostGuardPort;
  readonly usageCost: AIUsageCostPort;
  readonly operations: AIOperationRepository;
}

export interface AISqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface AISqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<AISqlResult<Row>>;
}
