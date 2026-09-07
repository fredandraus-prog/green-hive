import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  clientErrorMessage,
  platformErrorCategory,
} from '../../apps/hive-reference-app/dist/frontend-contracts.js';

test('browser maps public errors locally without accepting a server message', () => {
  const category = platformErrorCategory('UNAVAILABLE');
  const message = clientErrorMessage('PROJECT_OPERATION_FAILED', category);
  assert.equal(category, 'UNAVAILABLE');
  assert.equal(message, 'O serviço está temporariamente indisponível. Tente novamente.');
  assert.doesNotMatch(message, /SELECT|secret_value|private_table/i);
  assert.equal(platformErrorCategory('POSTGRES_INTERNAL_DETAIL'), 'INTERNAL');
});

test('browser API consumes only the reviewed error fields', async () => {
  const source = await readFile(
    new URL('../../apps/hive-reference-app/src/web/api.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /clientErrorMessage\(code, category\)/);
  assert.match(source, /platformErrorCategory\(payload\.error\?\.category\)/);
  assert.doesNotMatch(source, /payload\.error\?\.message/);
});
