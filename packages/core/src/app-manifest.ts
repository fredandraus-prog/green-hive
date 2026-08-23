import { HiveError } from './errors.js';

export const GREEN_HIVE_CAPABILITIES = [
  'AUTH',
  'PROJECTS',
  'BILLING',
  'ENTITLEMENTS',
  'COST_GUARD',
  'JOBS',
  'AI',
  'SEARCH',
  'FILES',
  'AUDIT',
  'I18N',
  'FEATURE_FLAGS',
  'NOTIFICATIONS',
  'UI',
] as const;

export type GreenHiveCapability = (typeof GREEN_HIVE_CAPABILITIES)[number];
export type AppStatus = 'INTERNAL' | 'BETA' | 'ACTIVE' | 'DISABLED';

export interface AppProductRegistration {
  readonly productCode: string;
  readonly productType:
    | 'ONE_TIME'
    | 'REANALYSIS_OR_REPROCESS'
    | 'SUBSCRIPTION'
    | 'INTERNAL_GRANT';
}

export interface AppRouteRegistration {
  readonly routeCode: string;
  readonly path: string;
}

export interface AppManifestV1 {
  readonly schemaVersion: 1;
  readonly appCode: string;
  readonly appName: string;
  readonly appVersion: string;
  readonly status: AppStatus;
  readonly projectNamespace: string;
  readonly supportedLocales: readonly string[];
  readonly defaultLocale: string;
  readonly requiredCapabilities: readonly GreenHiveCapability[];
  readonly products: readonly AppProductRegistration[];
  readonly entitlementCapabilities: readonly string[];
  readonly jobTypes: readonly string[];
  readonly aiTaskTypes: readonly string[];
  readonly featureFlags: readonly string[];
  readonly routes: readonly AppRouteRegistration[];
}

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const NAMESPACE = /^[a-z][a-z0-9-]{1,31}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$/;
const ROUTE = /^\/[A-Za-z0-9/_:.-]*$/;
const CAPABILITIES = new Set<string>(GREEN_HIVE_CAPABILITIES);
const STATUSES = new Set<string>(['INTERNAL', 'BETA', 'ACTIVE', 'DISABLED']);
const PRODUCT_TYPES = new Set<string>([
  'ONE_TIME',
  'REANALYSIS_OR_REPROCESS',
  'SUBSCRIPTION',
  'INTERNAL_GRANT',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}

function validateNamespacedCodes(label: string, value: unknown, appCode: string, errors: string[]): void {
  if (!isStringArray(value)) {
    errors.push(`${label} must be an array of strings`);
    return;
  }
  for (const code of value) {
    if (!CODE.test(code)) errors.push(`${label} contains invalid code: ${code}`);
    if (!code.startsWith(`${appCode}_`)) errors.push(`${label} code must be namespaced by ${appCode}_: ${code}`);
  }
  for (const duplicate of findDuplicates(value)) errors.push(`${label} contains duplicate code: ${duplicate}`);
}

export function validateAppManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { valid: false, errors: ['manifest must be an object'] };

  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1');

  const appCode = typeof input.appCode === 'string' ? input.appCode : '';
  if (!CODE.test(appCode)) errors.push('appCode must be an uppercase stable code');
  if (typeof input.appName !== 'string' || input.appName.trim().length < 2) errors.push('appName is required');
  if (typeof input.appVersion !== 'string' || !SEMVER.test(input.appVersion)) errors.push('appVersion must be semantic version x.y.z');
  if (typeof input.status !== 'string' || !STATUSES.has(input.status)) errors.push('status is invalid');
  if (typeof input.projectNamespace !== 'string' || !NAMESPACE.test(input.projectNamespace)) errors.push('projectNamespace is invalid');

  if (!isStringArray(input.supportedLocales) || input.supportedLocales.length === 0) {
    errors.push('supportedLocales must contain at least one locale');
  } else {
    for (const locale of input.supportedLocales) if (!LOCALE.test(locale)) errors.push(`invalid locale: ${locale}`);
    for (const duplicate of findDuplicates(input.supportedLocales)) errors.push(`duplicate locale: ${duplicate}`);
    if (typeof input.defaultLocale !== 'string' || !input.supportedLocales.includes(input.defaultLocale)) {
      errors.push('defaultLocale must be included in supportedLocales');
    }
  }

  if (!isStringArray(input.requiredCapabilities)) {
    errors.push('requiredCapabilities must be an array');
  } else {
    for (const capability of input.requiredCapabilities) {
      if (!CAPABILITIES.has(capability)) errors.push(`unsupported Green Hive capability: ${capability}`);
    }
    for (const duplicate of findDuplicates(input.requiredCapabilities)) errors.push(`duplicate capability: ${duplicate}`);
  }

  if (!Array.isArray(input.products)) {
    errors.push('products must be an array');
  } else {
    const productCodes: string[] = [];
    for (const product of input.products) {
      if (!isRecord(product)) {
        errors.push('product registration must be an object');
        continue;
      }
      const code = typeof product.productCode === 'string' ? product.productCode : '';
      productCodes.push(code);
      if (!CODE.test(code) || !code.startsWith(`${appCode}_`)) errors.push(`invalid/nonnamespaced productCode: ${code}`);
      if (typeof product.productType !== 'string' || !PRODUCT_TYPES.has(product.productType)) errors.push(`invalid productType for ${code}`);
    }
    for (const duplicate of findDuplicates(productCodes)) errors.push(`duplicate productCode: ${duplicate}`);
  }

  validateNamespacedCodes('entitlementCapabilities', input.entitlementCapabilities, appCode, errors);
  validateNamespacedCodes('jobTypes', input.jobTypes, appCode, errors);
  validateNamespacedCodes('aiTaskTypes', input.aiTaskTypes, appCode, errors);
  validateNamespacedCodes('featureFlags', input.featureFlags, appCode, errors);

  if (!Array.isArray(input.routes)) {
    errors.push('routes must be an array');
  } else {
    const routeCodes: string[] = [];
    const paths: string[] = [];
    for (const route of input.routes) {
      if (!isRecord(route)) {
        errors.push('route registration must be an object');
        continue;
      }
      const routeCode = typeof route.routeCode === 'string' ? route.routeCode : '';
      const routePath = typeof route.path === 'string' ? route.path : '';
      routeCodes.push(routeCode);
      paths.push(routePath);
      if (!CODE.test(routeCode) || !routeCode.startsWith(`${appCode}_`)) errors.push(`invalid/nonnamespaced routeCode: ${routeCode}`);
      if (!ROUTE.test(routePath)) errors.push(`invalid route path: ${routePath}`);
    }
    for (const duplicate of findDuplicates(routeCodes)) errors.push(`duplicate routeCode: ${duplicate}`);
    for (const duplicate of findDuplicates(paths)) errors.push(`duplicate route path: ${duplicate}`);
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidAppManifest(input: unknown): asserts input is AppManifestV1 {
  const result = validateAppManifest(input);
  if (!result.valid) {
    throw new HiveError('VALIDATION_FAILED', 'Invalid Green Hive App Manifest', { errors: result.errors });
  }
}

export class AppRegistry {
  readonly #manifests = new Map<string, AppManifestV1>();

  register(input: unknown): AppManifestV1 {
    assertValidAppManifest(input);
    if (this.#manifests.has(input.appCode)) {
      throw new HiveError('APP_ALREADY_REGISTERED', `App ${input.appCode} is already registered`);
    }
    this.#manifests.set(input.appCode, input);
    return input;
  }

  get(appCode: string): AppManifestV1 {
    const manifest = this.#manifests.get(appCode);
    if (!manifest) throw new HiveError('APP_NOT_FOUND', `App ${appCode} is not registered`);
    return manifest;
  }

  list(): readonly AppManifestV1[] {
    return [...this.#manifests.values()];
  }
}
