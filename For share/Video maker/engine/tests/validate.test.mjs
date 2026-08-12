import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSay } from '../scripts/lib/validate.mjs';

test('чистая фраза проходит', () => {
  const r = validateSay('Пять тысяч тенге и так далее');
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('символ валюты — ошибка SYMBOL', () => {
  const r = validateSay('Стоит 5000 ₸');
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'SYMBOL');
});

test('сокращение — ошибка ABBREV', () => {
  const r = validateSay('деньги и т.д.');
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'ABBREV');
});

test('число с пробелом — ошибка SPACED_NUMBER', () => {
  const r = validateSay('стоит 5 000 рублей');
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'SPACED_NUMBER');
});

test('латиница — предупреждение, не ошибка', () => {
  const r = validateSay('открой Figma и рисуй');
  assert.equal(r.ok, true);
  assert.equal(r.warnings[0].code, 'LATIN');
});

test('несколько нарушений возвращаются все', () => {
  const r = validateSay('5 000 ₸ и т.п.');
  assert.deepEqual(new Set(r.errors.map(e => e.code)), new Set(['SYMBOL','ABBREV','SPACED_NUMBER']));
});

test('регрессия: буква г в конце слова не триггерит ABBREV', () => {
  const falseCases = [
    'У него был большой долг.',
    'Растёт красивый кедр.',
    'Это случилось в один миг.',
    'Сделай ещё один шаг.',
    'У бабушки есть старый утюг.'
  ];
  falseCases.forEach(text => {
    const r = validateSay(text);
    assert.equal(r.ok, true, `"${text}" должна пройти без ошибок`);
    assert.deepEqual(r.errors, [], `"${text}" не должна иметь ошибок ABBREV`);
  });
});

test('регрессия: настоящие сокращения ловятся правильно', () => {
  const trueCases = [
    { text: 'деньги и т.д.', hasAbbrev: true },
    { text: 'вещи и т. п.', hasAbbrev: true },
    { text: 'смотри др.', hasAbbrev: true },
    { text: '500 руб.', hasAbbrev: true }
  ];
  trueCases.forEach(({ text, hasAbbrev }) => {
    const r = validateSay(text);
    const hasAbbrevError = r.errors.some(e => e.code === 'ABBREV');
    assert.equal(hasAbbrevError, hasAbbrev, `"${text}" должна иметь ABBREV`);
  });
});
