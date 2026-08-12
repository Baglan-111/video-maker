import type { SubtitlePage } from './pages.d.mts';

export type StoryPagesOptions = {
  maxWords?: number;
  maxChars?: number;
  pauseMs?: number;
  tailMs?: number;
};

export declare const MAX_WORDS: number;
export declare const MAX_CHARS: number;
export declare const PAUSE_MS: number;
export declare const TAIL_MS: number;

export declare function buildStoryPages(
  words: { text: string; startMs: number; endMs: number }[],
  opts?: StoryPagesOptions,
): SubtitlePage[];

export declare const MIN_CHARS: number;

/** Одно слово на страницу — режим субтитров story@1 с 11.08.2026. */
export declare function buildWordPages(
  words: { text: string; startMs: number; endMs: number }[],
  opts?: { tailMs?: number },
): SubtitlePage[];

/** Убирает знаки препинания из слова субтитра, сохраняя внутрисловный дефис. */
export declare function stripPunctuation(text: string): string;
