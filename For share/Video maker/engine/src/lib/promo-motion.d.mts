export type MotionScene = {
  index: number;
  display: string;
  startFrame: number;
  durationFrames: number;
  captions: { text: string; startMs: number; endMs: number }[];
};

export type ActiveScene<S> = {
  index: number;
  localFrame: number;
  durationFrames: number;
  scene: S;
};

export type Point = { x: number; y: number };

export type EnterExitOptions = { enterFrames: number; exitFrames: number };
export type CursorOptions = { travelFrames: number; dwellFrames: number };

export declare function sceneAt<S extends { index: number; startFrame: number; durationFrames: number }>(
  scenes: S[],
  frame: number,
): ActiveScene<S> | null;

export declare function enterExit(
  localFrame: number,
  durationFrames: number,
  opts: EnterExitOptions,
): { enter: number; exit: number };

export declare function panelPhase(
  sceneStart: number,
  sceneDuration: number,
  frame: number,
  opts: EnterExitOptions,
): { enter: number; exit: number; localFrame: number; sceneFrame: number } | null;

export declare function surfaceOpacity(
  enter: number,
  exit: number,
  opts?: { solid?: boolean; solidAt?: number },
): number;

export declare function cursorTotalFrames(pointCount: number, opts: CursorOptions): number;

export declare function cursorSegment(
  points: Point[],
  localFrame: number,
  opts: CursorOptions,
): { from: Point; to: Point; t: number } | null;

export declare function sceneSpeech(scene: { captions?: { text: string }[] } | null | undefined): string;

export declare function splitTitle(display: string): { lead: string; accent: string };
