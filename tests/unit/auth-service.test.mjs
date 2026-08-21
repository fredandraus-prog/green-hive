import assert from 'node:assert/strict';
import test from 'node:test';
import { AppRegistry } from '../../packages/core/dist/index.js';
import {
  AccountService,
  AUTH_ERROR_CODES,
  AuthError,
  AuthService,
  PostgresAuthenticatedSessionRunner,
  SupabaseServerAuthProvider,
  createTrustedAppContext,
} from '../../packages/auth/dist/index.js';
import { referenceAppManifest } from '../../apps/hive-reference-app/dist/index.js';

const USER_ID = '10000000-0000-4000-8000-000000000101';
const RECOVERY_REDIRECT = 'http://127.0.0.1:3000/auth/recovery';

test('Supabase provider rejects masked or non-ASCII API key material before any request', () => {
  assert.throws(
    () =>
      new SupabaseServerAuthProvider({
        authUrl: 'https://example.supabase.co/auth/v1',
        publishableKey: 'sb_publishable_example',
        serviceRoleKey: 'sb_secret_••••',
      }),
    /Invalid Supabase service role key/,
  );
});

function sessionFor(appCode = 'REFERENCE_APP') {
  return {
    accessToken: 'access-token-that-is-long-enough',
    refreshToken: 'refresh-token-that-is-long-enough',
    expiresAt: new Date('2026-08-19T00:00:00.000Z'),
    user: { id: USER_ID, email: 'owner@example.test', appCode },
  };
}

class FakeAuthProvider {
  created = [];
  signedIn = [];
  recoveries = [];
  signOuts = [];
  passwordUpdates = [];
  recoveryExchanges = [];
  nextSession = sessionFor();
  verifiedIdentity = sessionFor().user;
  failure = null;

  async createAccount(input) {
    if (this.failure) throw this.failure;
    this.created.push(input);
    return this.nextSession;
  }

  async signIn(input) {
    if (this.failure) throw this.failure;
    this.signedIn.push(input);
    return this.nextSession;
  }

  async refreshSession() {
    if (this.failure) throw this.failure;
    return this.nextSession;
  }

  async signOut(accessToken, scope) {
    this.signOuts.push({ accessToken, scope });
  }

  async sendPasswordRecovery(email, redirectTo) {
    if (this.failure) throw this.failure;
    this.recoveries.push({ email, redirectTo });
    return { state: 'recovery-state-that-is-long-enough' };
  }

  async exchangePasswordRecoveryCode(code, state, flowId) {
    if (this.failure) throw this.failure;
    this.recoveryExchanges.push({ code, state, flowId });
    return this.nextSession;
  }

  async updatePassword(accessToken, refreshToken, newPassword) {
    if (this.failure) throw this.failure;
    this.passwordUpdates.push({ accessToken, refreshToken, newPassword });
  }

  async verifyAccessToken() {
    if (this.failure) throw this.failure;
    return this.verifiedIdentity;
  }
}

function authFixture(provider = new FakeAuthProvider()) {
  const registry = new AppRegistry();
  registry.register(referenceAppManifest);
  return {
    provider,
    service: new AuthService(provider, registry, {
      allowedRecoveryRedirects: [RECOVERY_REDIRECT],
    }),
  };
}

function hasAuthCode(code) {
  return (error) => error instanceof AuthError && error.code === code;
}

test('Auth Service normalizes credentials and accepts only a registered app', async () => {
  const { provider, service } = authFixture();
  const signedUp = await service.signUp({
    email: '  OWNER@EXAMPLE.TEST ',
    password: 'StrongPass123',
    appCode: 'REFERENCE_APP',
  });
  assert.equal(signedUp.user.appCode, 'REFERENCE_APP');
  assert.deepEqual(provider.created, [
    {
      email: 'owner@example.test',
      password: 'StrongPass123',
      appCode: 'REFERENCE_APP',
    },
  ]);
  await assert.rejects(
    service.signUp({
      email: 'owner@example.test',
      password: 'StrongPass123',
      appCode: 'UNKNOWN_APP',
    }),
    hasAuthCode('AUTH_APP_NOT_ALLOWED'),
  );
});

test('runtime validation rejects extra scope fields and weak credentials', async () => {
  const { service } = authFixture();
  await assert.rejects(
    service.signUp({
      email: 'owner@example.test',
      password: 'StrongPass123',
      appCode: 'REFERENCE_APP',
      platformRole: 'PLATFORM_ADMIN',
    }),
    hasAuthCode('INVALID_AUTH_INPUT'),
  );
  await assert.rejects(
    service.signIn({
      email: 'owner@example.test',
      password: 'weak',
      appCode: 'REFERENCE_APP',
    }),
    hasAuthCode('INVALID_AUTH_INPUT'),
  );
});

test('app mismatch is denied and its newly issued session is revoked', async () => {
  const provider = new FakeAuthProvider();
  provider.nextSession = sessionFor('OTHER_TEST_APP');
  const { service } = authFixture(provider);
  await assert.rejects(
    service.signIn({
      email: 'owner@example.test',
      password: 'StrongPass123',
      appCode: 'REFERENCE_APP',
    }),
    hasAuthCode('AUTH_APP_NOT_ALLOWED'),
  );
  assert.deepEqual(provider.signOuts, [
    { accessToken: provider.nextSession.accessToken, scope: 'local' },
  ]);
});

test('only exact allowlisted password recovery redirects are accepted', async () => {
  const { provider, service } = authFixture();
  const challenge = await service.requestPasswordRecovery({
    email: 'owner@example.test',
    redirectTo: RECOVERY_REDIRECT,
  });
  assert.equal(provider.recoveries.length, 1);
  assert.equal(challenge.state, 'recovery-state-that-is-long-enough');
  await assert.rejects(
    service.requestPasswordRecovery({
      email: 'owner@example.test',
      redirectTo: 'http://evil.example/auth/recovery',
    }),
    hasAuthCode('INVALID_AUTH_INPUT'),
  );
});

test('PKCE recovery exchange validates opaque state and returns only the expected app', async () => {
  const { provider, service } = authFixture();
  const session = await service.exchangePasswordRecoveryCode({
    code: '12345678-1234-4234-8234-123456789abc',
    state: 'recovery_state_that_is_long_enough',
    flowId: '0123456789abcdef0123456789abcdef',
    appCode: 'REFERENCE_APP',
  });
  assert.equal(session.user.appCode, 'REFERENCE_APP');
  assert.deepEqual(provider.recoveryExchanges, [
    {
      code: '12345678-1234-4234-8234-123456789abc',
      state: 'recovery_state_that_is_long_enough',
      flowId: '0123456789abcdef0123456789abcdef',
    },
  ]);
  await assert.rejects(
    service.exchangePasswordRecoveryCode({
      code: 'invalid code',
      state: 'recovery_state_that_is_long_enough',
      appCode: 'REFERENCE_APP',
    }),
    hasAuthCode('INVALID_AUTH_INPUT'),
  );
});

test('password recovery completion validates both tokens and the new password', async () => {
  const { provider, service } = authFixture();
  await service.completePasswordRecovery({
    accessToken: 'access-token-that-is-long-enough',
    refreshToken: 'refresh-token-that-is-long-enough',
    newPassword: 'RecoveredPass456',
  });
  assert.equal(provider.passwordUpdates.length, 1);
  await assert.rejects(
    service.completePasswordRecovery({
      accessToken: 'access-token-that-is-long-enough',
      refreshToken: 'refresh-token-that-is-long-enough',
      newPassword: 'weak',
    }),
    hasAuthCode('INVALID_AUTH_INPUT'),
  );
});

test('provider failures become stable errors without internal details', async () => {
  const provider = new FakeAuthProvider();
  provider.failure = new Error('duplicate auth.users SQLSTATE 23505 internal stack');
  const { service } = authFixture(provider);
  await assert.rejects(
    service.signUp({
      email: 'owner@example.test',
      password: 'StrongPass123',
      appCode: 'REFERENCE_APP',
    }),
    (error) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, 'AUTH_SIGN_UP_FAILED');
      assert.equal(error.message, 'Account could not be created');
      assert.doesNotMatch(error.message, /SQLSTATE|auth\.users|stack/i);
      assert.equal('cause' in error, false);
      return true;
    },
  );
});

test('TrustedAppContext accepts only verified identity fields', () => {
  assert.deepEqual(
    createTrustedAppContext({
      id: USER_ID,
      email: 'owner@example.test',
      appCode: 'REFERENCE_APP',
    }),
    { userId: USER_ID, appCode: 'REFERENCE_APP' },
  );
  assert.throws(
    () =>
      createTrustedAppContext({
        id: USER_ID,
        email: 'owner@example.test',
        appCode: 'REFERENCE_APP',
        userMetadata: { platform_role: 'PLATFORM_ADMIN' },
      }),
    hasAuthCode('AUTH_SESSION_INVALID'),
  );
});

test('Account Service validates profile input and maps repository failures safely', async () => {
  const profile = {
    userId: USER_ID,
    displayName: 'Owner',
    preferredLanguage: 'pt',
    preferredLocale: 'pt-BR',
    timezone: 'America/Sao_Paulo',
    preferences: {},
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
  };
  const repository = {
    async ensure() {
      return profile;
    },
    async get() {
      return profile;
    },
    async update(_context, input) {
      return { ...profile, ...input };
    },
  };
  const service = new AccountService(repository);
  const context = { userId: USER_ID, appCode: 'REFERENCE_APP' };
  assert.equal((await service.ensure(context)).userId, USER_ID);
  assert.equal((await service.update(context, { displayName: '  New Name  ' })).displayName, 'New Name');
  await assert.rejects(
    service.update(context, { preferredLocale: 'pt_br' }),
    hasAuthCode('INVALID_ACCOUNT_INPUT'),
  );
  await assert.rejects(
    service.update({ ...context, platformRole: 'PLATFORM_ADMIN' }, { displayName: 'Admin' }),
    hasAuthCode('ACCOUNT_ACCESS_DENIED'),
  );

  repository.update = async () => {
    throw new Error('secret profile SQL');
  };
  await assert.rejects(
    service.update(context, { displayName: 'Safe' }),
    hasAuthCode('ACCOUNT_OPERATION_FAILED'),
  );
  assert.ok(AUTH_ERROR_CODES.includes('AUTH_SESSION_REFRESH_FAILED'));
});

test('authenticated database runner sets only signed authorization claims in one transaction', async () => {
  const queries = [];
  let released = false;
  const connection = {
    async query(sql, parameters = []) {
      queries.push({ sql, parameters });
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const runner = new PostgresAuthenticatedSessionRunner({
    async connect() {
      return connection;
    },
  });
  const result = await runner.run(
    {
      id: USER_ID,
      email: 'owner@example.test',
      appCode: 'REFERENCE_APP',
    },
    async ({ trustedContext }) => trustedContext,
  );
  assert.deepEqual(result, { userId: USER_ID, appCode: 'REFERENCE_APP' });
  assert.match(queries[0].sql, /BEGIN/);
  const claimQuery = queries.find(({ sql }) => sql.includes('request.jwt.claims'));
  const claims = JSON.parse(claimQuery.parameters[0]);
  assert.deepEqual(claims, {
    sub: USER_ID,
    role: 'authenticated',
    app_metadata: { app_code: 'REFERENCE_APP' },
  });
  assert.doesNotMatch(JSON.stringify(claims), /user_metadata/i);
  assert.ok(queries.some(({ sql }) => /SET LOCAL ROLE authenticated/.test(sql)));
  assert.match(queries.at(-1).sql, /COMMIT/);
  assert.equal(released, true);
});

test('organization runner promotes a requested id only after database membership validation', async () => {
  const organizationId = '30000000-0000-4000-8000-000000000001';
  const connection = {
    async query(sql) {
      if (sql.includes('hive.current_organization_id')) {
        return { rows: [{ organization_id: organizationId }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const runner = new PostgresAuthenticatedSessionRunner({
    async connect() { return connection; },
  });
  const trusted = await runner.runInOrganization(
    { id: USER_ID, email: 'owner@example.test', appCode: 'REFERENCE_APP' },
    organizationId,
    async ({ trustedContext }) => trustedContext,
  );
  assert.deepEqual(trusted, {
    userId: USER_ID,
    appCode: 'REFERENCE_APP',
    organizationId,
  });

  const deniedRunner = new PostgresAuthenticatedSessionRunner({
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('hive.current_organization_id')) {
            return { rows: [{ organization_id: null }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  });
  await assert.rejects(
    deniedRunner.runInOrganization(
      { id: USER_ID, email: 'owner@example.test', appCode: 'REFERENCE_APP' },
      organizationId,
      async () => 'forbidden',
    ),
    hasAuthCode('AUTH_ORGANIZATION_ACCESS_DENIED'),
  );
});
