import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findClicks,
  findEmptySceneStarts,
  findLateSceneStarts,
  findStaleTimeline,
  findPageOverlaps,
  findLostWords,
  findTornTokens,
  findSceneGaps,
  findOversizedPages,
  findBrightnessJumps,
} from '../src/lib/story-checks.mjs';
import { buildStoryPages } from '../src/lib/story-pages.mjs';
import { buildPagesForScenes } from '../src/lib/pages.mjs';
import { fileURLToPath } from 'node:url';

// ДОКАЗАТЕЛЬСТВО механизма приёмки (урок L007).
//
// Правило реестра уроков: механизм не считается работающим, пока не показано,
// что он ловит ИСХОДНЫЙ случай — и что не срабатывает вхолостую. Поэтому здесь
// каждый детектор прогоняется дважды: на сломанных данных (обязан найти) и на
// здоровых (обязан молчать).
//
// Особый вес у первого теста: он воспроизводит дефект не выдуманными числами, а
// прогоном ПРЕЖНЕГО алгоритма разбивки, который и пропустил приёмку 11.08.2026.

const w = (text, startMs, endMs) => ({ text, startMs, endMs, timestampMs: null, confidence: 1 });

test('ловит исходный дефект: прежняя разбивка по сценам даёт отставание субтитров', () => {
  // Структура ровно как в mvp-palatka: две сцены встык, речь идёт сквозь
  // границу без паузы. Прежний buildPagesForScenes строил страницы отдельно по
  // сценам, и последняя страница сцены висела ещё 400 мс поверх первой страницы
  // следующей.
  const scenes = [
    { captions: [w('это', 3000, 3300), w('плохо.', 3300, 4000)] },
    { captions: [w('Дом', 4100, 4500), w('в', 4500, 4700), w('четверть', 4700, 5300)] },
  ];

  const oldPages = buildPagesForScenes(scenes);
  const found = findPageOverlaps(oldPages);
  assert.ok(found.length > 0, 'детектор обязан увидеть отставание прежнего алгоритма');

  // И тот же вход через нынешнюю разбивку — чисто.
  const newPages = buildStoryPages(scenes.flatMap((s) => s.captions));
  assert.deepEqual(findPageOverlaps(newPages), [], 'нынешняя разбивка перекрытий давать не должна');
});

test('не срабатывает вхолостую: страницы встык перекрытием не считаются', () => {
  const pages = [
    { startMs: 0, endMs: 900, untilMs: 1000, words: [w('раз', 0, 900)] },
    { startMs: 1000, endMs: 1800, untilMs: 2200, words: [w('два', 1000, 1800)] },
  ];
  assert.deepEqual(findPageOverlaps(pages), []);
});

test('ловит потерянные слова — они исчезли бы из ролика молча', () => {
  const captions = [w('раз', 0, 500), w('два', 600, 1000), w('три', 1100, 1500)];
  const pages = [{ startMs: 0, endMs: 1000, untilMs: 1100, words: [captions[0], captions[1]] }];
  const lost = findLostWords(captions, pages);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].text, 'три');
});

test('ловит обрубок слова — исходный случай «из» / «-за»', () => {
  const captions = [w('из', 1200, 1400), w('-за', 1400, 1600), w('этой', 1600, 1900)];
  const torn = findTornTokens(captions);
  assert.equal(torn.length, 1);
  assert.equal(torn[0].text, '-за');

  // Склеенный вариант, который отдаёт нынешний prepare-source, детектор
  // пропускает — иначе проверка ругалась бы на каждое слово с дефисом.
  assert.deepEqual(findTornTokens([w('из-за', 1200, 1600)]), []);
});

test('ловит разрыв раскадровки и молчит на встык', () => {
  const gap = findSceneGaps([
    { startMs: 0, endMs: 4000 },
    { startMs: 4500, endMs: 8000 },
  ]);
  assert.equal(gap.length, 1);
  assert.equal(gap[0].expectedMs, 4000);
  assert.equal(gap[0].actualMs, 4500);

  assert.deepEqual(
    findSceneGaps([
      { startMs: 0, endMs: 4000 },
      { startMs: 4000, endMs: 8000 },
    ]),
    [],
  );
});

test('ловит страницу, которая не влезет в отведённую полосу', () => {
  const long = { words: [w('переночевать', 0, 500), w('сегодня', 500, 900), w('целиком', 900, 1300)] };
  const short = { words: [w('это', 0, 300), w('дом,', 300, 700)] };
  assert.equal(findOversizedPages([long, short], 20).length, 1);
  assert.deepEqual(findOversizedPages([short], 20), []);
});

test('ловит вспышку между врезками — исходный случай 12,47 с', () => {
  // Числа из реального замера сборки 11.08.2026: фон врезки держался на 25,6,
  // затем кадр показал живое видео на 59,9 — и фон ВЕРНУЛСЯ. Именно возврат
  // отличает вспышку от монтажной склейки, поэтому он есть и в тесте.
  const frames = [
    { atSec: 12.40, yavg: 25.6 },
    { atSec: 12.43, yavg: 25.6 },
    { atSec: 12.47, yavg: 59.9 },
    { atSec: 12.50, yavg: 52.1 },
    { atSec: 12.60, yavg: 36.2 },
    { atSec: 12.70, yavg: 25.8 },
    { atSec: 12.80, yavg: 25.6 },
  ];
  const jumps = findBrightnessJumps(frames);
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].atSec, 12.47);
  assert.ok(jumps[0].deltaY > 30, `скачок должен быть заметным: ${jumps[0].deltaY}`);
});

test('одиночная резкая склейка дефектом не считается', () => {
  // С 11.08.2026 врезки входят и выходят резко — это приём, а не рывок.
  // Кадр уходит на новый уровень и там остаётся: возврата нет.
  const frames = [
    ...Array.from({ length: 10 }, (_, i) => ({ atSec: 18.5 + i * 0.033, yavg: 25.6 })),
    ...Array.from({ length: 20 }, (_, i) => ({ atSec: 18.9 + i * 0.033, yavg: 63.0 })),
  ];
  assert.deepEqual(findBrightnessJumps(frames), []);
});

test('не срабатывает на плавном затухании — то, как стало после починки', () => {
  // Замер починенного выхода: 39,9 → 63,0 за десять кадров, шаг около 3 единиц.
  const frames = [39.9, 43.7, 46.8, 49.8, 52.2, 54.2, 56.0, 57.3, 58.2, 63.0]
    .map((yavg, i) => ({ atSec: 18.6 + i * 0.033, yavg }));
  assert.deepEqual(findBrightnessJumps(frames), []);
});

test('не считает дефектом смену рисунка внутри врезки', () => {
  // Замер 11.08.2026, стык «дом → палатка»: яркость 24 → 14 при уровне живого
  // видео 94. Кадр остаётся закрыт графикой, прорыва видео нет.
  const frames = [
    ...Array.from({ length: 20 }, (_, i) => ({ atSec: i * 0.033, yavg: 94 })),
    { atSec: 12.43, yavg: 24.1 },
    { atSec: 12.47, yavg: 14.4 },
    { atSec: 12.50, yavg: 15.1 },
  ];
  const jumps = findBrightnessJumps(frames);
  assert.ok(!jumps.some((j) => Math.abs(j.atSec - 12.47) < 0.01), 'смена рисунка не дефект');
});

test('порог настраивается', () => {
  // Скачок с возвратом: 20 → 30 → 20. По доле это 33 %.
  const frames = [
    { atSec: 0, yavg: 20 },
    { atSec: 0.03, yavg: 30 },
    { atSec: 0.06, yavg: 20 },
  ];
  assert.equal(findBrightnessJumps(frames, 0.5).length, 0);
  assert.equal(findBrightnessJumps(frames, 0.2).length, 1);
});

test('не считает дефектом штатное затемнение на светлом кадре', () => {
  // Замер после цветокоррекции 11.08.2026: вход во врезку, шаги по 15 единиц
  // при яркости 104. Абсолютный порог 12 объявлял это дефектом; относительный
  // видит 14 % и молчит.
  const frames = [104.0, 88.8, 76.4, 65.7, 56.6, 48.4, 41.5, 35.1, 29.0, 24.7]
    .map((yavg, i) => ({ atSec: 8.3 + i * 0.033, yavg }));
  assert.deepEqual(findBrightnessJumps(frames), []);
});

// Прогон на реальном ролике, если он на месте: синтетика проверяет логику,
// живой файл — что логика применима к настоящим данным. Отсутствие проекта не
// должно валить тесты на чужой машине.
test('реальный mvp-palatka проходит все детекторы', (t) => {
  const tl = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'projects', 'mvp-palatka', 'audio', 'timeline.json',
  );
  if (!fs.existsSync(tl)) return t.skip('проект mvp-palatka не найден');

  const timeline = JSON.parse(fs.readFileSync(tl, 'utf8'));
  const captions = timeline.scenes.flatMap((s) => s.captions);
  const pages = buildStoryPages(captions);

  assert.deepEqual(findPageOverlaps(pages), []);
  assert.deepEqual(findLostWords(captions, pages), []);
  assert.deepEqual(findTornTokens(captions), []);
  assert.deepEqual(findOversizedPages(pages), []);
});

test('таймлайн старше раскадровки — ошибка с подсказкой', () => {
  const msg = findStaleTimeline({ videoMtimeMs: 5000, timelineMtimeMs: 2000, maker: 'prepare-source.mjs' });
  assert.match(msg, /не пересобраны/);
  assert.match(msg, /prepare-source\.mjs/);
});

test('таймлайн свежее раскадровки — молчит', () => {
  assert.equal(findStaleTimeline({ videoMtimeMs: 2000, timelineMtimeMs: 5000, maker: 'x' }), null);
  assert.equal(findStaleTimeline({ videoMtimeMs: 2000, timelineMtimeMs: 2000, maker: 'x' }), null);
});

test('щелчок в дорожке пойман, чистая волна — нет', () => {
  const clean = Int16Array.from({ length: 480 }, (_, i) => Math.round(9000 * Math.sin(i / 8)));
  assert.equal(findClicks(clean).length, 0);
  const broken = Int16Array.from(clean);
  broken[200] = 30000;
  assert.equal(findClicks(broken).length, 2); // вход в разрыв и выход из него
});

test('врезка, въезжающая пустой, поймана', () => {
  const found = findEmptySceneStarts([
    { kind: 'accent', inkStart: 10, inkMid: 1000 },
    { kind: 'house', inkStart: 900, inkMid: 1000 },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'accent');
});

test('врезка с паузой после слова поймана, встык — нет', () => {
  const words = [{ text: 'плохо', startMs: 7580, endMs: 7920 }];
  const late = findLateSceneStarts([{ kind: 'house', startMs: 8260, fullscreen: true }], words);
  assert.equal(late.length, 1);
  assert.equal(late[0].gapMs, 340);
  assert.equal(findLateSceneStarts([{ kind: 'house', startMs: 7930, fullscreen: true }], words).length, 0);
});

test('говорящая голова после паузы дефектом не считается', () => {
  const words = [{ text: 'плохо', startMs: 7580, endMs: 7920 }];
  assert.equal(findLateSceneStarts([{ kind: 'talkingHead', startMs: 8600, fullscreen: false }], words).length, 0);
});
