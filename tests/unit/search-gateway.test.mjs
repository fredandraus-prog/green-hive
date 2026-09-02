import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEARCH_CONTENT_TRUST,
  FakeSearchProvider,
  SearchGatewayError,
  SearchGatewayRegistry,
  SearchGatewayService,
  SearchProviderError,
  actualSearchCost,
  estimateSearchCost,
} from '../../packages/search/dist/index.js';
import { TrustPolicyService } from '../../packages/trust/dist/index.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000122';
const BUDGET_ID = '90000000-0000-4000-8000-000000000122';
const RESERVATION_ID = '94000000-0000-4000-8000-000000000122';
const SEARCH_TYPE = 'REFERENCE_APP_FAKE_SEARCH';
const CAPABILITY_CODE = 'REFERENCE_APP_SEARCH';
const PROVIDER_CLASS = 'DETERMINISTIC_SEARCH';
const PROVIDER_CODE = 'GREEN_HIVE_FAKE_SEARCH';

const context = Object.freeze({
  userId: USER_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_ID,
});

function hasCode(code) {
  return (error) => error instanceof SearchGatewayError && error.code === code;
}

function input(overrides = {}) {
  return {
    projectId: PROJECT_ID,
    budgetId: BUDGET_ID,
    operationId: 'search-gateway-operation-0001',
    searchType: SEARCH_TYPE,
    query: 'green hive reusable platform',
    classification: 'PUBLIC',
    ...overrides,
  };
}

function publicSearchTrustPolicy() {
  return new TrustPolicyService({
    configurationRelease: 'GREEN_HIVE_SEARCH_TRUST_V1',
    policyOverrides: [{
      policyCode: 'REFERENCE_APP_PUBLIC_FAKE_SEARCH',
      classification: 'PUBLIC',
      operation: 'SEARCH_QUERY',
      decision: 'ALLOW',
      providerCode: PROVIDER_CODE,
      confidentialMode: 'ANY',
    }],
  });
}

function configuration(provider = new FakeSearchProvider(), taskOverrides = {}) {
  return {
    configurationRelease: 'REFERENCE_APP_SEARCH_V1',
    providers: [provider],
    registrations: [{
      providerClass: PROVIDER_CLASS,
      providerCode: provider.providerCode,
      enabled: true,
      priority: 100,
      maxResults: 10,
      requestCost: '0.0001',
      resultCost: '0.00002',
      currency: 'USD',
    }],
    tasks: [{
      searchType: SEARCH_TYPE,
      sensitivityMax: 'CONFIDENTIAL',
      preferredProviderClass: PROVIDER_CLASS,
      maxQueryCharacters: 256,
      maxResults: 2,
      costBudgetType: 'SEARCH',
      cachePolicy: 'NONE',
      retryPolicy: { maxAttempts: 1, retryableProviderErrors: [] },
      capabilityCode: CAPABILITY_CODE,
      sanitizer: {
        mode: 'ABSTRACT_QUERY',
        sanitize(query) {
          return `ABSTRACT_QUERY word_count=${query.trim().split(/\s+/).length}`;
        },
      },
      ...taskOverrides,
    }],
  };
}

function dependencies(overrides = {}) {
  const evidence = {
    starts: [],
    completes: [],
    failures: [],
    reserves: [],
  };
  const ports = {
    trustPolicy: publicSearchTrustPolicy(),
    operations: {
      async start(_context, value) { evidence.starts.push(value); },
      async complete(_context, value) { evidence.completes.push(value); },
      async fail(_context, value) { evidence.failures.push(value); },
    },
    costGuard: {
      async reserve(_context, value) {
        evidence.reserves.push(value);
        return {
          decision: { outcome: 'ALLOW' },
          reservation: { id: RESERVATION_ID },
        };
      },
    },
    ...overrides,
  };
  return { evidence, ports };
}

test('GH-0505 executes fake Search with metadata-only atomic accounting and exact cost', async () => {
  const { evidence, ports } = dependencies();
  const gateway = new SearchGatewayService(configuration(), ports);
  const executeInput = input();
  const result = await gateway.execute(context, executeInput);

  assert.equal(result.operationId, executeInput.operationId);
  assert.equal(result.searchType, SEARCH_TYPE);
  assert.equal(result.providerCode, PROVIDER_CODE);
  assert.equal(result.contentTrust, SEARCH_CONTENT_TRUST);
  assert.equal(result.contentTrust, 'UNTRUSTED_EXTERNAL_DATA');
  assert.equal(result.cacheStatus, 'NOT_APPLICABLE');
  assert.deepEqual(result.usage, { requestCount: 1, resultCount: 2 });
  assert.equal(result.cost.reservationId, RESERVATION_ID);
  assert.equal(result.cost.estimatedAmount, '0.00014');
  assert.equal(result.cost.actualAmount, '0.00014');
  assert.equal(result.cost.currency, 'USD');

  assert.equal(evidence.starts.length, 1);
  assert.equal(evidence.starts[0].searchType, SEARCH_TYPE);
  assert.equal(evidence.starts[0].capabilityCode, CAPABILITY_CODE);
  assert.equal(evidence.starts[0].providerCode, PROVIDER_CODE);
  assert.equal(evidence.starts[0].maxResults, 2);
  assert.match(evidence.starts[0].requestFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(evidence.starts[0].requestFingerprint.includes(executeInput.query), false);

  assert.equal(evidence.reserves.length, 1);
  assert.equal(evidence.reserves[0].capabilityCode, CAPABILITY_CODE);
  assert.equal(evidence.reserves[0].estimatedAmount, '0.00014');
  assert.equal(evidence.reserves[0].providerCode, undefined);
  assert.deepEqual(evidence.completes, [{
    operationId: executeInput.operationId,
    reservationId: RESERVATION_ID,
    resultCount: 2,
    requestCount: 1,
    actualCost: '0.00014',
    cacheStatus: 'NOT_APPLICABLE',
  }]);
  assert.equal(evidence.failures.length, 0);
  assert.equal('usageCost' in ports, false);
  assert.equal('consume' in ports.costGuard, false);
  assert.equal('release' in ports.costGuard, false);

  const persistedEvidence = JSON.stringify({
    starts: evidence.starts,
    reserves: evidence.reserves,
    completes: evidence.completes,
  });
  assert.doesNotMatch(persistedEvidence, /green hive reusable platform/i);
  assert.doesNotMatch(persistedEvidence, /example\.invalid|GREEN_HIVE_FAKE_SEARCH_RESULT/i);
});

test('confidential Search uses only the registered ABSTRACT_QUERY sanitizer before provider access', async () => {
  let providerQuery;
  const provider = {
    providerCode: PROVIDER_CODE,
    async search(providerRequest) {
      providerQuery = providerRequest.query;
      return {
        providerCode: PROVIDER_CODE,
        contentTrust: SEARCH_CONTENT_TRUST,
        results: [{
          rank: 1,
          title: 'SANITIZED_SEARCH_RESULT',
          url: 'https://example.invalid/search/sanitized',
          snippet: null,
        }],
        usage: { requestCount: 1, resultCount: 1 },
      };
    },
  };
  const { evidence, ports } = dependencies({
    trustPolicy: new TrustPolicyService({
      configurationRelease: 'GREEN_HIVE_TRUST_V1',
      policyOverrides: [],
    }),
  });
  const secretQuery = 'cliente privado documento financeiro confidencial';
  const result = await new SearchGatewayService(configuration(provider), ports).execute(
    context,
    input({
      operationId: 'search-gateway-confidential-0001',
      query: secretQuery,
      classification: 'CONFIDENTIAL',
    }),
  );

  assert.equal(providerQuery, 'ABSTRACT_QUERY word_count=5');
  assert.doesNotMatch(providerQuery, /cliente|privado|financeiro|confidencial/i);
  assert.equal(result.trust.decision, 'ALLOW_WITH_SANITIZATION');
  assert.equal(result.trust.sanitizationMode, 'ABSTRACT_QUERY');
  assert.equal(evidence.starts[0].trustDecision, 'ALLOW_WITH_SANITIZATION');
  assert.equal(evidence.starts[0].sanitizationMode, 'ABSTRACT_QUERY');
  assert.doesNotMatch(JSON.stringify(evidence), /cliente|privado|financeiro|confidencial/i);
});

test('client payload cannot forge tenant, provider, capability, pricing, limits or Trust authority', async () => {
  const { ports } = dependencies();
  const gateway = new SearchGatewayService(configuration(), ports);
  const forbiddenInputs = [
    { ...input(), organizationId: ORGANIZATION_ID },
    { ...input(), appId: '00000000-0000-4000-8000-000000000001' },
    { ...input(), ownerUserId: USER_ID },
    { ...input(), providerCode: 'FORGED_PROVIDER' },
    { ...input(), providerClass: 'FORGED_CLASS' },
    { ...input(), capabilityCode: 'FORGED_CAPABILITY' },
    { ...input(), requestCost: '0.00000001' },
    { ...input(), resultCost: '0' },
    { ...input(), currency: 'BRL' },
    { ...input(), maxResults: 50 },
    { ...input(), cachePolicy: 'PUBLIC_SAFE' },
    { ...input(), trustDecision: 'ALLOW' },
    { ...input(), apiKey: 'provider-secret' },
  ];
  for (const forged of forbiddenInputs) {
    await assert.rejects(gateway.execute(context, forged), hasCode('SEARCH_GATEWAY_INVALID_INPUT'));
  }

  await assert.rejects(
    gateway.execute({ ...context, appCode: 'OTHER_TEST_APP' }, input()),
    hasCode('SEARCH_GATEWAY_ACCESS_DENIED'),
  );
  await assert.rejects(
    gateway.execute({ ...context, platformRole: 'PLATFORM_ADMIN' }, input()),
    hasCode('SEARCH_GATEWAY_ACCESS_DENIED'),
  );
  await assert.rejects(
    gateway.execute(context, input({ searchType: 'OTHER_TEST_APP_FAKE_SEARCH' })),
    hasCode('SEARCH_GATEWAY_ACCESS_DENIED'),
  );
});

test('Search Trust denial, confirmation and missing sanitizer fail before provider execution', async () => {
  let providerCalls = 0;
  const provider = {
    providerCode: PROVIDER_CODE,
    async search() {
      providerCalls += 1;
      throw new Error('provider must not be reached');
    },
  };

  const failClosed = dependencies({
    trustPolicy: new TrustPolicyService({
      configurationRelease: 'GREEN_HIVE_TRUST_V1',
      policyOverrides: [],
    }),
  });
  await assert.rejects(
    new SearchGatewayService(configuration(provider), failClosed.ports).execute(context, input()),
    hasCode('SEARCH_GATEWAY_TRUST_DENIED'),
  );

  const confirmation = dependencies({
    trustPolicy: {
      evaluate() {
        return {
          configurationRelease: 'TEST_CONFIRMATION_POLICY',
          policyCode: 'TEST_CONFIRMATION_REQUIRED',
          decision: 'REQUIRE_CONFIRMATION',
          sanitizationMode: null,
        };
      },
    },
  });
  await assert.rejects(
    new SearchGatewayService(configuration(provider), confirmation.ports).execute(context, input()),
    hasCode('SEARCH_GATEWAY_CONFIRMATION_REQUIRED'),
  );

  const confidential = dependencies({
    trustPolicy: new TrustPolicyService({
      configurationRelease: 'GREEN_HIVE_TRUST_V1',
      policyOverrides: [],
    }),
  });
  await assert.rejects(
    new SearchGatewayService(
      configuration(provider, { sanitizer: undefined }),
      confidential.ports,
    ).execute(context, input({
      operationId: 'search-gateway-no-sanitizer-0001',
      classification: 'CONFIDENTIAL',
    })),
    hasCode('SEARCH_GATEWAY_SANITIZER_REQUIRED'),
  );
  await assert.rejects(
    new SearchGatewayService(configuration(provider), failClosed.ports).execute(
      context,
      input({
        operationId: 'search-gateway-highly-confidential-0001',
        classification: 'HIGHLY_CONFIDENTIAL',
      }),
    ),
    hasCode('SEARCH_GATEWAY_TRUST_DENIED'),
  );
  assert.equal(providerCalls, 0);
});

test('non-string sanitizer output becomes a stable sanitizer error before side effects', async () => {
  let providerCalls = 0;
  const provider = {
    providerCode: PROVIDER_CODE,
    async search() {
      providerCalls += 1;
      throw new Error('provider must not be reached');
    },
  };
  const invalidSanitizer = dependencies({
    trustPolicy: new TrustPolicyService({
      configurationRelease: 'GREEN_HIVE_TRUST_V1',
      policyOverrides: [],
    }),
  });

  await assert.rejects(
    new SearchGatewayService(configuration(provider, {
      sanitizer: {
        mode: 'ABSTRACT_QUERY',
        sanitize() { return { forbidden: 'non-string' }; },
      },
    }), invalidSanitizer.ports).execute(context, input({
      operationId: 'search-gateway-non-string-sanitizer-0001',
      classification: 'CONFIDENTIAL',
    })),
    (error) => {
      assert.ok(error instanceof SearchGatewayError);
      assert.equal(error.code, 'SEARCH_GATEWAY_SANITIZER_REQUIRED');
      assert.notEqual(error.name, 'TypeError');
      return true;
    },
  );
  assert.equal(providerCalls, 0);
  assert.equal(invalidSanitizer.evidence.starts.length, 0);
  assert.equal(invalidSanitizer.evidence.reserves.length, 0);
});

test('entitlement and budget denial prevents provider execution and records a safe failed operation', async () => {
  let providerCalls = 0;
  const provider = {
    providerCode: PROVIDER_CODE,
    async search() {
      providerCalls += 1;
      throw new Error('provider must not be reached');
    },
  };
  for (const outcome of ['DENY_ENTITLEMENT', 'DENY_BUDGET']) {
    const denied = dependencies({
      costGuard: {
        async reserve() {
          return { decision: { outcome }, reservation: null };
        },
      },
    });
    const operationId = `search-gateway-${outcome.toLowerCase()}-0001`;
    await assert.rejects(
      new SearchGatewayService(configuration(provider), denied.ports).execute(
        context,
        input({ operationId }),
      ),
      hasCode('SEARCH_GATEWAY_COST_DENIED'),
    );
    assert.equal(denied.evidence.starts.length, 1);
    assert.deepEqual(denied.evidence.failures, [{
      operationId,
      reservationId: null,
      errorCode: 'SEARCH_GATEWAY_COST_DENIED',
    }]);
  }
  assert.equal(providerCalls, 0);
});

test('provider failures are mapped to stable errors and request atomic reservation release', async () => {
  for (const [failureMode, expectedCode] of [
    ['UNAVAILABLE', 'SEARCH_GATEWAY_PROVIDER_UNAVAILABLE'],
    ['TIMEOUT', 'SEARCH_GATEWAY_PROVIDER_TIMEOUT'],
    ['FAILED', 'SEARCH_GATEWAY_PROVIDER_FAILED'],
  ]) {
    const failed = dependencies();
    const operationId = `search-gateway-provider-${failureMode.toLowerCase()}-0001`;
    const gateway = new SearchGatewayService(
      configuration(new FakeSearchProvider({ failureMode })),
      failed.ports,
    );
    await assert.rejects(gateway.execute(context, input({ operationId })), (error) => {
      assert.ok(hasCode(expectedCode)(error));
      assert.doesNotMatch(error.message, /query|secret|token|stack|vendor|provider response/i);
      return true;
    });
    assert.deepEqual(failed.evidence.failures, [{
      operationId,
      reservationId: RESERVATION_ID,
      errorCode: expectedCode,
    }]);
  }
});

test('retry accounts for two physical requests with one reserve and one atomic completion', async () => {
  let providerCalls = 0;
  const provider = {
    providerCode: PROVIDER_CODE,
    async search() {
      providerCalls += 1;
      if (providerCalls === 1) {
        throw new SearchProviderError('SEARCH_PROVIDER_UNAVAILABLE');
      }
      return {
        providerCode: PROVIDER_CODE,
        contentTrust: SEARCH_CONTENT_TRUST,
        results: [{
          rank: 1,
          title: 'RETRY_RESULT',
          url: 'https://example.invalid/search/retry',
          snippet: null,
        }],
        usage: { requestCount: 1, resultCount: 1 },
      };
    },
  };
  const retried = dependencies();
  const operationId = 'search-gateway-retry-unavailable-0001';
  const result = await new SearchGatewayService(configuration(provider, {
    retryPolicy: {
      maxAttempts: 2,
      retryableProviderErrors: ['UNAVAILABLE'],
    },
  }), retried.ports).execute(context, input({ operationId }));

  assert.equal(providerCalls, 2);
  assert.deepEqual(result.usage, { requestCount: 2, resultCount: 1 });
  assert.equal(result.cost.estimatedAmount, '0.00024');
  assert.equal(result.cost.actualAmount, '0.00022');
  assert.equal(retried.evidence.starts[0].estimatedCost, '0.00024');
  assert.deepEqual(retried.evidence.reserves, [{
    projectId: PROJECT_ID,
    budgetId: BUDGET_ID,
    operationId,
    capabilityCode: CAPABILITY_CODE,
    estimatedAmount: '0.00024',
    currency: 'USD',
    metadata: {
      serviceCode: 'SEARCH_GATEWAY',
      searchType: SEARCH_TYPE,
      providerClass: PROVIDER_CLASS,
    },
  }]);
  assert.deepEqual(retried.evidence.completes, [{
    operationId,
    reservationId: RESERVATION_ID,
    resultCount: 1,
    requestCount: 2,
    actualCost: '0.00022',
    cacheStatus: 'NOT_APPLICABLE',
  }]);
  assert.equal(retried.evidence.failures.length, 0);
});

test('atomic completion failure records one operation failure and releases one reservation', async () => {
  const failed = dependencies();
  failed.ports.operations.complete = async (_context, value) => {
    failed.evidence.completes.push(value);
    throw new Error('injected atomic completion failure');
  };
  const operationId = 'search-gateway-atomic-completion-failure-0001';

  await assert.rejects(
    new SearchGatewayService(configuration(), failed.ports).execute(
      context,
      input({ operationId }),
    ),
    hasCode('SEARCH_GATEWAY_OPERATION_FAILED'),
  );

  assert.equal(failed.evidence.reserves.length, 1);
  assert.equal(failed.evidence.completes.length, 1);
  assert.equal(failed.evidence.completes[0].reservationId, RESERVATION_ID);
  assert.deepEqual(failed.evidence.failures, [{
    operationId,
    reservationId: RESERVATION_ID,
    errorCode: 'SEARCH_GATEWAY_OPERATION_FAILED',
  }]);
  assert.equal('consume' in failed.ports.costGuard, false);
  assert.equal('release' in failed.ports.costGuard, false);
  assert.equal('usageCost' in failed.ports, false);
});

test('registry uses server priority, exact decimal cost and rejects inconsistent composition', () => {
  const primary = new FakeSearchProvider();
  const secondary = {
    providerCode: 'GREEN_HIVE_SECONDARY_SEARCH',
    async search() {
      throw new SearchProviderError('SEARCH_PROVIDER_FAILED');
    },
  };
  const base = configuration(primary);
  const registry = new SearchGatewayRegistry({
    ...base,
    providers: [secondary, primary],
    registrations: [
      { ...base.registrations[0], providerCode: secondary.providerCode, priority: 200 },
      base.registrations[0],
    ],
  });
  assert.equal(registry.route(registry.task(SEARCH_TYPE)).provider.providerCode, PROVIDER_CODE);
  assert.equal(estimateSearchCost(base.registrations[0], 2), '0.00014');
  assert.equal(estimateSearchCost(base.registrations[0], 2, 3), '0.00034');
  assert.equal(actualSearchCost(base.registrations[0], 1), '0.00012');
  assert.equal(actualSearchCost(base.registrations[0], 1, 2), '0.00022');

  assert.throws(
    () => new SearchGatewayRegistry({ ...base, tasks: [] }),
    hasCode('SEARCH_GATEWAY_CONFIGURATION_INVALID'),
  );
  assert.throws(
    () => new SearchGatewayRegistry({
      ...base,
      registrations: [{ ...base.registrations[0], requestCost: '0' }],
    }),
    hasCode('SEARCH_GATEWAY_CONFIGURATION_INVALID'),
  );
  assert.throws(
    () => new SearchGatewayRegistry({
      ...base,
      registrations: [{ ...base.registrations[0], providerCode: 'MISSING_PROVIDER' }],
    }),
    hasCode('SEARCH_GATEWAY_CONFIGURATION_INVALID'),
  );
  assert.throws(
    () => new SearchGatewayRegistry({
      ...base,
      tasks: [{ ...base.tasks[0], preferredProviderClass: 'UNAVAILABLE_CLASS' }],
    }),
    hasCode('SEARCH_GATEWAY_CONFIGURATION_INVALID'),
  );
  assert.throws(
    () => new SearchGatewayRegistry({
      ...base,
      tasks: [{ ...base.tasks[0], capabilityCode: 'INVALID-CAPABILITY' }],
    }),
    hasCode('SEARCH_GATEWAY_CONFIGURATION_INVALID'),
  );
});
