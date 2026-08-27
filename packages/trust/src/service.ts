import type { TrustedAppContext } from '@green-hive/core';
import { DEFAULT_TRUST_POLICIES } from './defaults.js';
import { TrustError } from './errors.js';
import type {
  TrustPolicyDefinition,
  TrustPolicyEvaluation,
  TrustPolicyEvaluationInput,
  TrustPolicyOverride,
  TrustPolicyServiceOptions,
  TrustReasonCode,
  TrustRequiredAction,
} from './types.js';
import {
  validateTrustedTrustContext,
  validateTrustPolicyEvaluationInput,
  validateTrustPolicyServiceOptions,
} from './validation.js';

function defaultPolicyKey(policy: Pick<TrustPolicyDefinition, 'classification' | 'operation'>): string {
  return `${policy.classification}:${policy.operation}`;
}

function matchesConfidentialMode(
  policy: TrustPolicyOverride,
  confidentialMode: boolean,
): boolean {
  return policy.confidentialMode === 'ANY'
    || (policy.confidentialMode === 'REQUIRED' && confidentialMode)
    || (policy.confidentialMode === 'DISABLED' && !confidentialMode);
}

function decisionContract(policy: TrustPolicyDefinition): {
  readonly requiredAction: TrustRequiredAction;
  readonly reasonCode: TrustReasonCode;
} {
  if (policy.decision === 'ALLOW') {
    return { requiredAction: 'PROCESS', reasonCode: 'POLICY_ALLOW' };
  }
  if (policy.decision === 'ALLOW_WITH_SANITIZATION') {
    return { requiredAction: 'SANITIZE', reasonCode: 'SANITIZATION_REQUIRED' };
  }
  if (policy.decision === 'REQUIRE_CONFIRMATION') {
    return { requiredAction: 'CONFIRM', reasonCode: 'EXPLICIT_CONFIRMATION_REQUIRED' };
  }
  return { requiredAction: 'BLOCK', reasonCode: 'POLICY_DENY' };
}

export class TrustPolicyService {
  readonly #configurationRelease: string;
  readonly #defaultPolicies: ReadonlyMap<string, TrustPolicyDefinition>;
  readonly #policyOverrides: readonly TrustPolicyOverride[];

  constructor(options: TrustPolicyServiceOptions) {
    const validated = validateTrustPolicyServiceOptions(options);
    this.#configurationRelease = validated.configurationRelease;
    this.#policyOverrides = validated.policyOverrides;
    this.#defaultPolicies = new Map(
      DEFAULT_TRUST_POLICIES.map((policy) => [defaultPolicyKey(policy), policy]),
    );
  }

  evaluate(
    context: TrustedAppContext,
    input: TrustPolicyEvaluationInput,
  ): TrustPolicyEvaluation {
    const trustedContext = validateTrustedTrustContext(context);
    if (trustedContext.platformRole === 'PLATFORM_ADMIN') {
      throw new TrustError('TRUST_ACCESS_DENIED');
    }
    const validated = validateTrustPolicyEvaluationInput(input);
    const matchingOverrides = this.#policyOverrides.filter((policy) => (
      policy.classification === validated.classification
      && policy.operation === validated.operation
      && policy.providerCode === validated.providerCode
      && matchesConfidentialMode(policy, validated.confidentialMode)
    ));
    const override = matchingOverrides.find((policy) => policy.confidentialMode !== 'ANY')
      ?? matchingOverrides.find((policy) => policy.confidentialMode === 'ANY');
    const policy = override ?? this.#defaultPolicies.get(defaultPolicyKey(validated));
    if (!policy) {
      return Object.freeze({
        configurationRelease: this.#configurationRelease,
        policyCode: 'TRUST_DEFAULT_DENY',
        ...validated,
        decision: 'DENY',
        requiredAction: 'BLOCK',
        sanitizationMode: null,
        reasonCode: 'POLICY_NOT_CONFIGURED',
      });
    }
    const contract = decisionContract(policy);
    return Object.freeze({
      configurationRelease: this.#configurationRelease,
      policyCode: policy.policyCode,
      ...validated,
      decision: policy.decision,
      ...contract,
      sanitizationMode: policy.sanitizationMode ?? null,
    });
  }
}
