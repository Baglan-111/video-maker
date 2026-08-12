import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../scripts/lib/timeline.mjs';

const cap = (text, s, e) => ({ text, startMs: s, endMs: e, timestampMs: s, confidence: null });

// ВНИМАНИЕ: контракт изменён 06.08.2026 (дефекты I1/I2). Ожидания ниже переписаны
// намеренно, а не подогнаны под код:
//   durationFrames теперь покрывает речь ВМЕСТЕ с паузой gapMs (раньше пауза
//   двигала курсор, но не входила в длительность — кадры на стыке оставались
//   без <Sequence>, зритель видел моргание пустого фона) и учитывает
//   фактическую длительность аудио audioMs (раньше хвост фразы после
//   последнего слова обрезался границей Sequence).

test('первая сцена начинается с нуля, длительность = речь + пауза', () => {
  const t = buildTimeline({ fps: 30, scenes: [
    { index: 0, display: 'привет', audioFile: 'scene-00.wav', gapMs: 180, captions: [cap('привет', 0, 1000)] },
  ]});
  assert.equal(t.scenes[0].startFrame, 0);
  assert.equal(t.scenes[0].durationFrames, 35);   // 1000 мс речи + 180 мс паузы = 1180 мс → 35 кадров
  assert.equal(t.totalFrames, 35);                // сцена покрывает ролик целиком, кадров без Sequence нет
});

test('вторая сцена начинается ровно там, где кончилась первая', () => {
  const t = buildTimeline({ fps: 30, scenes: [
    { index: 0, display: 'а', audioFile: 'scene-00.wav', gapMs: 200, captions: [cap('а', 0, 1000)] },
    { index: 1, display: 'б', audioFile: 'scene-01.wav', gapMs: 200, captions: [cap('б', 0, 500)] },
  ]});
  assert.equal(t.scenes[1].startFrame, 36);       // 1200 мс → 36 кадров
  assert.equal(t.scenes[0].durationFrames, 36);   // первая сцена доводит кадр до начала второй
  assert.equal(t.scenes[1].captions[0].startMs, 1200);
  assert.equal(t.scenes[1].captions[0].endMs, 1700);
  assert.equal(t.scenes[1].captions[0].timestampMs, 1200);
});

test('между сценами нет непокрытых кадров (регрессия I1)', () => {
  const scenes = Array.from({ length: 12 }, (_, i) => ({
    index: i, display: `с${i}`, audioFile: `scene-${i}.wav`, gapMs: 180,
    captions: [cap('раз', 0, 700 + i * 37)],   // разная длительность — ловим ошибки округления
  }));
  const t = buildTimeline({ fps: 30, scenes });
  for (let i = 1; i < t.scenes.length; i++) {
    assert.equal(
      t.scenes[i].startFrame,
      t.scenes[i - 1].startFrame + t.scenes[i - 1].durationFrames,
      `щель перед сценой ${i}`,
    );
  }
  const last = t.scenes[t.scenes.length - 1];
  assert.equal(t.totalFrames, last.startFrame + last.durationFrames);
});

test('фактическая длительность аудио длиннее меток — хвост не режется (регрессия I2)', () => {
  const t = buildTimeline({ fps: 30, scenes: [
    { index: 0, display: 'а', audioFile: 'scene-00.wav', gapMs: 0, audioMs: 2136,
      captions: [cap('а', 0, 1892)] },
  ]});
  assert.equal(t.scenes[0].durationFrames, 64);   // считаем по 2136 мс, а не по 1892 мс
});

test('сцена без реплики держит длительность из fallbackMs', () => {
  const t = buildTimeline({ fps: 30, scenes: [
    { index: 0, display: 'тишина', audioFile: null, gapMs: 0, captions: [], fallbackMs: 2000 },
  ]});
  assert.equal(t.scenes[0].durationFrames, 60);
});

test('сцена без речи и без fallbackMs — ошибка, а не ноль кадров (регрессия I8)', () => {
  assert.throws(
    () => buildTimeline({ fps: 30, scenes: [
      { index: 0, display: 'пусто', audioFile: null, gapMs: 180, captions: [] },
    ]}),
    /нулевая длительность/,
  );
});

test('timestampMs null остаётся null после сдвига', () => {
  const t = buildTimeline({ fps: 30, scenes: [
    { index: 0, display: 'а', audioFile: 'scene-00.wav', gapMs: 0, captions: [cap('а', 0, 1000)] },
    { index: 1, display: 'б', audioFile: 'scene-01.wav', gapMs: 0,
      captions: [{ text: 'б', startMs: 0, endMs: 500, timestampMs: null, confidence: null }] },
  ]});
  assert.equal(t.scenes[1].captions[0].timestampMs, null);
  assert.equal(t.scenes[1].captions[0].startMs, 1000);
});

test('пустой список сцен даёт ноль кадров', () => {
  assert.equal(buildTimeline({ fps: 30, scenes: [] }).totalFrames, 0);
});
