import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalReleaseContent } from '../../scripts/lib/release-content.mjs';

test('release manifest canonicalizes Windows text line endings to LF', () => {
  const windows = Buffer.from('first\r\nsecond\r\n', 'utf8');
  const linux = Buffer.from('first\nsecond\n', 'utf8');
  assert.deepEqual(canonicalReleaseContent(windows), linux);
  assert.deepEqual(canonicalReleaseContent(linux), linux);
});

test('release manifest preserves non-UTF-8 binary bytes exactly', () => {
  const binary = Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x80]);
  assert.deepEqual(canonicalReleaseContent(binary), binary);
});
