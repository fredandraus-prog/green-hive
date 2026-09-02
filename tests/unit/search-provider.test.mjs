import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEARCH_CONTENT_TRUST,
  SEARCH_PROVIDER_ERROR_CODES,
  FakeSearchProvider,
  SearchProviderError,
  validateSearchProviderResult,
} from '../../packages/search/dist/index.js';

const request = Object.freeze({
  operationId: 'search-provider-operation-0001',
  query: 'bounded deterministic search query',
  maxResults: 2,
});

const configuredResults = () => [
  {
    rank: 1,
    title: 'REFERENCE_RESULT_ONE',
    url: 'https://example.invalid/search/result-one',
    snippet: 'First untrusted provider result.',
  },
  {
    rank: 2,
    title: 'REFERENCE_RESULT_TWO',
    url: 'https://example.invalid/search/result-two',
    snippet: null,
  },
];

function hasCode(code) {
  return (error) => error instanceof SearchProviderError && error.code === code;
}

test('FakeSearchProvider returns deterministic normalized untrusted results and usage', async () => {
  const provider = new FakeSearchProvider();
  const first = await provider.search(request);
  const second = await provider.search(request);

  assert.deepEqual(first, second);
  assert.equal(first.providerCode, 'GREEN_HIVE_FAKE_SEARCH');
  assert.equal(first.contentTrust, SEARCH_CONTENT_TRUST);
  assert.equal(first.contentTrust, 'UNTRUSTED_EXTERNAL_DATA');
  assert.deepEqual(first.usage, { requestCount: 1, resultCount: 2 });
  assert.deepEqual(first.results.map(({ rank, title, url }) => ({ rank, title, url })), [
    {
      rank: 1,
      title: 'GREEN_HIVE_FAKE_SEARCH_RESULT_1',
      url: 'https://example.invalid/green-hive/fake-search/1',
    },
    {
      rank: 2,
      title: 'GREEN_HIVE_FAKE_SEARCH_RESULT_2',
      url: 'https://example.invalid/green-hive/fake-search/2',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(first), /bounded deterministic search query/);
});

test('FakeSearchProvider defensively copies configuration and every returned result', async () => {
  const source = configuredResults();
  const provider = new FakeSearchProvider({ results: source });
  source[0].title = 'MUTATED_AFTER_CONSTRUCTION';
  source.push({
    rank: 3,
    title: 'FORGED_EXTRA_RESULT',
    url: 'https://example.invalid/search/forged',
    snippet: null,
  });

  const first = await provider.search({ ...request, maxResults: 1 });
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].title, 'REFERENCE_RESULT_ONE');
  assert.equal(first.usage.resultCount, 1);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.results));
  assert.ok(Object.isFrozen(first.results[0]));
  assert.throws(() => {
    first.results[0].title = 'MUTATED_RETURN_VALUE';
  }, TypeError);

  const second = await provider.search({ ...request, maxResults: 1 });
  assert.deepEqual(second, first);
  assert.notStrictEqual(second, first);
  assert.notStrictEqual(second.results, first.results);
  assert.notStrictEqual(second.results[0], first.results[0]);
});

test('Search provider requests reject authority, secrets and invalid query or limit values', async () => {
  const provider = new FakeSearchProvider();
  for (const candidate of [
    { ...request, appId: '00000000-0000-4000-8000-000000000001' },
    { ...request, ownerUserId: '10000000-0000-4000-8000-000000000001' },
    { ...request, providerCode: 'FORGED_PROVIDER' },
    { ...request, apiKey: 'provider-secret' },
    { ...request, operationId: 'short' },
    { ...request, query: ' ' },
    { ...request, query: 'x'.repeat(4_097) },
    { ...request, maxResults: 0 },
    { ...request, maxResults: 51 },
    { ...request, maxResults: 1.5 },
  ]) {
    await assert.rejects(provider.search(candidate), hasCode('SEARCH_PROVIDER_INVALID_INPUT'));
  }

  assert.throws(
    () => new FakeSearchProvider({ apiKey: 'provider-secret' }),
    hasCode('SEARCH_PROVIDER_FAILED'),
  );
  assert.throws(
    () => new FakeSearchProvider({ failureMode: 'UNKNOWN' }),
    hasCode('SEARCH_PROVIDER_FAILED'),
  );
  assert.throws(
    () => new FakeSearchProvider({ results: [{ forged: true }] }),
    hasCode('SEARCH_PROVIDER_FAILED'),
  );
});

test('Search result validation enforces untrusted content, rank, HTTPS, uniqueness and exact usage', () => {
  const valid = {
    providerCode: 'GREEN_HIVE_FAKE_SEARCH',
    contentTrust: SEARCH_CONTENT_TRUST,
    results: configuredResults(),
    usage: { requestCount: 1, resultCount: 2 },
  };
  assert.equal(validateSearchProviderResult(valid, 2).results.length, 2);

  const invalidResults = [
    { ...valid, contentTrust: 'TRUSTED_HTML' },
    { ...valid, providerResponse: 'raw-provider-body' },
    { ...valid, results: [{ ...valid.results[0], rank: 2 }], usage: { requestCount: 1, resultCount: 1 } },
    { ...valid, results: [{ ...valid.results[0], url: 'http://example.invalid/result' }], usage: { requestCount: 1, resultCount: 1 } },
    { ...valid, results: [{ ...valid.results[0], url: 'https://user:pass@example.invalid/result' }], usage: { requestCount: 1, resultCount: 1 } },
    { ...valid, results: [valid.results[0], { ...valid.results[1], url: valid.results[0].url }] },
    { ...valid, usage: { requestCount: 2, resultCount: 2 } },
    { ...valid, usage: { requestCount: 1, resultCount: 1 } },
  ];
  for (const candidate of invalidResults) {
    assert.throws(
      () => validateSearchProviderResult(candidate, 2),
      hasCode('SEARCH_PROVIDER_INVALID_OUTPUT'),
    );
  }
});

test('FakeSearchProvider exposes stable sanitized unavailable, timeout and generic failures', async () => {
  assert.deepEqual(SEARCH_PROVIDER_ERROR_CODES, [
    'SEARCH_PROVIDER_INVALID_INPUT',
    'SEARCH_PROVIDER_INVALID_OUTPUT',
    'SEARCH_PROVIDER_UNAVAILABLE',
    'SEARCH_PROVIDER_TIMEOUT',
    'SEARCH_PROVIDER_FAILED',
  ]);

  for (const [failureMode, code] of [
    ['UNAVAILABLE', 'SEARCH_PROVIDER_UNAVAILABLE'],
    ['TIMEOUT', 'SEARCH_PROVIDER_TIMEOUT'],
    ['FAILED', 'SEARCH_PROVIDER_FAILED'],
  ]) {
    const provider = new FakeSearchProvider({ failureMode });
    await assert.rejects(provider.search(request), (error) => {
      assert.ok(error instanceof SearchProviderError);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /query|secret|token|stack|vendor|provider response/i);
      return true;
    });
  }
});

test('FakeSearchProvider performs no network request in routine development or CI', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network access is forbidden in FakeSearchProvider tests');
  };
  try {
    const provider = new FakeSearchProvider({ results: configuredResults() });
    await provider.search(request);
    await provider.search({ ...request, operationId: 'search-provider-operation-0002' });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
