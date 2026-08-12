import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPages, buildPagesForScenes, pageAt, MAX_WORDS_PER_PAGE } from '../src/lib/pages.mjs';

const words = (n, msPerWord = 400) =>
  Array.from({ length: n }, (_, i) => ({
    text: `слово${i}`,
    startMs: i * msPerWord,
    endMs: i * msPerWord + msPerWord - 50,
    timestampMs: i * msPerWord,
    confidence: null,
  }));

test('весь транскрипт не выводится одной страницей (регрессия C2)', () => {
  const pages = buildPages(words(110));
  assert.ok(pages.length > 1, 'должно получиться много страниц');
  for (const p of pages) {
    assert.ok(p.words.length <= MAX_WORDS_PER_PAGE, `страница из ${p.words.length} слов — больше предела`);
  }
});

test('ни одно слово не потеряно и порядок сохранён', () => {
  const src = words(37);
  const flat = buildPages(src).flatMap((p) => p.words.map((w) => w.text));
  assert.deepEqual(flat, src.map((w) => w.text));
});

test('в любой момент речи показывается ровно одна страница', () => {
  const src = words(40);
  const pages = buildPages(src);
  for (let ms = 0; ms < 16000; ms += 100) {
    const matching = pages.filter((p) => ms >= p.startMs && ms < p.untilMs);
    assert.ok(matching.length <= 1, `на ${ms} мс подошло ${matching.length} страниц`);
  }
  assert.ok(pageAt(pages, 5000), 'в середине речи страница должна быть');
});

test('страница держится до начала следующей — субтитр не мигает в паузах', () => {
  const pages = buildPages(words(12, 900));
  for (let i = 0; i + 1 < pages.length; i++) {
    assert.equal(pages[i].untilMs, pages[i + 1].startMs);
  }
});

test('пустой вход даёт пустой список', () => {
  assert.deepEqual(buildPages([]), []);
});

// Регрессия найдена на 1.2 с test-ok.mp4 (финальное ревью 06.08.2026): Kinetic
// сплющивал captions всех сцен в один список и отдавал его buildPages()
// целиком. Пауза между сценами короче COMBINE_MS (900 мс) — обычное дело при
// небольшом gapMs, — и combine-окно склеивало последние слова сцены N с
// первыми словами сцены N+1 в одну страницу: на экране заголовок сцены N,
// а в субтитре уже слово следующей сцены.
test('buildPagesForScenes: слова разных сцен не попадают в одну страницу', () => {
  // Сцена 0 кончается на 400 мс, сцена 1 начинается через 200 мс (300 < COMBINE_MS) —
  // ровно тот зазор, что раньше склеивался в один чанк.
  const scene0 = { captions: words(4, 100).map((w) => ({ ...w, text: `сцена0-${w.text}` })) }; // 0,100,200,300 мс
  const scene1 = {
    captions: words(2, 100).map((w) => ({
      ...w,
      text: `сцена1-${w.text}`,
      startMs: w.startMs + 600,
      endMs: w.endMs + 600,
    })),
  };

  const pages = buildPagesForScenes([scene0, scene1]);

  const scene0Texts = new Set(scene0.captions.map((c) => c.text));
  const scene1Texts = new Set(scene1.captions.map((c) => c.text));
  for (const p of pages) {
    const hasScene0 = p.words.some((w) => scene0Texts.has(w.text));
    const hasScene1 = p.words.some((w) => scene1Texts.has(w.text));
    assert.ok(!(hasScene0 && hasScene1), 'страница содержит слова из обеих сцен');
  }

  // Все слова обеих сцен по-прежнему на месте.
  const flat = pages.flatMap((p) => p.words.map((w) => w.text));
  assert.deepEqual(flat, [...scene0.captions, ...scene1.captions].map((w) => w.text));
});
