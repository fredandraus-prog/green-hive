import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentRenderError, renderDocument } from '@green-hive/files';

test('GH-0603 renders deterministic bounded plain text without a template engine or network', () => {
  const rendered = renderDocument({
    format: 'TEXT',
    title: 'Green Hive project document',
    lines: ['Project: 20000000-0000-4000-8000-000000000161', 'Status: generated'],
  });
  assert.equal(rendered.mediaType, 'text/plain');
  assert.equal(rendered.extension, 'txt');
  assert.equal(new TextDecoder().decode(rendered.content),
    'Green Hive project document\nProject: 20000000-0000-4000-8000-000000000161\nStatus: generated\n');
});

test('GH-0603 renders a minimum valid ASCII PDF and escapes PDF control characters', () => {
  const rendered = renderDocument({
    format: 'PDF',
    title: 'Green Hive (private) report',
    lines: ['Project: 20000000-0000-4000-8000-000000000161', 'Path: \\opaque'],
  });
  const content = new TextDecoder().decode(rendered.content);
  assert.equal(rendered.mediaType, 'application/pdf');
  assert.equal(rendered.extension, 'pdf');
  assert.match(content, /^%PDF-1\.4\n/);
  assert.ok(content.includes('Green Hive \\(private\\) report'));
  assert.ok(content.includes('Path: \\\\opaque'));
  assert.match(content, /%%EOF\n$/);
});

test('GH-0603 rejects extra authority, controls, non-ASCII PDF and oversized render input', () => {
  for (const input of [
    { format: 'TEXT', title: 'Valid', lines: [], ownerUserId: 'forged' },
    { format: 'TEXT', title: 'Invalid\ncontrol', lines: [] },
    { format: 'PDF', title: 'Relatório', lines: ['acao'] },
    { format: 'TEXT', title: 'Valid', lines: Array.from({ length: 121 }, () => 'line') },
  ]) {
    assert.throws(() => renderDocument(input), DocumentRenderError);
  }
});
