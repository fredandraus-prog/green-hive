import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIGatewayError,
  AIGatewayRegistry,
  AIGatewayService,
  FakeAIProvider,
  actualGatewayCost,
  estimateGatewayCost,
} from '../../packages/ai/dist/index.js';
import { TrustPolicyService } from '../../packages/trust/dist/index.js';
import {
  REFERENCE_APP_AI_SCHEMA_ID,
  REFERENCE_APP_AI_SUCCESS_RESULT,
  REFERENCE_APP_AI_TASK_TYPE,
  REFERENCE_APP_OPENAI_STAGING_CONFIGURATION_RELEASE,
  createReferenceAppAIConfiguration,
  createReferenceAppOpenAIStagingConfiguration,
} from '../../apps/hive-reference-app/dist/index.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000121';
const BUDGET_ID = '90000000-0000-4000-8000-000000000121';
const RESERVATION_ID = '94000000-0000-4000-8000-000000000121';
const context = Object.freeze({
  userId: USER_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_ID,
});

function hasCode(code) {
  return (error) => error instanceof AIGatewayError && error.code === code;
}

function input(overrides = {}) {
  return {
    projectId: PROJECT_ID,
    budgetId: BUDGET_ID,
    operationId: 'ai-gateway-operation-0001',
    taskType: REFERENCE_APP_AI_TASK_TYPE,
    input: 'bounded reference application context',
    classification: 'INTERNAL',
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const evidence = {
    starts: [], completes: [], failures: [], reserves: [], consumes: [], releases: [], usage: [],
  };
  const ports = {
    trustPolicy: new TrustPolicyService({
      configurationRelease: 'GREEN_HIVE_TRUST_V1',
      policyOverrides: [],
    }),
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
      async consume(_context, value) {
        evidence.consumes.push(value);
        return { id: value.reservationId, status: 'CONSUMED' };
      },
      async release(_context, value) {
        evidence.releases.push(value);
        return { id: value.reservationId, status: 'RELEASED' };
      },
    },
    usageCost: {
      async recordUsage(_context, value) {
        evidence.usage.push(value);
        return { id: 'usage-event-test' };
      },
    },
    ...overrides,
  };
  return { evidence, ports };
}

test('GH-0503 routes a registered structured task and records bounded usage and cost', async () => {
  const { evidence, ports } = dependencies();
  const gateway = new AIGatewayService(createReferenceAppAIConfiguration(), ports);
  const result = await gateway.execute(context, input());

  assert.equal(result.outputMode, 'STRUCTURED');
  assert.equal(result.outputSchemaId, REFERENCE_APP_AI_SCHEMA_ID);
  assert.deepEqual(result.value, {
    result: REFERENCE_APP_AI_SUCCESS_RESULT,
  });
  assert.equal(result.providerCode, 'GREEN_HIVE_FAKE_AI');
  assert.equal(result.modelCode, 'FAKE_DETERMINISTIC_V1');
  assert.equal(result.cost.estimatedAmount, '0.000516');
  assert.equal(result.cost.actualAmount, '0.000006');
  assert.equal(evidence.starts.length, 1);
  assert.match(evidence.starts[0].requestFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(evidence.starts[0].requestFingerprint.includes(input().input), false);
  assert.equal(evidence.reserves[0].capabilityCode, 'REFERENCE_APP_RUN_JOB');
  assert.equal(evidence.reserves[0].providerCode, undefined);
  assert.equal(evidence.consumes[0].actualAmount, '0.000006');
  assert.equal(evidence.usage[0].usageCode, 'AI_TOKENS');
  assert.equal(evidence.usage[0].quantity, '5');
  assert.equal(evidence.completes.length, 1);
  assert.equal(evidence.failures.length, 0);
  assert.equal(evidence.releases.length, 0);
});

test('confidential input is minimized by the exact Trust Policy sanitizer before provider use', async () => {
  let providerInput;
  const provider = {
    providerCode: 'GREEN_HIVE_FAKE_AI',
    async generateText() { throw new Error('unexpected text mode'); },
    async generateStructured(request) {
      providerInput = request.input;
      return {
        outputMode: 'STRUCTURED',
        providerCode: this.providerCode,
        modelCode: 'FAKE_DETERMINISTIC_V1',
        value: {
          result: REFERENCE_APP_AI_SUCCESS_RESULT,
        },
        finishReason: 'STOP',
        usage: { inputTokens: 2, outputTokens: 1 },
      };
    },
  };
  const { ports } = dependencies();
  const gateway = new AIGatewayService(createReferenceAppAIConfiguration(provider), ports);
  const secret = 'cliente privado documento financeiro confidencial';
  const result = await gateway.execute(context, input({
    operationId: 'ai-gateway-confidential-0001', input: secret, classification: 'CONFIDENTIAL',
  }));
  assert.equal(result.trust.decision, 'ALLOW_WITH_SANITIZATION');
  assert.equal(result.trust.sanitizationMode, 'MINIMIZE_CONTEXT');
  assert.equal(providerInput, 'MINIMIZED_CONTEXT word_count=5');
  assert.doesNotMatch(providerInput, /cliente|financeiro|confidencial/);
});

test('application-owned runtime schema rejects malformed structured output with safe evidence', async () => {
  const provider = new FakeAIProvider({ structuredOutput: { forged: true } });
  const { evidence, ports } = dependencies();
  const gateway = new AIGatewayService(createReferenceAppAIConfiguration(provider), ports);
  await assert.rejects(
    gateway.execute(context, input({ operationId: 'ai-gateway-schema-invalid-0001' })),
    hasCode('AI_GATEWAY_OUTPUT_SCHEMA_INVALID'),
  );
  assert.deepEqual(evidence.failures, [{
    operationId: 'ai-gateway-schema-invalid-0001',
    errorCode: 'AI_GATEWAY_OUTPUT_SCHEMA_INVALID',
  }]);
  assert.equal(evidence.consumes.length, 1, 'provider work remains accounted for');
  assert.equal(evidence.releases.length, 1, 'release is attempted but cannot undo consumed cost');
});

test('Gateway rejects structured identity fields that disagree with its server-owned request', async () => {
  const provider = new FakeAIProvider({
    structuredOutput: {
      result: 'FAKE_AI_SUCCESS',
      taskType: REFERENCE_APP_AI_TASK_TYPE,
      operationId: 'forged-operation-identifier-0001',
      schemaId: REFERENCE_APP_AI_SCHEMA_ID,
    },
  });
  const { evidence, ports } = dependencies();
  const gateway = new AIGatewayService(createReferenceAppAIConfiguration(provider), ports);
  await assert.rejects(
    gateway.execute(context, input({ operationId: 'ai-gateway-identity-mismatch-0001' })),
    hasCode('AI_GATEWAY_OUTPUT_SCHEMA_INVALID'),
  );
  assert.equal(evidence.consumes.length, 1, 'provider usage remains accounted for');
  assert.deepEqual(evidence.failures, [{
    operationId: 'ai-gateway-identity-mismatch-0001',
    errorCode: 'AI_GATEWAY_OUTPUT_SCHEMA_INVALID',
  }]);
});

test('client input cannot forge tenant, provider, model, schema, capability or cost authority', async () => {
  const { ports } = dependencies();
  const gateway = new AIGatewayService(createReferenceAppAIConfiguration(), ports);
  const forbiddenInputs = [
    { ...input(), appId: '00000000-0000-4000-8000-000000000001' },
    { ...input(), ownerUserId: USER_ID },
    { ...input(), providerCode: 'FORGED_PROVIDER' },
    { ...input(), modelCode: 'FORGED_MODEL' },
    { ...input(), outputSchemaId: 'FORGED_SCHEMA' },
    { ...input(), capabilityCode: 'FORGED_CAPABILITY' },
    { ...input(), estimatedAmount: '0.00000001' },
  ];
  for (const forged of forbiddenInputs) {
    await assert.rejects(gateway.execute(context, forged), hasCode('AI_GATEWAY_INVALID_INPUT'));
  }
  await assert.rejects(
    gateway.execute({ ...context, appCode: 'OTHER_TEST_APP' }, input()),
    hasCode('AI_GATEWAY_ACCESS_DENIED'),
  );
  await assert.rejects(
    gateway.execute({ ...context, platformRole: 'PLATFORM_ADMIN' }, input()),
    hasCode('AI_GATEWAY_ACCESS_DENIED'),
  );
  await assert.rejects(
    gateway.execute(context, input({ classification: 'HIGHLY_CONFIDENTIAL' })),
    hasCode('AI_GATEWAY_TRUST_DENIED'),
  );
});

test('registry validates composition, routes by server priority and uses exact decimal pricing', () => {
  const provider = new FakeAIProvider();
  const configuration = createReferenceAppAIConfiguration(provider);
  const registry = new AIGatewayRegistry({
    ...configuration,
    models: [
      { ...configuration.models[0], modelCode: 'FAKE_SECONDARY_V1', priority: 200 },
      configuration.models[0],
    ],
  });
  assert.equal(registry.route(registry.task(REFERENCE_APP_AI_TASK_TYPE)).model.modelCode, 'FAKE_DETERMINISTIC_V1');
  assert.equal(configuration.models[0].inputTokenOverhead, 0);
  assert.equal(estimateGatewayCost(configuration.models[0], 4, 256), '0.000516');
  assert.equal(actualGatewayCost(configuration.models[0], { inputTokens: 4, outputTokens: 1 }), '0.000006');
  assert.throws(
    () => new AIGatewayRegistry({ ...configuration, schemas: [] }),
    hasCode('AI_GATEWAY_CONFIGURATION_INVALID'),
  );
  assert.throws(
    () => new AIGatewayRegistry({
      ...configuration,
      tasks: [{ ...configuration.tasks[0], preferredModelClass: 'UNAVAILABLE_CLASS' }],
    }),
    hasCode('AI_GATEWAY_CONFIGURATION_INVALID'),
  );
  for (const inputTokenOverhead of [undefined, -1, 16_385]) {
    assert.throws(
      () => new AIGatewayRegistry({
        ...configuration,
        models: [{ ...configuration.models[0], inputTokenOverhead }],
      }),
      hasCode('AI_GATEWAY_CONFIGURATION_INVALID'),
    );
  }
  assert.throws(
    () => new AIGatewayRegistry({
      ...configuration,
      models: [{
        ...configuration.models[0],
        maxInputTokens: configuration.tasks[0].maxInputTokensInternal,
        inputTokenOverhead: 1,
      }],
    }),
    hasCode('AI_GATEWAY_CONFIGURATION_INVALID'),
  );
});

test('OpenAI staging composition fixes model, price, limits, overhead and retry authority server-side', () => {
  const configuration = createReferenceAppOpenAIStagingConfiguration(
    'test-only-provider-credential-000000000001',
  );
  assert.equal(configuration.configurationRelease, REFERENCE_APP_OPENAI_STAGING_CONFIGURATION_RELEASE);
  assert.deepEqual(configuration.models[0], {
    modelClass: 'GENERAL_STRUCTURED',
    providerCode: 'OPENAI',
    modelCode: 'OPENAI_GPT_4O_MINI_2024_07_18',
    enabled: true,
    priority: 100,
    maxInputTokens: 65_536,
    maxOutputTokens: 8_192,
    inputTokenOverhead: 1_024,
    inputCostPerThousandTokens: '0.00015',
    outputCostPerThousandTokens: '0.00060',
    currency: 'USD',
  });
  assert.equal(configuration.tasks[0].maxInputTokensInternal, 128);
  assert.equal(configuration.tasks[0].maxOutputTokensInternal, 64);
  assert.equal(configuration.tasks[0].sensitivityMax, 'INTERNAL');
  assert.deepEqual(configuration.tasks[0].retryPolicy, {
    maxAttempts: 1,
    retryableProviderErrors: [],
  });
  assert.equal(estimateGatewayCost(configuration.models[0], 4, 64), '0.0001926');
  assert.equal(
    actualGatewayCost(configuration.models[0], { inputTokens: 4, outputTokens: 1 }),
    '0.0000012',
    'actual provider usage excludes the reservation-only overhead',
  );
  assert.throws(
    () => createReferenceAppAIConfiguration({
      provider: new FakeAIProvider(),
      profile: 'OPENAI_STAGING',
    }),
    hasCode('AI_GATEWAY_CONFIGURATION_INVALID'),
  );
});

test('Cost Guard denial and provider failures remain fail-closed and sanitized', async () => {
  const denied = dependencies({
    costGuard: {
      async reserve() { return { decision: { outcome: 'DENY_BUDGET' }, reservation: null }; },
      async consume() { throw new Error('not reached'); },
      async release() { throw new Error('not reached'); },
    },
  });
  await assert.rejects(
    new AIGatewayService(createReferenceAppAIConfiguration(), denied.ports)
      .execute(context, input({ operationId: 'ai-gateway-cost-denied-0001' })),
    hasCode('AI_GATEWAY_COST_DENIED'),
  );
  assert.equal(denied.evidence.failures[0].errorCode, 'AI_GATEWAY_COST_DENIED');

  const unavailable = dependencies();
  await assert.rejects(
    new AIGatewayService(
      createReferenceAppAIConfiguration(new FakeAIProvider({ failureMode: 'UNAVAILABLE' })),
      unavailable.ports,
    ).execute(context, input({ operationId: 'ai-gateway-provider-down-0001' })),
    (error) => {
      assert.ok(hasCode('AI_GATEWAY_PROVIDER_UNAVAILABLE')(error));
      assert.doesNotMatch(error.message, /prompt|secret|stack|vendor/i);
      return true;
    },
  );
  assert.equal(unavailable.evidence.failures[0].errorCode, 'AI_GATEWAY_PROVIDER_UNAVAILABLE');
});
