import { interpolate } from 'remotion';

// Настройки по умолчанию для приглушения музыки под речью.
export const MIN_GAP_MS = 400;   // разрыв между словами короче этого — не пауза, а часть фразы
export const RAMP_FRAMES = 8;    // сколько кадров длится плавный переход громкости
export const DUCK = 0.28;        // во сколько раз тише музыка под речью

/**
 * Склеивает метки слов в интервалы речи. Соседние слова с разрывом меньше
 * minGapMs считаются одной фразой (без всплытия музыки внутри); разрыв
 * от minGapMs и больше — настоящая пауза, отдельный интервал.
 * @param {{startMs: number, endMs: number}[]} captions
 * @param {number} minGapMs
 * @returns {{startMs: number, endMs: number}[]}
 */
export function buildSpeechIntervals(captions, minGapMs = MIN_GAP_MS) {
  if (!captions.length) return [];
  const sorted = [...captions].sort((a, b) => a.startMs - b.startMs);
  const intervals = [{ startMs: sorted[0].startMs, endMs: sorted[0].endMs }];

  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i];
    const last = intervals[intervals.length - 1];
    if (c.startMs - last.endMs < minGapMs) {
      last.endMs = Math.max(last.endMs, c.endMs);
    } else {
      intervals.push({ startMs: c.startMs, endMs: c.endMs });
    }
  }

  return intervals;
}

/**
 * Громкость музыки в конкретном кадре: base вне речи, base*duck внутри речи,
 * с плавной рампой длиной rampFrames на входе и выходе из интервала речи —
 * без мгновенных переключений между двумя значениями.
 * @param {{startMs: number, endMs: number}[]} intervals
 * @param {number} frame
 * @param {number} fps
 * @param {number} base
 * @param {{duck?: number, rampFrames?: number}} [opts]
 * @returns {number}
 */
export function volumeAtFrame(intervals, frame, fps, base, opts = {}) {
  const duck = opts.duck ?? DUCK;
  const rampFrames = opts.rampFrames ?? RAMP_FRAMES;
  const duckedVolume = base * duck;
  const ms = (frame / fps) * 1000;
  const rampMs = (rampFrames / fps) * 1000;

  let volume = base; // по умолчанию — полная громкость (вне всех интервалов речи)

  for (const iv of intervals) {
    let v;
    if (ms < iv.startMs - rampMs || ms > iv.endMs + rampMs) {
      continue; // далеко от этого интервала — не влияет
    }
    if (ms < iv.startMs) {
      v = interpolate(ms, [iv.startMs - rampMs, iv.startMs], [base, duckedVolume], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      });
    } else if (ms > iv.endMs) {
      v = interpolate(ms, [iv.endMs, iv.endMs + rampMs], [duckedVolume, base], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      });
    } else {
      v = duckedVolume;
    }
    // если рампы соседних интервалов пересекаются — берём более тихое значение,
    // чтобы никогда не показать полную громкость внутри/у края речи
    volume = Math.min(volume, v);
  }

  return volume;
}
