export * from './app-manifest.js';
export * from './errors.js';

export const GREEN_HIVE_VERSION = '0.10.0' as const;

export const PLATFORM_ROLES = ['PLATFORM_ADMIN'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Authorization context obtained only from a verified server-side session or
 * signed JWT. Client-provided headers, form fields and query strings are not
 * valid sources for this contract.
 */
export interface TrustedAppContext {
  readonly userId: string;
  readonly appCode: string;
  readonly organizationId?: string;
  readonly platformRole?: PlatformRole;
}

export interface TrustedOrganizationContext extends TrustedAppContext {
  readonly organizationId: string;
}
