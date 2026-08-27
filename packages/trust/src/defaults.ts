import type { DataClassificationDefinition, TrustPolicyDefinition } from './types.js';

export const DEFAULT_TRUST_CONFIGURATION_RELEASE = 'GREEN_HIVE_TRUST_V1' as const;

export const DATA_CLASSIFICATION_DEFINITIONS: readonly DataClassificationDefinition[] =
  Object.freeze([
    Object.freeze({
      classification: 'PUBLIC',
      externalProcessingDefault: 'ALLOW',
      description: 'Intentionally public information',
    }),
    Object.freeze({
      classification: 'INTERNAL',
      externalProcessingDefault: 'ALLOW',
      description: 'Low-sensitivity platform metadata',
    }),
    Object.freeze({
      classification: 'CONFIDENTIAL',
      externalProcessingDefault: 'MINIMIZE',
      description: 'Private user, application or project information',
    }),
    Object.freeze({
      classification: 'HIGHLY_CONFIDENTIAL',
      externalProcessingDefault: 'DENY_OR_EXPLICIT_POLICY',
      description: 'Exceptionally sensitive data requiring strict policy',
    }),
  ]);

export const DEFAULT_TRUST_POLICIES: readonly TrustPolicyDefinition[] = Object.freeze([
  Object.freeze({
    policyCode: 'TRUST_PUBLIC_EXTERNAL',
    classification: 'PUBLIC',
    operation: 'EXTERNAL_PROVIDER',
    decision: 'ALLOW',
  }),
  Object.freeze({
    policyCode: 'TRUST_INTERNAL_EXTERNAL',
    classification: 'INTERNAL',
    operation: 'EXTERNAL_PROVIDER',
    decision: 'ALLOW',
  }),
  Object.freeze({
    policyCode: 'TRUST_CONF_EXTERNAL',
    classification: 'CONFIDENTIAL',
    operation: 'EXTERNAL_PROVIDER',
    decision: 'ALLOW_WITH_SANITIZATION',
    sanitizationMode: 'MINIMIZE_CONTEXT',
  }),
  Object.freeze({
    policyCode: 'TRUST_HIGH_EXTERNAL',
    classification: 'HIGHLY_CONFIDENTIAL',
    operation: 'EXTERNAL_PROVIDER',
    decision: 'DENY',
  }),
  Object.freeze({
    policyCode: 'TRUST_CONF_SEARCH',
    classification: 'CONFIDENTIAL',
    operation: 'SEARCH_QUERY',
    decision: 'ALLOW_WITH_SANITIZATION',
    sanitizationMode: 'ABSTRACT_QUERY',
  }),
  Object.freeze({
    policyCode: 'TRUST_HIGH_SEARCH',
    classification: 'HIGHLY_CONFIDENTIAL',
    operation: 'SEARCH_QUERY',
    decision: 'DENY',
  }),
  Object.freeze({
    policyCode: 'TRUST_PUBLIC_LOG',
    classification: 'PUBLIC',
    operation: 'LOG',
    decision: 'ALLOW',
  }),
  Object.freeze({
    policyCode: 'TRUST_CONF_LOG',
    classification: 'CONFIDENTIAL',
    operation: 'LOG',
    decision: 'ALLOW_WITH_SANITIZATION',
    sanitizationMode: 'METADATA_ONLY',
  }),
]);
