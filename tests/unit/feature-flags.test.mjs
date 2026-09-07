import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceAppManifest } from '../../apps/hive-reference-app/dist/manifest.js';
import {
  FeatureFlagConfigurationError,
  FeatureFlagRegistry,
  createFeatureFlagAdminHook,
  isFeatureEnabled,
} from '../../packages/feature-flags/dist/index.js';

const OWNER = Object.freeze({
  userId: '00000000-0000-4000-8000-000000000111',
  appCode: 'REFERENCE_APP',
  organizationId: '00000000-0000-4000-8000-000000000222',
});

function registry(state, audience) {
  return new FeatureFlagRegistry(referenceAppManifest, [{
    code: 'REFERENCE_APP_GOLDEN_FLOW',
    state,
    ...(audience ? { audience } : {}),
  }]);
}

test('feature flags evaluate deterministically by verified app, user and workspace context', () => {
  assert.equal(registry('PUBLIC').evaluate(OWNER, 'REFERENCE_APP_GOLDEN_FLOW').enabled, true);
  assert.deepEqual(registry('OFF', { userIds: [OWNER.userId] }).evaluate(OWNER, 'REFERENCE_APP_GOLDEN_FLOW'), {
    code: 'REFERENCE_APP_GOLDEN_FLOW', state: 'OFF', enabled: false, reason: 'KILL_SWITCH_OFF',
  });
  assert.equal(registry('INTERNAL').evaluate(OWNER, 'REFERENCE_APP_GOLDEN_FLOW').enabled, false);
  assert.equal(registry('INTERNAL').evaluate({ ...OWNER, platformRole: 'PLATFORM_ADMIN' }, 'REFERENCE_APP_GOLDEN_FLOW').enabled, true);
  assert.equal(registry('BETA', { userIds: [OWNER.userId] }).evaluate(OWNER, 'REFERENCE_APP_GOLDEN_FLOW').enabled, true);
  assert.equal(registry('BETA', { organizationIds: [OWNER.organizationId] }).evaluate(OWNER, 'REFERENCE_APP_GOLDEN_FLOW').enabled, true);
  assert.equal(registry('BETA').evaluate(OWNER, 'REFERENCE_APP_GOLDEN_FLOW').reason, 'BETA_AUDIENCE_REQUIRED');
});

test('feature flags reject cross-app evaluation and unknown codes without exposing configuration', () => {
  const flags = registry('PUBLIC');
  assert.deepEqual(flags.evaluate({ ...OWNER, appCode: 'SECOND_APP' }, 'REFERENCE_APP_GOLDEN_FLOW'), {
    code: 'REFERENCE_APP_GOLDEN_FLOW', state: 'PUBLIC', enabled: false, reason: 'APP_CONTEXT_MISMATCH',
  });
  assert.equal(isFeatureEnabled(flags, OWNER, 'REFERENCE_APP_UNKNOWN'), false);
  assert.equal(flags.evaluate(OWNER, 'REFERENCE_APP_UNKNOWN').reason, 'FLAG_UNREGISTERED');
});

test('feature flags accept only manifest-declared unique configurations and admin-only inspection', () => {
  assert.throws(
    () => new FeatureFlagRegistry(referenceAppManifest, [{ code: 'REFERENCE_APP_UNKNOWN', state: 'PUBLIC' }]),
    FeatureFlagConfigurationError,
  );
  assert.throws(
    () => new FeatureFlagRegistry(referenceAppManifest, [
      { code: 'REFERENCE_APP_GOLDEN_FLOW', state: 'PUBLIC' },
      { code: 'REFERENCE_APP_GOLDEN_FLOW', state: 'OFF' },
    ]),
    FeatureFlagConfigurationError,
  );
  const admin = createFeatureFlagAdminHook(registry('BETA', { userIds: [OWNER.userId] }));
  assert.throws(() => admin.list(OWNER), FeatureFlagConfigurationError);
  assert.deepEqual(admin.list({ ...OWNER, platformRole: 'PLATFORM_ADMIN' }), [{
    code: 'REFERENCE_APP_GOLDEN_FLOW', state: 'BETA', audience: { userIds: [OWNER.userId] },
  }]);
});
