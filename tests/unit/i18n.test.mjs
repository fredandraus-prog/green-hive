import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  createTranslator,
  formatDateTime,
  languageForLocale,
  resolveLocale,
  translate,
} from '../../packages/i18n/dist/index.js';

test('i18n resolves only supported UI locales and safely falls back', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['pt-BR', 'en-US']);
  assert.equal(resolveLocale(['fr-FR', 'en-GB']), 'en-US');
  assert.equal(resolveLocale('pt'), 'pt-BR');
  assert.equal(resolveLocale('es-ES'), DEFAULT_LOCALE);
  assert.equal(resolveLocale({ locale: 'en-US' }), DEFAULT_LOCALE);
  assert.equal(languageForLocale('en-GB'), 'en');
});

test('i18n translates parameterized messages without treating values as markup', () => {
  assert.equal(translate('en-US', 'projects.description', { workspace: 'Acme' }), 'Organize the operational work for Acme.');
  assert.equal(translate('pt-BR', 'projects.createdAt', { date: '<script>' }), 'Criado em <script>');
  assert.equal(translate('en-US', 'projects.createdAt', {}), 'Created on {date}');
});

test('i18n formatting is deterministic with an explicit timezone and resilient to bad values', () => {
  const translator = createTranslator('en-US');
  assert.equal(translator.locale, 'en-US');
  assert.match(translator.formatDateTime('2026-01-02T03:04:05.000Z', { dateStyle: 'short' }, 'UTC'), /1\/2\/26/);
  assert.equal(formatDateTime('pt-BR', 'not-a-date'), '');
  assert.doesNotThrow(() => formatDateTime('en-US', '2026-01-02T03:04:05.000Z', { dateStyle: 'short' }, 'invalid/timezone'));
});
