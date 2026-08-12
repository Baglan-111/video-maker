import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryTimeline } from '../scripts/lib/story-timeline.mjs';
import { parseVideoJson } from '../src/lib/video-schema.mjs';

// Что здесь проверяется и почему именно это.
//
// У story@1 два класса дефектов, которые НЕ видно на превью и легко пропустить
// на приёмке: (1) кадры, не покрытые ни одной сценой — зритель видит голое
// видео там, где ждал графику; (2) слова, не попавшие ни в одну сцену — они
// молча исчезают из субтитров. Оба тихие: ролик собирается, файл валиден,
// ошибок нет. Поэтому они проверяются кодом, а не внимательностью.

const whisperOf = (...words) => ({
  segments: [
    {
      words: words.map(([word, start, end]) => ({ word, start, end, probability: 0.9 })),
    },
  ],
});

const base = {
  slug: 'test',
  fps: 30,
  sourceMs: 10000,
  whisper: whisperOf([' раз', 0, 0.5], [' два', 3, 3.5], [' три', 7, 7.5]),
};

test('сцены идут встык — между ними не остаётся непокрытых кадров', () => {
  const t = buildStoryTimeline({
    ...base,
    scenes: [
      { kind: 'talkingHead', startMs: 0, endMs: 3333 },
      { kind: 'talkingHead', startMs: 3333, endMs: 6667 },
      { kind: 'talkingHead', startMs: 6667, endMs: 10000 },
    ],
  });

  for (let i = 1; i < t.scenes.length; i += 1) {
    const prevEnd = t.scenes[i - 1].startFrame + t.scenes[i - 1].durationFrames;
    assert.equal(t.scenes[i].startFrame, prevEnd, `щель перед сценой ${i}`);
  }
  assert.equal(t.totalFrames, 300);
});

test('слово попадает ровно в одну сцену — на стыке не дублируется', () => {
  const t = buildStoryTimeline({
    ...base,
    // Граница ровно на начале слова «два» (3000 мс)
    whisper: whisperOf([' два', 3.0, 3.5]),
    scenes: [
      { kind: 'talkingHead', startMs: 0, endMs: 3000 },
      { kind: 'talkingHead', startMs: 3000, endMs: 10000 },
    ],
  });

  assert.equal(t.scenes[0].captions.length, 0);
  assert.equal(t.scenes[1].captions.length, 1);
  assert.equal(t.scenes[1].captions[0].text, 'два');
});

test('метки слов остаются абсолютными — их не сдвигают под начало сцены', () => {
  const t = buildStoryTimeline({
    ...base,
    scenes: [
      { kind: 'talkingHead', startMs: 0, endMs: 5000 },
      { kind: 'talkingHead', startMs: 5000, endMs: 10000 },
    ],
  });

  // «три» звучит на 7000 мс от начала ролика и должно остаться на 7000,
  // а не превратиться в 2000 от начала своей сцены: субтитры сверяются с
  // абсолютным временем композиции.
  assert.equal(t.scenes[1].captions[0].startMs, 7000);
});

test('раскадровка длиннее видео — отказ, а не застывший кадр под тишину', () => {
  assert.throws(
    () =>
      buildStoryTimeline({
        ...base,
        sourceMs: 5000,
        scenes: [{ kind: 'talkingHead', startMs: 0, endMs: 9000 }],
      }),
    /покрывать нечем/,
  );
});

test('транскрипт без слов — отказ: субтитров не будет, а ролик выглядел бы готовым', () => {
  assert.throws(
    () =>
      buildStoryTimeline({
        ...base,
        whisper: { segments: [] },
        scenes: [{ kind: 'talkingHead', startMs: 0, endMs: 5000 }],
      }),
    /нет ни одного слова/,
  );
});

test('звук берётся из видеослоя — отдельных аудиофайлов у сцен нет', () => {
  const t = buildStoryTimeline({
    ...base,
    scenes: [{ kind: 'talkingHead', startMs: 0, endMs: 10000 }],
  });
  assert.equal(t.scenes[0].audioFile, null);
  assert.equal(t.voiceId, 'recorded');
});

// ── Схема ────────────────────────────────────────────────────────────────────

const validStory = {
  template: 'story@1',
  story: {
    source: 'assets/source.mp4',
    scenes: [
      { kind: 'talkingHead', startMs: 0, endMs: 4000, kicker: 'Тезис' },
      { kind: 'house', startMs: 4000, endMs: 8000, title: 'Дом', note: 'Стройка' },
    ],
  },
};

test('story@1 валиден без voiceId и без scenes — речь снята, а не синтезирована', () => {
  const v = parseVideoJson(validStory, { file: 'test' });
  assert.equal(v.voiceId, '');
  assert.deepEqual(v.scenes, []);
  assert.equal(v.story.scenes.length, 2);
});

test('дыра между сценами раскадровки не проходит валидацию', () => {
  assert.throws(
    () =>
      parseVideoJson(
        {
          ...validStory,
          story: {
            ...validStory.story,
            scenes: [
              { kind: 'talkingHead', startMs: 0, endMs: 4000 },
              { kind: 'talkingHead', startMs: 5000, endMs: 8000 },
            ],
          },
        },
        { file: 'test' },
      ),
    /идут встык/,
  );
});

test('три строки тезиса не проходят — панель села бы говорящему на рот', () => {
  // Габарит панели посчитан по кадрам mvp-palatka: подбородок держится выше
  // y≈1150, панель стоит на 520 px от низа, значит её потолок 200 px — две
  // строки кегля 56. Правило живёт в схеме, а не в голове, потому что нарушение
  // видно только на готовом файле, когда переделывать уже дорого.
  assert.throws(
    () =>
      parseVideoJson(
        {
          ...validStory,
          story: {
            ...validStory.story,
            scenes: [{ kind: 'statement', startMs: 0, endMs: 4000, lines: ['раз', 'два', 'три'] }],
          },
        },
        { file: 'test' },
      ),
    /садится говорящему на рот/,
  );
});

test('story@1 без секции story — ошибка', () => {
  assert.throws(() => parseVideoJson({ template: 'story@1' }, { file: 'test' }), /без секции "story"/);
});

test('остальные шаблоны по-прежнему требуют voiceId и scenes', () => {
  assert.throws(
    () => parseVideoJson({ template: 'kinetic@1', scenes: [{ say: 'привет' }] }, { file: 'test' }),
    /voiceId обязателен/,
  );
  assert.throws(() => parseVideoJson({ template: 'kinetic@1', voiceId: 'x' }, { file: 'test' }), /хотя бы одна сцена/);
});

test('ролик без раскадровки получает story: null', () => {
  const v = parseVideoJson({ template: 'kinetic@1', voiceId: 'x', scenes: [{ say: 'привет' }] }, { file: 'test' });
  assert.equal(v.story, null);
});
