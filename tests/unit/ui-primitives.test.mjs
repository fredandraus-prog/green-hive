import assert from 'node:assert/strict';
import test from 'node:test';
import { Field, LoadingPanel, Message, SelectField, UI_STATUS } from '../../packages/ui/dist/index.js';

test('shared UI primitives preserve labels, hints and native form semantics', () => {
  assert.equal(UI_STATUS, 'GH-0702');
  const field = Field({ label: 'Name', name: 'displayName', hint: 'Visible to your team', required: true });
  assert.equal(field.type, 'label');
  assert.equal(field.props.className, 'field');
  const children = field.props.children;
  assert.equal(children[0].props.children, 'Name');
  assert.equal(children[1].type, 'input');
  assert.equal(children[1].props.name, 'displayName');
  assert.equal(children[1].props.required, true);
  assert.equal(children[2].type, 'small');

  const select = SelectField({ label: 'Locale', name: 'locale', children: 'options', required: true });
  assert.equal(select.type, 'label');
  assert.equal(select.props.children[1].type, 'select');
  assert.equal(select.props.children[1].props.name, 'locale');
});

test('shared status primitives use accessible roles without application behavior', () => {
  assert.equal(Message({ children: 'Problem' }).props.role, 'alert');
  assert.equal(Message({ children: 'Saved', kind: 'success' }).props.role, 'status');
  const loading = LoadingPanel({ label: 'Loading workspace' });
  assert.equal(loading.props.role, 'status');
  assert.equal(loading.props['aria-live'], 'polite');
  assert.equal(loading.props.children[0].props['aria-hidden'], true);
  assert.equal(loading.props.children[1].props.children, 'Loading workspace');
});
