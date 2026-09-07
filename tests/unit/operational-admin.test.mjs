import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OperationalAdminAccessError,
  OperationalAdminService,
} from '../../apps/hive-admin/dist/index.js';

const CONTEXT = Object.freeze({
  userId: '00000000-0000-4000-8000-000000000111',
  appCode: 'REFERENCE_APP',
});

const OVERVIEW = Object.freeze({
  users: 2,
  workspaces: 3,
  projects: Object.freeze({ DRAFT: 1, ACTIVE: 1, ARCHIVED: 0, DELETED: 1 }),
  purchases: Object.freeze({ CONFIRMED: 1 }),
  payments: Object.freeze({ PAID: 1 }),
  jobs: Object.freeze({ FAILED: 1 }),
  budgets: Object.freeze({ ACTIVE: 1 }),
  costs: Object.freeze({ USD: 2 }),
  providerOperations: Object.freeze({ OPENAI: 1 }),
});

test('operational admin rejects a non-admin before the repository is queried', async () => {
  let queried = false;
  const service = new OperationalAdminService({
    async overview() { queried = true; return OVERVIEW; },
  });
  await assert.rejects(() => service.overview(CONTEXT), OperationalAdminAccessError);
  assert.equal(queried, false);
});

test('operational admin exposes only the repository read model to a verified platform admin', async () => {
  const service = new OperationalAdminService({ async overview() { return OVERVIEW; } });
  assert.deepEqual(await service.overview({ ...CONTEXT, platformRole: 'PLATFORM_ADMIN' }), OVERVIEW);
});
