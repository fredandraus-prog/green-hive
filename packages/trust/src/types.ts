export const DATA_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'HIGHLY_CONFIDENTIAL',
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const EXTERNAL_PROCESSING_DEFAULTS = [
  'ALLOW',
  'MINIMIZE',
  'DENY_OR_EXPLICIT_POLICY',
] as const;
export type ExternalProcessingDefault = (typeof EXTERNAL_PROCESSING_DEFAULTS)[number];

export interface DataClassificationDefinition {
  readonly classification: DataClassification;
  readonly externalProcessingDefault: ExternalProcessingDefault;
  readonly description: string;
}

export const TRUST_OPERATIONS = ['EXTERNAL_PROVIDER', 'SEARCH_QUERY', 'LOG'] as const;
export type TrustOperation = (typeof TRUST_OPERATIONS)[number];

export const TRUST_DECISIONS = [
  'ALLOW',
  'ALLOW_WITH_SANITIZATION',
  'REQUIRE_CONFIRMATION',
  'DENY',
] as const;
export type TrustDecision = (typeof TRUST_DECISIONS)[number];

export const TRUST_REQUIRED_ACTIONS = ['PROCESS', 'SANITIZE', 'CONFIRM', 'BLOCK'] as const;
export type TrustRequiredAction = (typeof TRUST_REQUIRED_ACTIONS)[number];

export const TRUST_SANITIZATION_MODES = [
  'MINIMIZE_CONTEXT',
  'ABSTRACT_QUERY',
  'METADATA_ONLY',
] as const;
export type TrustSanitizationMode = (typeof TRUST_SANITIZATION_MODES)[number];

export const TRUST_CONFIDENTIAL_MODE_REQUIREMENTS = [
  'ANY',
  'REQUIRED',
  'DISABLED',
] as const;
export type TrustConfidentialModeRequirement =
  (typeof TRUST_CONFIDENTIAL_MODE_REQUIREMENTS)[number];

export const TRUST_REASON_CODES = [
  'POLICY_ALLOW',
  'SANITIZATION_REQUIRED',
  'EXPLICIT_CONFIRMATION_REQUIRED',
  'POLICY_DENY',
  'POLICY_NOT_CONFIGURED',
] as const;
export type TrustReasonCode = (typeof TRUST_REASON_CODES)[number];

export interface TrustPolicyEvaluationInput {
  /** Optional resource identity only. Project authorization remains a service/API responsibility. */
  readonly projectId?: string;
  readonly operation: TrustOperation;
  readonly classification: DataClassification;
  /** Selected only by trusted server-side routing, never by browser input. */
  readonly providerCode?: string;
  /** A trusted app capability flag; it never relaxes policy by itself. */
  readonly confidentialMode?: boolean;
}

export interface ValidatedTrustPolicyEvaluationInput {
  readonly projectId: string | null;
  readonly operation: TrustOperation;
  readonly classification: DataClassification;
  readonly providerCode: string | null;
  readonly confidentialMode: boolean;
}

export interface TrustPolicyDefinition {
  readonly policyCode: string;
  readonly classification: DataClassification;
  readonly operation: TrustOperation;
  readonly decision: TrustDecision;
  readonly sanitizationMode?: TrustSanitizationMode;
}

export interface TrustPolicyOverride extends TrustPolicyDefinition {
  /** Overrides are deliberately provider-specific and cannot replace the global defaults. */
  readonly providerCode: string;
  readonly confidentialMode: TrustConfidentialModeRequirement;
}

export interface TrustPolicyServiceOptions {
  readonly configurationRelease: string;
  readonly policyOverrides?: readonly TrustPolicyOverride[];
}

export interface ValidatedTrustPolicyServiceOptions {
  readonly configurationRelease: string;
  readonly policyOverrides: readonly TrustPolicyOverride[];
}

export interface TrustPolicyEvaluation {
  readonly configurationRelease: string;
  readonly policyCode: string;
  readonly projectId: string | null;
  readonly operation: TrustOperation;
  readonly classification: DataClassification;
  readonly providerCode: string | null;
  readonly confidentialMode: boolean;
  readonly decision: TrustDecision;
  readonly requiredAction: TrustRequiredAction;
  readonly sanitizationMode: TrustSanitizationMode | null;
  readonly reasonCode: TrustReasonCode;
}
