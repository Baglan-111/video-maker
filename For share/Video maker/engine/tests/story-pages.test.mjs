import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryPages, stripPunctuation } from '../src/lib/story-pages.mjs';

// Каждый тест здесь закрывает дефект, найденный на готовом mp4 первой сборки
// mvp-palatka. Все они тихие: ролик собирался, файл был валиден, ошибок не было,
// а субтитры при этом рвали слова и отставали от речи. Глазами по семи кадрам
// такое не ловится — только расчётом, поэтому проверка живёт в тестах.

const w = (text, startMs, endMs) => ({ text, startMs, endMs });
const textsOf = (pages) => pages.map((p) => p.words.map((x) => x.text).join(' '));

test('конец предложения всегда закрывает страницу', () => {
  const pages = buildStoryPages([
    w('не', 0, 200), w('что', 200, 400), w('выкинуть.', 400, 900),
    w('Правильный', 1000, 1500), w('вопрос', 1500, 1900),
  ]);
  assert.deepEqual(textsOf(pages), ['не что выкинуть.', 'Правильный вопрос']);
});

test('пауза в речи разделяет страницы — говорящий сам поставил границу', () => {
  const pages = buildStoryPages([
    w('раз', 0, 300), w('два', 300, 600),
    // пауза 800 мс
    w('три', 1400, 1700),
  ]);
  assert.deepEqual(textsOf(pages), ['раз два', 'три']);
});

test('страница не заканчивается предлогом — он уезжает к своему слову', () => {
  // Ровно случай «версия продукта, из» / «-за этой путаницы» из первой сборки,
  // только с целым предлогом.
  const pages = buildStoryPages(
    [w('маленькая', 0, 400), w('версия', 400, 800), w('продукта', 800, 1200), w('из', 1200, 1400),
     w('этой', 1400, 1700), w('путаницы', 1700, 2100)],
    { maxWords: 4 },
  );
  for (const t of textsOf(pages)) {
    assert.ok(!/\bиз$/.test(t), `страница кончается предлогом: «${t}»`);
  }
  assert.ok(textsOf(pages).some((t) => t.startsWith('из ')), 'предлог должен открыть следующую страницу');
});

test('запятая закрывает страницу, если на ней уже есть два слова', () => {
  const pages = buildStoryPages([
    w('А', 0, 200), w('вот', 200, 400), w('палатка,', 400, 900),
    w('она', 900, 1100), w('меньше', 1100, 1500),
  ]);
  assert.equal(textsOf(pages)[0], 'А вот палатка,');
});

test('длинные слова режутся по символам, а не только по счёту слов', () => {
  const pages = buildStoryPages(
    [w('переночевать', 0, 600), w('сегодня', 600, 1000), w('целиком', 1000, 1400)],
    { maxWords: 5, maxChars: 22 },
  );
  assert.ok(pages.length >= 2, 'три длинных слова не должны стоять на одной странице');
  for (const p of pages) {
    const chars = p.words.reduce((n, x) => n + x.text.length, 0) + p.words.length - 1;
    assert.ok(chars <= 22, `страница длиннее лимита: ${chars}`);
  }
});

test('страницы не перекрываются — субтитр не отстаёт от речи', () => {
  const pages = buildStoryPages([
    w('первая.', 0, 500),
    w('вторая', 600, 1000), w('фраза.', 1000, 1400),
    w('третья.', 1500, 2000),
  ]);
  for (let i = 1; i < pages.length; i += 1) {
    assert.ok(
      pages[i - 1].untilMs <= pages[i].startMs,
      `страница ${i - 1} держится до ${pages[i - 1].untilMs}, а ${i} начинается в ${pages[i].startMs}`,
    );
  }
});

test('последняя страница держится дольше конца речи, но не бесконечно', () => {
  const pages = buildStoryPages([w('всё.', 0, 500)], { tailMs: 400 });
  assert.equal(pages[0].untilMs, 900);
});

test('пустой вход не роняет разбивку', () => {
  assert.deepEqual(buildStoryPages([]), []);
  assert.deepEqual(buildStoryPages(null), []);
});

// ── Очистка пунктуации в субтитрах ───────────────────────────────────────────
//
// Снимается только с показа. В данных знаки остаются: по ним разбивка ставит
// границы страниц, а детекторы приёмки ищут обрубки слов.

test('снимает знаки препинания с краёв слова', () => {
  assert.equal(stripPunctuation('Плохо,'), 'Плохо');
  assert.equal(stripPunctuation('месяцы.'), 'месяцы');
  assert.equal(stripPunctuation('выкинуть?'), 'выкинуть');
  assert.equal(stripPunctuation('целиком!'), 'целиком');
  assert.equal(stripPunctuation('«палатка»'), 'палатка');
});

test('сохраняет дефис внутри слова — «из-за» это одно слово', () => {
  assert.equal(stripPunctuation('из-за'), 'из-за');
  assert.equal(stripPunctuation('из-за,'), 'из-за');
});

test('снимает тире по краям — это остаток речи, а не часть слова', () => {
  assert.equal(stripPunctuation('—'), '');
  assert.equal(stripPunctuation('-за'), 'за');
});

test('не трогает обычное слово и цифры', () => {
  assert.equal(stripPunctuation('палатка'), 'палатка');
  assert.equal(stripPunctuation('100'), '100');
});
