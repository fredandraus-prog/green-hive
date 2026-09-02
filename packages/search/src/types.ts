import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import type {
  CostGuardReservationResult,
  ReserveCostInput,
} from '@green-hive/cost-guard';
import type {
  DataClassification,
  TrustPolicyEvaluation,
  TrustPolicyEvaluationInput,
  TrustSanitizationMode,
} from '@green-hive/trust';

export const SEARCH_CONTENT_TRUST = 'UNTRUSTED_EXTERNAL_DATA' as const;
export type SearchContentTrust = typeof SEARCH_CONTENT_TRUST;

export interface SearchProviderRequest {
  /** App-owned idempotency identity. It must never contain query content. */
  readonly operationId: string;
  /** Minimal provider query after any server-owned Trust sanitization. */
  readonly query: string;
  readonly maxResults: number;
}

export interface SearchResult {
  readonly rank: number;
  readonly title: string;
  readonly url: string;
  readonly snippet: string | null;
}

export interface SearchProviderUsage {
  /** One invocation of SearchProvider.search always represents one physical provider request. */
  readonly requestCount: 1;
  readonly resultCount: number;
}

export interface SearchGatewayUsage {
  /** Total physical provider requests, including retry attempts. */
  readonly requestCount: number;
  readonly resultCount: number;
}

export interface SearchProviderResult {
  readonly providerCode: string;
  readonly contentTrust: SearchContentTrust;
  readonly results: readonly SearchResult[];
  readonly usage: SearchProviderUsage;
}

export interface SearchProvider {
  readonly providerCode: string;
  search(request: SearchProviderRequest): Promise<SearchProviderResult>;
}

export const FAKE_SEARCH_FAILURE_MODES = [
  'NONE',
  'UNAVAILABLE',
  'TIMEOUT',
  'FAILED',
] as const;
export type FakeSearchFailureMode = (typeof FAKE_SEARCH_FAILURE_MODES)[number];

export interface FakeSearchProviderOptions {
  readonly results?: readonly SearchResult[];
  readonly failureMode?: FakeSearchFailureMode;
}

export const SEARCH_CACHE_POLICIES = ['NONE', 'PROJECT_SCOPED', 'PUBLIC_SAFE'] as const;
export type SearchCachePolicy = (typeof SEARCH_CACHE_POLICIES)[number];

export const SEARCH_RETRYABLE_PROVIDER_ERRORS = ['UNAVAILABLE', 'TIMEOUT'] as const;
export type SearchRetryableProviderError = (typeof SEARCH_RETRYABLE_PROVIDER_ERRORS)[number];

export const SEARCH_OPERATION_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type SearchOperationStatus = (typeof SEARCH_OPERATION_STATUSES)[number];

export const SEARCH_CACHE_STATUSES = ['NOT_APPLICABLE', 'MISS', 'HIT'] as const;
export type SearchCacheStatus = (typeof SEARCH_CACHE_STATUSES)[number];

export interface SearchRetryPolicy {
  readonly maxAttempts: number;
  readonly retryableProviderErrors: readonly SearchRetryableProviderError[];
}

export interface SearchSanitizerRegistration {
  readonly mode: TrustSanitizationMode;
  sanitize(query: string): string;
}

export interface SearchTaskRegistration {
  readonly searchType: string;
  readonly sensitivityMax: DataClassification;
  readonly preferredProviderClass: string;
  readonly maxQueryCharacters: number;
  readonly maxResults: number;
  readonly costBudgetType: 'SEARCH';
  readonly cachePolicy: SearchCachePolicy;
  readonly retryPolicy: SearchRetryPolicy;
  /** Server-owned entitlement capability; never accepted in execute input. */
  readonly capabilityCode: string;
  readonly sanitizer?: SearchSanitizerRegistration;
}

export interface SearchProviderRegistration {
  readonly providerClass: string;
  readonly providerCode: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly maxResults: number;
  /** Exact decimal cost charged once per provider request. */
  readonly requestCost: string;
  /** Exact decimal cost charged for each normalized result. */
  readonly resultCost: string;
  readonly currency: string;
}

export interface SearchGatewayConfiguration {
  readonly configurationRelease: string;
  readonly providers: readonly SearchProvider[];
  readonly registrations: readonly SearchProviderRegistration[];
  readonly tasks: readonly SearchTaskRegistration[];
}

export interface SearchExecuteInput {
  readonly projectId: string;
  readonly budgetId: string;
  readonly operationId: string;
  readonly searchType: string;
  readonly query: string;
  readonly classification: DataClassification;
  readonly confidentialMode?: boolean;
}

export interface ValidatedSearchExecuteInput {
  readonly projectId: string;
  readonly budgetId: string;
  readonly operationId: string;
  readonly searchType: string;
  readonly query: string;
  readonly classification: DataClassification;
  readonly confidentialMode: boolean;
}

export interface SearchGatewayCostSummary {
  readonly reservationId: string;
  readonly estimatedAmount: string;
  readonly actualAmount: string;
  readonly currency: string;
}

export interface SearchGatewayResult {
  readonly operationId: string;
  readonly searchType: string;
  readonly providerCode: string;
  readonly contentTrust: SearchContentTrust;
  readonly cacheStatus: SearchCacheStatus;
  readonly results: readonly SearchResult[];
  readonly usage: SearchGatewayUsage;
  readonly trust: Pick<
    TrustPolicyEvaluation,
    'configurationRelease' | 'policyCode' | 'decision' | 'sanitizationMode'
  >;
  readonly cost: SearchGatewayCostSummary;
}

export interface SearchCostGuardPort {
  reserve(context: TrustedAppContext, input: ReserveCostInput): Promise<CostGuardReservationResult>;
}

export interface SearchTrustPolicyPort {
  evaluate(context: TrustedAppContext, input: TrustPolicyEvaluationInput): TrustPolicyEvaluation;
}

export interface SearchOperationStartInput {
  readonly projectId: string;
  readonly operationId: string;
  readonly searchType: string;
  readonly capabilityCode: string;
  readonly classification: DataClassification;
  readonly providerCode: string;
  readonly trustPolicyCode: string;
  readonly trustDecision: TrustPolicyEvaluation['decision'];
  readonly sanitizationMode: TrustSanitizationMode | null;
  readonly maxResults: number;
  readonly cacheStatus: SearchCacheStatus;
  readonly estimatedCost: string;
  readonly currency: string;
  readonly requestFingerprint: string;
}

export interface SearchOperationCompleteInput {
  readonly operationId: string;
  readonly reservationId: string;
  readonly resultCount: number;
  readonly requestCount: number;
  readonly actualCost: string;
  readonly cacheStatus: SearchCacheStatus;
}

export interface SearchOperationFailInput {
  readonly operationId: string;
  /** Present only after a successful Cost Guard reservation; failure and release then share one transaction. */
  readonly reservationId?: string | null;
  readonly errorCode: string;
}

export interface SearchOperationRepository {
  start(context: TrustedOrganizationContext, input: SearchOperationStartInput): Promise<void>;
  complete(context: TrustedOrganizationContext, input: SearchOperationCompleteInput): Promise<void>;
  fail(context: TrustedOrganizationContext, input: SearchOperationFailInput): Promise<void>;
}

export interface SearchGatewayDependencies {
  readonly trustPolicy: SearchTrustPolicyPort;
  readonly costGuard: SearchCostGuardPort;
  readonly operations: SearchOperationRepository;
}

export interface SearchSqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface SearchSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<SearchSqlResult<Row>>;
}
