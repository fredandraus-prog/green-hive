import type { AppManifestV1, TrustedAppContext } from '@green-hive/core';

/**
 * Deterministic, server-owned feature-flag evaluation. This package has no
 * database, browser, network or environment-variable dependency. A flag is a
 * product rollout control only; it must never make an authorization decision.
 */
export const FEATURE_FLAGS_STATUS = 'GH-0703' as const;

export const FEATURE_FLAG_STATES = ['OFF', 'INTERNAL', 'BETA', 'PUBLIC'] as const;
export type FeatureFlagState = (typeof FEATURE_FLAG_STATES)[number];

export interface FeatureFlagAudience {
  readonly userIds?: readonly string[];
  /** Organization ids are the stable workspace ids in the current platform model. */
  readonly organizationIds?: readonly string[];
}

export interface FeatureFlag {
  readonly code: string;
  readonly state: FeatureFlagState;
  readonly audience?: FeatureFlagAudience;
}

export type FeatureFlagDecisionReason =
  | 'PUBLIC'
  | 'INTERNAL_PLATFORM_ADMIN'
  | 'BETA_AUDIENCE'
  | 'KILL_SWITCH_OFF'
  | 'INTERNAL_ONLY'
  | 'BETA_AUDIENCE_REQUIRED'
  | 'APP_CONTEXT_MISMATCH'
  | 'FLAG_UNREGISTERED';

export interface FeatureFlagDecision {
  readonly code: string;
  readonly state: FeatureFlagState;
  readonly enabled: boolean;
  readonly reason: FeatureFlagDecisionReason;
}

export interface FeatureFlagAdminHook {
  /**
   * Lists the effective local configuration for a verified platform admin.
   * Persistent mutation is intentionally not part of GH-0703.
   */
  list(context: TrustedAppContext): readonly FeatureFlag[];
}

const STATES = new Set<string>(FEATURE_FLAG_STATES);

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueAudience(values: readonly string[] | undefined, label: string): readonly string[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values) || values.some((value) => !hasText(value))) {
    throw new FeatureFlagConfigurationError(`${label} must contain non-empty strings`);
  }
  const normalized = values.map((value) => value.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new FeatureFlagConfigurationError(`${label} must not contain duplicates`);
  }
  return Object.freeze(normalized);
}

function normalizeFlag(input: FeatureFlag, declaredCodes: ReadonlySet<string>): FeatureFlag {
  if (!hasText(input?.code) || !declaredCodes.has(input.code)) {
    throw new FeatureFlagConfigurationError(`flag code must be declared by the app manifest: ${String(input?.code)}`);
  }
  if (!STATES.has(input.state)) {
    throw new FeatureFlagConfigurationError(`flag ${input.code} has an invalid state`);
  }

  const userIds = uniqueAudience(input.audience?.userIds, `flag ${input.code} audience.userIds`);
  const organizationIds = uniqueAudience(input.audience?.organizationIds, `flag ${input.code} audience.organizationIds`);
  const audience = userIds !== undefined || organizationIds !== undefined
    ? Object.freeze({ ...(userIds !== undefined ? { userIds } : {}), ...(organizationIds !== undefined ? { organizationIds } : {}) })
    : undefined;
  return Object.freeze({ code: input.code, state: input.state, ...(audience ? { audience } : {}) });
}

function assertTrustedContext(context: TrustedAppContext): void {
  if (!hasText(context?.userId) || !hasText(context?.appCode)) {
    throw new FeatureFlagConfigurationError('feature-flag evaluation requires a verified app context');
  }
}

export class FeatureFlagConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureFlagConfigurationError';
  }
}

export class FeatureFlagRegistry {
  readonly #appCode: string;
  readonly #flags: ReadonlyMap<string, FeatureFlag>;

  constructor(manifest: AppManifestV1, flags: readonly FeatureFlag[]) {
    if (!manifest.requiredCapabilities.includes('FEATURE_FLAGS')) {
      throw new FeatureFlagConfigurationError(`app ${manifest.appCode} has not declared FEATURE_FLAGS capability`);
    }
    const declaredCodes = new Set(manifest.featureFlags);
    const normalized = new Map<string, FeatureFlag>();
    for (const flag of flags) {
      const value = normalizeFlag(flag, declaredCodes);
      if (normalized.has(value.code)) {
        throw new FeatureFlagConfigurationError(`duplicate feature-flag configuration: ${value.code}`);
      }
      normalized.set(value.code, value);
    }
    this.#appCode = manifest.appCode;
    this.#flags = normalized;
  }

  list(): readonly FeatureFlag[] {
    return Object.freeze([...this.#flags.values()]);
  }

  evaluate(context: TrustedAppContext, code: string): FeatureFlagDecision {
    assertTrustedContext(context);
    const flag = this.#flags.get(code);
    if (!flag) return Object.freeze({ code, state: 'OFF', enabled: false, reason: 'FLAG_UNREGISTERED' });
    if (context.appCode !== this.#appCode) {
      return Object.freeze({ code: flag.code, state: flag.state, enabled: false, reason: 'APP_CONTEXT_MISMATCH' });
    }
    if (flag.state === 'OFF') return Object.freeze({ code: flag.code, state: flag.state, enabled: false, reason: 'KILL_SWITCH_OFF' });
    if (flag.state === 'PUBLIC') return Object.freeze({ code: flag.code, state: flag.state, enabled: true, reason: 'PUBLIC' });
    if (flag.state === 'INTERNAL') {
      const enabled = context.platformRole === 'PLATFORM_ADMIN';
      return Object.freeze({ code: flag.code, state: flag.state, enabled, reason: enabled ? 'INTERNAL_PLATFORM_ADMIN' : 'INTERNAL_ONLY' });
    }
    const audience = flag.audience;
    const includedByUser = audience?.userIds?.includes(context.userId) ?? false;
    const includedByOrganization = context.organizationId !== undefined && (audience?.organizationIds?.includes(context.organizationId) ?? false);
    const enabled = includedByUser || includedByOrganization;
    return Object.freeze({ code: flag.code, state: flag.state, enabled, reason: enabled ? 'BETA_AUDIENCE' : 'BETA_AUDIENCE_REQUIRED' });
  }
}

export function createFeatureFlagAdminHook(registry: FeatureFlagRegistry): FeatureFlagAdminHook {
  return Object.freeze({
    list(context: TrustedAppContext): readonly FeatureFlag[] {
      assertTrustedContext(context);
      if (context.platformRole !== 'PLATFORM_ADMIN') {
        throw new FeatureFlagConfigurationError('platform-admin context is required to inspect feature-flag configuration');
      }
      return registry.list();
    },
  });
}

export function isFeatureEnabled(registry: FeatureFlagRegistry, context: TrustedAppContext, code: string): boolean {
  return registry.evaluate(context, code).enabled;
}
