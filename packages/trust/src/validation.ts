import type { TrustedAppContext } from '@green-hive/core';
import { DEFAULT_TRUST_POLICIES } from './defaults.js';
import { TrustError } from './errors.js';
import {
  DATA_CLASSIFICATIONS,
  TRUST_CONFIDENTIAL_MODE_REQUIREMENTS,
  TRUST_DECISIONS,
  TRUST_OPERATIONS,
  TRUST_SANITIZATION_MODES,
  type DataClassification,
  type TrustConfidentialModeRequirement,
  type TrustDecision,
  type TrustOperation,
  type TrustPolicyEvaluationInput,
  type TrustPolicyOverride,
  type TrustPolicyServiceOptions,
  type TrustSanitizationMode,
  type ValidatedTrustPolicyEvaluationInput,
  type ValidatedTrustPolicyServiceOptions,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const RELEASE_CODE = /^[A-Z][A-Z0-9_.:-]{2,127}$/;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const INPUT_KEYS = new Set([
  'projectId',
  'operation',
  'classification',
  'providerCode',
  'confidentialMode',
]);
const OPTIONS_KEYS = new Set(['configurationRelease', 'policyOverrides']);
const OVERRIDE_KEYS = new Set([
  'policyCode',
  'classification',
  'operation',
  'decision',
  'sanitizationMode',
  'providerCode',
  'confidentialMode',
]);
const RESERVED_POLICY_CODES = new Set([
  'TRUST_DEFAULT_DENY',
  ...DEFAULT_TRUST_POLICIES.map((policy) => policy.policyCode),
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  errorCode: 'TRUST_INVALID_INPUT' | 'TRUST_INVALID_POLICY',
): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TrustError(errorCode);
  }
  return value;
}

function validatePolicyShape(
  value: Record<string, unknown>,
): Omit<TrustPolicyOverride, 'providerCode' | 'confidentialMode'> {
  if (
    typeof value.policyCode !== 'string'
    || !CODE.test(value.policyCode)
    || !DATA_CLASSIFICATIONS.includes(value.classification as DataClassification)
    || !TRUST_OPERATIONS.includes(value.operation as TrustOperation)
    || !TRUST_DECISIONS.includes(value.decision as TrustDecision)
  ) {
    throw new TrustError('TRUST_INVALID_POLICY');
  }
  const decision = value.decision as TrustDecision;
  const sanitizationMode = value.sanitizationMode;
  if (
    (decision === 'ALLOW_WITH_SANITIZATION'
      && !TRUST_SANITIZATION_MODES.includes(sanitizationMode as TrustSanitizationMode))
    || (decision !== 'ALLOW_WITH_SANITIZATION' && sanitizationMode !== undefined)
  ) {
    throw new TrustError('TRUST_INVALID_POLICY');
  }
  return {
    policyCode: value.policyCode,
    classification: value.classification as DataClassification,
    operation: value.operation as TrustOperation,
    decision,
    ...(sanitizationMode === undefined
      ? {}
      : { sanitizationMode: sanitizationMode as TrustSanitizationMode }),
  };
}

export function validateTrustedTrustContext(value: unknown): TrustedAppContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new TrustError('TRUST_ACCESS_DENIED');
  }
  if (
    typeof value.userId !== 'string'
    || !UUID.test(value.userId)
    || typeof value.appCode !== 'string'
    || !APP_CODE.test(value.appCode)
    || (value.organizationId !== undefined
      && (typeof value.organizationId !== 'string' || !UUID.test(value.organizationId)))
    || (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN')
  ) {
    throw new TrustError('TRUST_ACCESS_DENIED');
  }
  return {
    userId: value.userId.toLowerCase(),
    appCode: value.appCode,
    ...(value.organizationId === undefined
      ? {}
      : { organizationId: (value.organizationId as string).toLowerCase() }),
    ...(value.platformRole === undefined ? {} : { platformRole: value.platformRole }),
  };
}

export function validateTrustPolicyEvaluationInput(
  input: TrustPolicyEvaluationInput,
): ValidatedTrustPolicyEvaluationInput {
  const value = onlyKeys(input, INPUT_KEYS, 'TRUST_INVALID_INPUT');
  if (
    !TRUST_OPERATIONS.includes(value.operation as TrustOperation)
    || !DATA_CLASSIFICATIONS.includes(value.classification as DataClassification)
    || (value.projectId !== undefined
      && (typeof value.projectId !== 'string' || !UUID.test(value.projectId)))
    || (value.confidentialMode !== undefined && typeof value.confidentialMode !== 'boolean')
  ) {
    throw new TrustError('TRUST_INVALID_INPUT');
  }
  const operation = value.operation as TrustOperation;
  const requiresProvider = operation === 'EXTERNAL_PROVIDER' || operation === 'SEARCH_QUERY';
  if (
    (requiresProvider
      && (typeof value.providerCode !== 'string' || !CODE.test(value.providerCode)))
    || (!requiresProvider && value.providerCode !== undefined)
  ) {
    throw new TrustError('TRUST_INVALID_INPUT');
  }
  return {
    projectId: value.projectId === undefined ? null : (value.projectId as string).toLowerCase(),
    operation,
    classification: value.classification as DataClassification,
    providerCode: value.providerCode === undefined ? null : value.providerCode as string,
    confidentialMode: value.confidentialMode === true,
  };
}

export function validateTrustPolicyServiceOptions(
  options: TrustPolicyServiceOptions,
): ValidatedTrustPolicyServiceOptions {
  const value = onlyKeys(options, OPTIONS_KEYS, 'TRUST_INVALID_POLICY');
  if (
    typeof value.configurationRelease !== 'string'
    || !RELEASE_CODE.test(value.configurationRelease)
    || (value.policyOverrides !== undefined && !Array.isArray(value.policyOverrides))
  ) {
    throw new TrustError('TRUST_INVALID_POLICY');
  }
  const rawOverrides = value.policyOverrides === undefined
    ? []
    : value.policyOverrides as readonly unknown[];
  if (rawOverrides.length > 128) throw new TrustError('TRUST_INVALID_POLICY');
  const keys = new Set<string>();
  const policyCodes = new Set<string>();
  const policyOverrides = rawOverrides.map((raw): TrustPolicyOverride => {
    const override = onlyKeys(raw, OVERRIDE_KEYS, 'TRUST_INVALID_POLICY');
    const policy = validatePolicyShape(override);
    if (
      RESERVED_POLICY_CODES.has(policy.policyCode)
      ||
      typeof override.providerCode !== 'string'
      || !CODE.test(override.providerCode)
      || !TRUST_CONFIDENTIAL_MODE_REQUIREMENTS.includes(
        override.confidentialMode as TrustConfidentialModeRequirement,
      )
      || policy.operation === 'LOG'
    ) {
      throw new TrustError('TRUST_INVALID_POLICY');
    }
    const confidentialMode = override.confidentialMode as TrustConfidentialModeRequirement;
    if (
      policy.classification === 'HIGHLY_CONFIDENTIAL'
      && (
        (policy.decision !== 'DENY' && policy.decision !== 'REQUIRE_CONFIRMATION')
        || (policy.decision === 'REQUIRE_CONFIRMATION' && confidentialMode !== 'REQUIRED')
      )
    ) {
      throw new TrustError('TRUST_INVALID_POLICY');
    }
    const key = [
      policy.classification,
      policy.operation,
      override.providerCode,
      confidentialMode,
    ].join(':');
    if (keys.has(key) || policyCodes.has(policy.policyCode)) {
      throw new TrustError('TRUST_INVALID_POLICY');
    }
    keys.add(key);
    policyCodes.add(policy.policyCode);
    return Object.freeze({
      ...policy,
      providerCode: override.providerCode,
      confidentialMode,
    });
  });
  return {
    configurationRelease: value.configurationRelease,
    policyOverrides: Object.freeze(policyOverrides),
  };
}
