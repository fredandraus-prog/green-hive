import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_PROVIDER_ERROR_CODES,
  AIProviderError,
  FakeAIProvider,
  validateAIStructuredGenerationResult,
  validateAITextGenerationResult,
} from '../../packages/ai/dist/index.js';

const textRequest = Object.freeze({
  operationId: 'ai-operation-0001',
  taskType: 'REFERENCE_APP_SUMMARIZE_PROJECT',
  modelClass: 'GENERAL_TEXT',
  input: 'Green Hive deterministic fake task',
  maxOutputTokens: 256,
});

const structuredRequest = Object.freeze({
  ...textRequest,
  operationId: 'ai-operation-0002',
  taskType: 'REFERENCE_APP_EXTRACT_FACTS',
  modelClass: 'GENERAL_STRUCTURED',
  outputSchemaId: 'REFERENCE_APP_FACTS_V1',
});

function hasCode(code) {
  return (error) => error instanceof AIProviderError && error.code === code;
}

test('FakeAIProvider returns deterministic provider-neutral text and usage', async () => {
  const provider = new FakeAIProvider();
  const first = await provider.generateText(textRequest);
  const second = await provider.generateText(textRequest);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    outputMode: 'TEXT',
    providerCode: 'GREEN_HIVE_FAKE_AI',
    modelCode: 'FAKE_DETERMINISTIC_V1',
    content: 'FAKE_AI_SUCCESS REFERENCE_APP_SUMMARIZE_PROJECT ai-operation-0001',
    finishReason: 'STOP',
    usage: { inputTokens: 5, outputTokens: 3 },
  });
  assert.doesNotMatch(first.content, /Green Hive deterministic fake task/);
});

test('FakeAIProvider returns isolated deterministic structured JSON', async () => {
  const configured = { facts: [{ code: 'FACT_001', confidence: 1 }] };
  const provider = new FakeAIProvider({ structuredOutput: configured });
  configured.facts[0].code = 'MUTATED_AFTER_CONSTRUCTION';

  const first = await provider.generateStructured(structuredRequest);
  first.value.facts[0].code = 'MUTATED_RESULT';
  const second = await provider.generateStructured(structuredRequest);

  assert.deepEqual(second.value, {
    facts: [{ code: 'FACT_001', confidence: 1 }],
  });
  assert.equal(second.outputMode, 'STRUCTURED');
  assert.equal(second.providerCode, 'GREEN_HIVE_FAKE_AI');
  assert.equal(second.modelCode, 'FAKE_DETERMINISTIC_V1');
  assert.deepEqual(second.usage, { inputTokens: 5, outputTokens: 1 });
});

test('AI provider requests reject vendor authority, secrets and oversized values', async () => {
  const provider = new FakeAIProvider();
  for (const request of [
    { ...textRequest, providerCode: 'FORGED' },
    { ...textRequest, modelCode: 'vendor-model' },
    { ...textRequest, apiKey: 'secret' },
    { ...textRequest, maxOutputTokens: 0 },
    { ...textRequest, maxOutputTokens: 8_193 },
    { ...textRequest, input: ' ' },
    { ...textRequest, input: 'x'.repeat(65_537) },
  ]) {
    await assert.rejects(
      provider.generateText(request),
      hasCode('AI_PROVIDER_INVALID_INPUT'),
    );
  }
  await assert.rejects(
    provider.generateStructured({ ...structuredRequest, outputSchemaId: 'INVALID' }),
    hasCode('AI_PROVIDER_INVALID_INPUT'),
  );
  assert.throws(
    () => new FakeAIProvider({ apiKey: 'secret' }),
    hasCode('AI_PROVIDER_FAILED'),
  );
});

test('FakeAIProvider exposes stable sanitized availability and timeout failures', async () => {
  assert.deepEqual(AI_PROVIDER_ERROR_CODES, [
    'AI_PROVIDER_INVALID_INPUT',
    'AI_PROVIDER_INVALID_OUTPUT',
    'AI_PROVIDER_UNAVAILABLE',
    'AI_PROVIDER_TIMEOUT',
    'AI_PROVIDER_FAILED',
  ]);
  for (const [failureMode, code] of [
    ['UNAVAILABLE', 'AI_PROVIDER_UNAVAILABLE'],
    ['TIMEOUT', 'AI_PROVIDER_TIMEOUT'],
    ['FAILED', 'AI_PROVIDER_FAILED'],
  ]) {
    const provider = new FakeAIProvider({ failureMode });
    await assert.rejects(provider.generateText(textRequest), (error) => {
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /secret|token|stack|vendor|prompt/i);
      return true;
    });
  }
});

test('AI provider result validators reject malformed or non-JSON output', () => {
  assert.throws(
    () => validateAITextGenerationResult({
      outputMode: 'TEXT',
      providerCode: 'GREEN_HIVE_FAKE_AI',
      modelCode: 'FAKE_DETERMINISTIC_V1',
      content: '',
      finishReason: 'STOP',
      usage: { inputTokens: 1, outputTokens: 0 },
    }),
    hasCode('AI_PROVIDER_INVALID_OUTPUT'),
  );
  assert.throws(
    () => validateAIStructuredGenerationResult({
      outputMode: 'STRUCTURED',
      providerCode: 'GREEN_HIVE_FAKE_AI',
      modelCode: 'FAKE_DETERMINISTIC_V1',
      value: { invalid: Number.NaN },
      finishReason: 'STOP',
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
    hasCode('AI_PROVIDER_INVALID_OUTPUT'),
  );
});

test('FakeAIProvider performs no network request in routine CI', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network access is forbidden in FakeAIProvider tests');
  };
  try {
    const provider = new FakeAIProvider();
    await provider.generateText(textRequest);
    await provider.generateStructured(structuredRequest);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
