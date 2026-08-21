import type { AppManifestV1 } from '@green-hive/core';

export const referenceAppManifest = {
  schemaVersion: 1,
  appCode: 'REFERENCE_APP',
  appName: 'Green Hive Reference App',
  appVersion: '0.1.0',
  status: 'INTERNAL',
  projectNamespace: 'reference',
  supportedLocales: ['pt-BR', 'en-US'],
  defaultLocale: 'pt-BR',
  requiredCapabilities: ['AUTH', 'PROJECTS', 'ENTITLEMENTS', 'COST_GUARD', 'JOBS', 'AI', 'FILES', 'AUDIT', 'I18N', 'FEATURE_FLAGS'],
  products: [
    { productCode: 'REFERENCE_APP_SANDBOX', productType: 'ONE_TIME' },
  ],
  entitlementCapabilities: [
    'REFERENCE_APP_RUN_JOB',
    'REFERENCE_APP_GENERATE_FILE',
  ],
  jobTypes: [
    'REFERENCE_APP_FAKE_AI_JOB',
  ],
  aiTaskTypes: [
    'REFERENCE_APP_STRUCTURED_ECHO',
  ],
  featureFlags: [
    'REFERENCE_APP_GOLDEN_FLOW',
  ],
  routes: [
    { routeCode: 'REFERENCE_APP_HOME', path: '/reference' },
    { routeCode: 'REFERENCE_APP_PROJECT', path: '/reference/projects/:projectId' },
  ],
} as const satisfies AppManifestV1;
