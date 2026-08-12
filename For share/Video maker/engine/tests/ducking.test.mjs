import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpeechIntervals, volumeAtFrame, DUCK, RAMP_FRAMES } from '../src/lib/ducking.mjs';

const cap = (s, e) => ({ startMs: s, endMs: e });
const fps = 30;
const base = 0.35;
const duckedVolume = base * DUCK;
const rampMs = (RAMP_FRAMES / fps) * 1000; // ~266.67мс при 30fps

test('два слова с разрывом 100мс дают ОДИН интервал (музыка не всплывает)', () => {
  const intervals = buildSpeechIntervals([cap(0, 300), cap(400, 700)]); // разрыв 100мс
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].startMs, 0);
  assert.equal(intervals[0].endMs, 700);
});

test('два слова с разрывом 800мс дают ДВА интервала, и между ними есть кадр с полной громкостью', () => {
  const intervals = buildSpeechIntervals([cap(0, 300), cap(1100, 1400)]); // разрыв 800мс
  assert.equal(intervals.length, 2);

  // Середина паузы, далеко от рампы обеих сторон (300+266.67=566.67, 1100-266.67=833.33)
  const midMs = (300 + 1100) / 2; // 700мс
  const midFrame = Math.round((midMs / 1000) * fps);
  const v = volumeAtFrame(intervals, midFrame, fps, base);
  assert.equal(v, base);
});

test('в середине речи громкость равна base*duck', () => {
  const intervals = buildSpeechIntervals([cap(0, 2000)]);
  const midFrame = Math.round((1000 / 1000) * fps); // ровно середина длинного слова, далеко от краёв
  const v = volumeAtFrame(intervals, midFrame, fps, base);
  assert.equal(v, duckedVolume);
});

test('на рампе громкость строго между приглушённой и полной (переход не мгновенный)', () => {
  const intervals = buildSpeechIntervals([cap(1000, 2000)]);
  // Кадр внутри окна рампы перед началом речи: startMs - rampMs/2
  const rampMidMs = 1000 - rampMs / 2;
  const rampFrame = Math.round((rampMidMs / 1000) * fps);
  const v = volumeAtFrame(intervals, rampFrame, fps, base);
  assert.ok(v > duckedVolume, `ожидали v > ${duckedVolume}, получили ${v}`);
  assert.ok(v < base, `ожидали v < ${base}, получили ${v}`);
});

test('до первого слова и после последнего громкость полная', () => {
  const intervals = buildSpeechIntervals([cap(2000, 2500)]);
  // Далеко до начала (>rampMs) — полная громкость
  const beforeFrame = 0; // 0мс, значительно раньше 2000-rampMs
  assert.equal(volumeAtFrame(intervals, beforeFrame, fps, base), base);

  // Далеко после конца (>rampMs после 2500мс)
  const afterMs = 2500 + rampMs + 1000;
  const afterFrame = Math.round((afterMs / 1000) * fps);
  assert.equal(volumeAtFrame(intervals, afterFrame, fps, base), base);
});

test('пустой список captions не приглушает музыку нигде', () => {
  const intervals = buildSpeechIntervals([]);
  assert.equal(intervals.length, 0);
  assert.equal(volumeAtFrame(intervals, 42, fps, base), base);
});
