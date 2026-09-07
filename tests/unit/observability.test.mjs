import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ObservabilityValidationError,
  structuredHttpEvent,
  writeOperationalEvent,
} from '../../packages/observability/dist/index.js';

const REQUEST_ID = '50000000-0000-4000-8000-000000000801';

test('GH-0802 emits only a bounded structured operational shape', () => {
  const event = structuredHttpEvent({
    operation: 'PAYMENT_WEBHOOK',
    outcome: 'FAILED',
    requestId: REQUEST_ID,
    correlationId: REQUEST_ID,
    durationMs: 42,
    statusCode: 503,
    errorCode: 'BILLING_WEBHOOK_PROCESSING_FAILED',
    providerCode: 'SANDBOX',
  });
  assert.deepEqual(event, {
    event: 'HTTP_REQUEST',
    component: 'REFERENCE_APP_HTTP',
    operation: 'PAYMENT_WEBHOOK',
    outcome: 'FAILED',
    requestId: REQUEST_ID,
    correlationId: REQUEST_ID,
    durationMs: 42,
    statusCode: 503,
    errorCode: 'BILLING_WEBHOOK_PROCESSING_FAILED',
    providerCode: 'SANDBOX',
  });
  assert.equal(Object.isFrozen(event), true);
});

test('GH-0802 rejects raw values and never lets a broken sink affect execution', () => {
  assert.throws(() => structuredHttpEvent({
    operation: 'project/secret-query',
    outcome: 'SUCCEEDED',
    requestId: REQUEST_ID,
    correlationId: REQUEST_ID,
    durationMs: 1,
    statusCode: 200,
  }), ObservabilityValidationError);

  const event = structuredHttpEvent({
    operation: 'PROJECT', outcome: 'DENIED', requestId: REQUEST_ID,
    correlationId: REQUEST_ID, durationMs: 0, statusCode: 403,
  });
  assert.doesNotThrow(() => writeOperationalEvent({ write() { throw new Error('sink unavailable'); } }, event));
});
