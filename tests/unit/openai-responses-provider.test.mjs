import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIProviderError,
  OPENAI_CANONICAL_MODEL_CODE,
  OPENAI_PROVIDER_CODE,
  OpenAIResponsesProvider,
} from '../../packages/ai/dist/index.js';

const API_KEY = 'test-only-provider-credential-never-log';
const ENDPOINT = 'https://api.openai.com/v1/responses';
const textRequest = Object.freeze({
  operationId: 'openai-operation-text-0001',
  taskType: 'REFERENCE_APP_SUMMARIZE_PROJECT',
  modelClass: 'GENERAL_TEXT',
  input: 'Minimized project context',
  maxOutputTokens: 128,
});
const structuredRequest = Object.freeze({
  ...textRequest,
  operationId: 'openai-operation-structured-0001',
  taskType: 'REFERENCE_APP_STRUCTURED_ECHO',
  modelClass: 'GENERAL_STRUCTURED',
  outputSchemaId: 'REFERENCE_APP_ECHO_V1',
});
const strictSchema = Object.freeze({
  type: 'object',
  properties: {
    result: { type: 'string' },
  },
  required: ['result'],
  additionalProperties: false,
});
const profiles = Object.freeze([
  Object.freeze({
    taskType: textRequest.taskType,
    modelClass: textRequest.modelClass,
    outputMode: 'TEXT',
    instructions: 'Return one concise project summary.',
  }),
  Object.freeze({
    taskType: structuredRequest.taskType,
    modelClass: structuredRequest.modelClass,
    outputMode: 'STRUCTURED',
    outputSchemaId: structuredRequest.outputSchemaId,
    schemaName: 'reference_app_echo_v1',
    instructions: 'Return the exact registered provider-neutral result as JSON.',
    jsonSchema: strictSchema,
  }),
]);

function headers(contentLength = null) {
  return {
    get(name) {
      return name.toLowerCase() === 'content-length' ? contentLength : null;
    },
  };
}

function httpResponse(document, { status = 200, contentLength = null } = {}) {
  const body = typeof document === 'string' ? document : JSON.stringify(document);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(contentLength),
    async text() { return body; },
  };
}

function responseDocument(text, overrides = {}) {
  return {
    id: 'resp_test',
    object: 'response',
    status: 'completed',
    model: 'gpt-4o-mini-2024-07-18',
    output: [{
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    }],
    usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    ...overrides,
  };
}

function providerWith(fetch, overrides = {}) {
  return new OpenAIResponsesProvider({
    apiKey: API_KEY,
    fetch,
    taskProfiles: profiles,
    ...overrides,
  });
}

function hasCode(code) {
  return (error) => error instanceof AIProviderError && error.code === code;
}

test('OpenAI Responses text request has a fixed endpoint/model and server-owned authority', async () => {
  let transport;
  const fetch = async (url, init) => {
    transport = { url, init };
    return httpResponse(responseDocument('Bounded provider result'));
  };
  const provider = providerWith(fetch);
  const result = await provider.generateText(textRequest);

  assert.equal(transport.url, ENDPOINT);
  assert.equal(transport.init.method, 'POST');
  assert.equal(transport.init.headers.authorization, `Bearer ${API_KEY}`);
  assert.equal(transport.init.headers.accept, 'application/json');
  assert.equal(transport.init.headers['content-type'], 'application/json');
  const body = JSON.parse(transport.init.body);
  assert.deepEqual(body, {
    model: 'gpt-4o-mini-2024-07-18',
    instructions: 'Return one concise project summary.',
    input: [
      {
        role: 'developer',
        content: 'GREEN_HIVE_TASK_CONTEXT '
          + '{"operationId":"openai-operation-text-0001",'
          + '"taskType":"REFERENCE_APP_SUMMARIZE_PROJECT"}',
      },
      { role: 'user', content: 'Minimized project context' },
    ],
    max_output_tokens: 128,
    store: false,
  });
  assert.equal('tools' in body, false);
  assert.equal('metadata' in body, false);
  assert.equal(transport.init.body.includes(API_KEY), false);
  assert.equal(JSON.stringify(provider).includes(API_KEY), false);
  assert.deepEqual(result, {
    outputMode: 'TEXT',
    providerCode: OPENAI_PROVIDER_CODE,
    modelCode: OPENAI_CANONICAL_MODEL_CODE,
    content: 'Bounded provider result',
    finishReason: 'STOP',
    usage: { inputTokens: 11, outputTokens: 7 },
  });
});

test('OpenAI Responses structured request uses the exact strict server-owned schema', async () => {
  let requestBody;
  const value = {
    result: 'REFERENCE_APP_AI_SUCCESS',
  };
  const provider = providerWith(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return httpResponse(responseDocument(JSON.stringify(value)));
  });
  const result = await provider.generateStructured(structuredRequest);

  assert.deepEqual(requestBody.text, {
    format: {
      type: 'json_schema',
      name: 'reference_app_echo_v1',
      schema: strictSchema,
      strict: true,
    },
  });
  assert.deepEqual(requestBody.input, [
    {
      role: 'developer',
      content: 'GREEN_HIVE_TASK_CONTEXT '
        + '{"operationId":"openai-operation-structured-0001",'
        + '"taskType":"REFERENCE_APP_STRUCTURED_ECHO",'
        + '"outputSchemaId":"REFERENCE_APP_ECHO_V1"}',
    },
    { role: 'user', content: 'Minimized project context' },
  ]);
  assert.equal(requestBody.store, false);
  assert.equal('tools' in requestBody, false);
  assert.deepEqual(result, {
    outputMode: 'STRUCTURED',
    providerCode: 'OPENAI',
    modelCode: 'OPENAI_GPT_4O_MINI_2024_07_18',
    value,
    finishReason: 'STOP',
    usage: { inputTokens: 11, outputTokens: 7 },
  });
});

test('task, model class and schema profiles are exact and cannot be overridden by callers', async () => {
  let fetchCalls = 0;
  const provider = providerWith(async () => {
    fetchCalls += 1;
    return httpResponse(responseDocument('unexpected'));
  });
  for (const request of [
    { ...textRequest, taskType: 'REFERENCE_APP_UNKNOWN_TASK' },
    { ...textRequest, modelClass: 'GENERAL_STRUCTURED' },
    { ...textRequest, endpoint: 'https://attacker.invalid' },
    { ...textRequest, modelCode: 'FORGED_MODEL' },
    { ...textRequest, apiKey: 'caller-secret' },
  ]) {
    await assert.rejects(provider.generateText(request), hasCode('AI_PROVIDER_INVALID_INPUT'));
  }
  await assert.rejects(
    provider.generateStructured({ ...structuredRequest, outputSchemaId: 'REFERENCE_APP_OTHER_V1' }),
    hasCode('AI_PROVIDER_INVALID_INPUT'),
  );
  assert.equal(fetchCalls, 0);
  assert.throws(
    () => new OpenAIResponsesProvider({
      apiKey: API_KEY,
      endpoint: 'https://attacker.invalid',
      taskProfiles: profiles,
    }),
    hasCode('AI_PROVIDER_FAILED'),
  );
  assert.throws(
    () => new OpenAIResponsesProvider({
      apiKey: API_KEY,
      model: 'caller-model',
      taskProfiles: profiles,
    }),
    hasCode('AI_PROVIDER_FAILED'),
  );
});

test('strict schema profiles reject optional or open object fields before network use', () => {
  for (const jsonSchema of [
    {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: [],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
      additionalProperties: true,
    },
    {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: [],
          additionalProperties: false,
        },
      },
      required: ['nested'],
      additionalProperties: false,
    },
  ]) {
    assert.throws(
      () => new OpenAIResponsesProvider({
        apiKey: API_KEY,
        fetch: async () => httpResponse(responseDocument('unexpected')),
        taskProfiles: [{ ...profiles[1], jsonSchema }],
      }),
      hasCode('AI_PROVIDER_FAILED'),
    );
  }
});

test('HTTP, provider and network failures map to stable sanitized errors', async () => {
  for (const [status, code] of [
    [408, 'AI_PROVIDER_TIMEOUT'],
    [429, 'AI_PROVIDER_UNAVAILABLE'],
    [500, 'AI_PROVIDER_UNAVAILABLE'],
    [400, 'AI_PROVIDER_FAILED'],
    [401, 'AI_PROVIDER_FAILED'],
  ]) {
    const provider = providerWith(async () => httpResponse({
      error: { message: `${API_KEY} remote detail` },
    }, { status }));
    await assert.rejects(provider.generateText(textRequest), (error) => {
      assert.ok(hasCode(code)(error));
      assert.doesNotMatch(error.message, new RegExp(API_KEY));
      assert.doesNotMatch(error.message, /remote detail|stack|prompt/i);
      return true;
    });
  }

  const providerError = providerWith(async () => httpResponse({
    status: 'failed',
    error: { message: `${API_KEY} provider internal error` },
  }));
  await assert.rejects(
    providerError.generateText(textRequest),
    hasCode('AI_PROVIDER_FAILED'),
  );

  const networkError = providerWith(async () => {
    throw new Error(`${API_KEY} socket failure`);
  });
  await assert.rejects(networkError.generateText(textRequest), (error) => {
    assert.ok(hasCode('AI_PROVIDER_UNAVAILABLE')(error));
    assert.doesNotMatch(error.message, new RegExp(API_KEY));
    assert.doesNotMatch(error.message, /socket/i);
    return true;
  });
});

test('hard timeout aborts a stalled injected transport without making a real request', async () => {
  let capturedSignal;
  const provider = providerWith(async (_url, init) => {
    capturedSignal = init.signal;
    return new Promise(() => {});
  }, { timeoutMs: 100 });
  await assert.rejects(provider.generateText(textRequest), (error) => {
    assert.ok(hasCode('AI_PROVIDER_TIMEOUT')(error));
    assert.doesNotMatch(error.message, new RegExp(API_KEY));
    return true;
  });
  assert.equal(capturedSignal.aborted, true);
});

test('refusal and unsupported incomplete responses fail closed', async () => {
  const refusal = providerWith(async () => httpResponse(responseDocument('', {
    output: [{
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'refusal', refusal: `${API_KEY} refused detail` }],
    }],
  })));
  await assert.rejects(refusal.generateText(textRequest), (error) => {
    assert.ok(hasCode('AI_PROVIDER_FAILED')(error));
    assert.doesNotMatch(error.message, new RegExp(API_KEY));
    return true;
  });

  const filtered = providerWith(async () => httpResponse(responseDocument('partial', {
    status: 'incomplete',
    incomplete_details: { reason: 'content_filter' },
  })));
  await assert.rejects(
    filtered.generateText(textRequest),
    hasCode('AI_PROVIDER_FAILED'),
  );
});

test('bounded parser supports text length completion but rejects incomplete structured JSON', async () => {
  const textProvider = providerWith(async () => httpResponse(responseDocument('truncated', {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
  })));
  const textResult = await textProvider.generateText(textRequest);
  assert.equal(textResult.content, 'truncated');
  assert.equal(textResult.finishReason, 'LENGTH');

  const structuredProvider = providerWith(async () => httpResponse(responseDocument('{', {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
  })));
  await assert.rejects(
    structuredProvider.generateStructured(structuredRequest),
    hasCode('AI_PROVIDER_INVALID_OUTPUT'),
  );
});

test('malformed and oversized response bodies are rejected as invalid output', async () => {
  const oversizedChunk = new TextEncoder().encode('x'.repeat(1_048_577));
  const oversizedStream = {
    ok: true,
    status: 200,
    headers: headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedChunk);
      },
    }),
    async text() { throw new Error('streaming parser must not use text()'); },
  };
  const cases = [
    httpResponse('not-json'),
    httpResponse({ status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } }),
    httpResponse(responseDocument('ok', { model: 'gpt-4o-mini' })),
    httpResponse(responseDocument('ok', { usage: { input_tokens: -1, output_tokens: 1 } })),
    httpResponse('{}', { contentLength: '1048577' }),
    httpResponse(`{"padding":"${'x'.repeat(1_048_576)}"}`),
    httpResponse(responseDocument('x'.repeat(262_145))),
    oversizedStream,
  ];
  for (const response of cases) {
    const provider = providerWith(async () => response);
    await assert.rejects(
      provider.generateText(textRequest),
      hasCode('AI_PROVIDER_INVALID_OUTPUT'),
    );
  }
});

test('all focused provider tests use injected transport and never call global fetch', async () => {
  const originalFetch = globalThis.fetch;
  let globalCalls = 0;
  globalThis.fetch = async () => {
    globalCalls += 1;
    throw new Error('real network forbidden');
  };
  try {
    const provider = providerWith(async () => httpResponse(responseDocument('injected')));
    assert.equal((await provider.generateText(textRequest)).content, 'injected');
    assert.equal(globalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
