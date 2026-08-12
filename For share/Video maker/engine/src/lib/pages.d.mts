export type PageWord = { text: string; startMs: number; endMs: number };
export type SubtitlePage = {
  startMs: number;
  endMs: number;
  untilMs: number;
  words: PageWord[];
};
export type BuildPagesOptions = {
  maxWords?: number;
  combineTokensWithinMilliseconds?: number;
  tailMs?: number;
};

export declare const MAX_WORDS_PER_PAGE: number;
export declare const COMBINE_MS: number;
export declare const TAIL_MS: number;

export declare function buildPages(
  captions: { text: string; startMs: number; endMs: number }[],
  opts?: BuildPagesOptions,
): SubtitlePage[];

export declare function buildPagesForScenes(
  scenes: { captions: { text: string; startMs: number; endMs: number }[] }[],
  opts?: BuildPagesOptions,
): SubtitlePage[];

export declare function pageAt(pages: SubtitlePage[], ms: number): SubtitlePage | null;
