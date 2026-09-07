import assert from 'node:assert/strict';
import test from 'node:test';
import { HiveError, toPublicError } from '../../packages/core/dist/index.js';
import { AuthError } from '../../packages/auth/dist/index.js';
import { ProjectError } from '../../packages/projects/dist/index.js';

test('public error taxonomy maps published codes to stable categories and HTTP status', () => {
  assert.deepEqual(toPublicError(new AuthError('AUTH_INVALID_CREDENTIALS')), {
    code: 'AUTH_INVALID_CREDENTIALS',
    category: 'UNAUTHENTICATED',
    status: 401,
    retryable: false,
    message: 'Request could not be completed.',
  });
  assert.deepEqual(toPublicError(new ProjectError('PROJECT_NOT_FOUND')), {
    code: 'PROJECT_NOT_FOUND',
    category: 'NOT_FOUND',
    status: 404,
    retryable: false,
    message: 'Request could not be completed.',
  });
  assert.deepEqual(toPublicError(new HiveError('BUDGET_EXHAUSTED', 'sensitive implementation detail')), {
    code: 'BUDGET_EXHAUSTED',
    category: 'RESOURCE_EXHAUSTED',
    status: 409,
    retryable: false,
    message: 'Request could not be completed.',
  });
  assert.deepEqual(toPublicError({ code: 'ADMIN_ACCESS_DENIED' }), {
    code: 'ADMIN_ACCESS_DENIED',
    category: 'FORBIDDEN',
    status: 403,
    retryable: false,
    message: 'Request could not be completed.',
  });
});

test('unknown failures never disclose their code, message, stack or details', () => {
  const failure = Object.assign(
    new Error('SQLSTATE 23505 SELECT provider_secret FROM internal_table'),
    { code: 'POSTGRES_INTERNAL_DETAIL', details: { token: 'secret-value' } },
  );
  const publicError = toPublicError(failure);
  assert.deepEqual(publicError, {
    code: 'INTERNAL_ERROR',
    category: 'INTERNAL',
    status: 500,
    retryable: true,
    message: 'Request could not be completed.',
  });
  assert.doesNotMatch(JSON.stringify(publicError), /SQLSTATE|provider_secret|secret-value|POSTGRES_INTERNAL_DETAIL/i);
});

test('rate limiting is a typed retryable public error', () => {
  assert.deepEqual(toPublicError({ code: 'RATE_LIMITED' }), {
    code: 'RATE_LIMITED',
    category: 'RATE_LIMITED',
    status: 429,
    retryable: true,
    message: 'Request could not be completed.',
  });
});
