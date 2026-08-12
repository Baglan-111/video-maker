export type SpeechInterval = { startMs: number; endMs: number };
export type DuckingOptions = { duck?: number; rampFrames?: number };

export declare const MIN_GAP_MS: number;
export declare const RAMP_FRAMES: number;
export declare const DUCK: number;

export declare function buildSpeechIntervals(
  captions: { startMs: number; endMs: number }[],
  minGapMs?: number
): SpeechInterval[];

export declare function volumeAtFrame(
  intervals: SpeechInterval[],
  frame: number,
  fps: number,
  base: number,
  opts?: DuckingOptions
): number;
