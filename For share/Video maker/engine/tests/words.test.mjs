import test from 'node:test';
import assert from 'node:assert/strict';
import { charsToWords } from '../scripts/lib/words.mjs';

const mk = (chars, starts, ends) => ({
  characters: chars,
  character_start_times_seconds: starts,
  character_end_times_seconds: ends,
});

test('разбивает по пробелам и даёт миллисекунды', () => {
  const a = mk(['д','а',' ','н','е','т'], [0,0.1,0.2,0.3,0.4,0.5], [0.1,0.2,0.3,0.4,0.5,0.6]);
  const w = charsToWords(a);
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { text: 'да', startMs: 0, endMs: 200, timestampMs: 0, confidence: null });
  assert.equal(w[1].text, 'нет');
  assert.equal(w[1].startMs, 300);
  assert.equal(w[1].endMs, 600);
});

test('точка и дефис не являются границей слова', () => {
  const chars = [...'т.д. что-то'];
  const starts = chars.map((_, i) => i / 10);
  const ends = chars.map((_, i) => (i + 1) / 10);
  const w = charsToWords(mk(chars, starts, ends));
  assert.deepEqual(w.map(x => x.text), ['т.д.', 'что-то']);
});

test('склеивает соседние числовые токены', () => {
  const chars = [...'5 000 штук'];
  const starts = chars.map((_, i) => i / 10);
  const ends = chars.map((_, i) => (i + 1) / 10);
  const w = charsToWords(mk(chars, starts, ends));
  assert.deepEqual(w.map(x => x.text), ['5 000', 'штук']);
  assert.equal(w[0].startMs, 0);
  assert.equal(w[0].endMs, 500);
});

test('обрезает краевые пробелы normalized_alignment', () => {
  const a = mk([' ','а',' '], [0,0.1,0.2], [0.1,0.2,0.3]);
  const w = charsToWords(a);
  assert.deepEqual(w.map(x => x.text), ['а']);
});

test('пустой вход даёт пустой массив', () => {
  assert.deepEqual(charsToWords(mk([], [], [])), []);
});
