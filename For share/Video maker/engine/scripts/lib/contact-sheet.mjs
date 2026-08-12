import { execFileSync } from 'node:child_process';

// Контактный лист — полоска кадров с нанесённой разметкой кадра.
//
// Существует ради одной ошибки, совершённой трижды за одну сборку 11.08.2026:
// раскладка проектировалась по ОДНОМУ кадру. На статичной картинке верхняя
// полоса выглядела свободной, и тезисы встали туда. В движении говорящий
// наклоняется к камере, и панель садится ему на лоб — но увидеть это можно
// только на нескольких кадрах сразу, а не на первом.
//
// Лист не «красивая иллюстрация», а инструмент замера: линии показывают, где
// проходят границы, и позволяют прочитать, заходит ли лицо за них НА ВСЁМ
// ролике. Скрипт печатает его до вёрстки, а не после.

/** Полосы и линии, которыми размечается кадр 1080×1920. */
const GUIDES = [
  // Безопасные зоны Instagram: сюда ляжет интерфейс приложения.
  { kind: 'box', y: 0, h: 220, color: 'red@0.3', label: 'красная полоса сверху — безопасная зона Instagram (0–220)' },
  { kind: 'box', y: 1600, h: 320, color: 'red@0.3', label: 'красная полоса снизу — безопасная зона Instagram (1600–1920)' },
  // Потолок панели тезиса: всё, что говорящий держит НИЖЕ этой линии, панель
  // перекроет. Значение — из storyComponents.panel (520 от низа + 200 высоты).
  { kind: 'line', y: 1200, h: 5, color: 'yellow@0.9', label: 'жёлтая линия (1200) — потолок панели: подбородок обязан быть ВЫШЕ неё' },
  // Верх зоны субтитров.
  { kind: 'line', y: 1424, h: 5, color: 'cyan@0.9', label: 'голубая линия (1424) — верх зоны субтитров' },
];

/**
 * Собирает горизонтальную полоску кадров с разметкой.
 *
 * @param {object} p
 * @param {string} p.src   путь к видео
 * @param {number[]} p.atSeconds моменты, с которых брать кадры
 * @param {string} p.out   куда положить jpg
 * @param {number} p.tileWidth ширина одного кадра в листе
 */
export function buildContactSheet({ src, atSeconds, out, tileWidth = 240 }) {
  // box и line рисуются одним фильтром — разница только в высоте, поэтому kind
  // остаётся описанием для человека, а не ветвлением в коде.
  const draws = GUIDES.map(
    (g) => `drawbox=x=0:y=${g.y}:w=1080:h=${g.h}:color=${g.color}:t=fill`,
  ).join(',');

  // Кадры берутся по одному через -ss: выборка по времени точнее и дешевле,
  // чем фильтр select по номеру кадра на длинном файле.
  const inputs = [];
  const filters = [];
  atSeconds.forEach((t, i) => {
    inputs.push('-ss', String(t), '-i', src);
    filters.push(`[${i}:v]${draws},scale=${tileWidth}:-1,setsar=1[v${i}]`);
  });

  const chain =
    `${filters.join(';')};${atSeconds.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${atSeconds.length}[out]`;

  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...inputs,
      '-filter_complex', chain, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out],
    { stdio: 'inherit' },
  );

  return GUIDES.map((g) => g.label);
}

/** Равномерные моменты внутри ролика, без самого первого и последнего кадра. */
export function evenMoments(durationSec, count = 6) {
  const step = durationSec / (count + 1);
  return Array.from({ length: count }, (_, i) => +(step * (i + 1)).toFixed(2));
}
