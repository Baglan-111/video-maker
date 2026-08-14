export type VideoScene = {
  say: string;
  display: string;
  gapMs: number;
  fallbackMs?: number;
};

export type DiagramNode = {
  id: string;
  label: string;
  /** Индекс сцены таймлайна, на которой шаг появляется и подсвечивается. */
  scene: number;
};

export type DiagramEdge = {
  from: string;
  to: string;
  label: string;
};

export type Diagram = {
  title: string;
  layout: 'vertical' | 'horizontal';
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

export type PromoTitlePanel = {
  kind: 'title';
  /** Индекс сцены таймлайна, на которой панель появляется. */
  scene: number;
};

export type PromoCardPanel = {
  kind: 'card';
  scene: number;
  title: string;
  rows: string[];
  counter: { value: string; label: string } | null;
};

export type PromoPanel = PromoTitlePanel | PromoCardPanel;

export type Promo = {
  panels: PromoPanel[];
};

/** Общее у всех сцен раскадровки: отрезок исходной дорожки, который сцена занимает. */
export type StoryRange = {
  startMs: number;
  endMs: number;
};

export type StoryTalkingHeadScene = StoryRange & { kind: 'talkingHead'; kicker?: string };
export type StoryMetaphorScene = StoryRange & { kind: 'house' | 'tent'; title: string; note: string };
export type StoryProofScene = StoryRange & { kind: 'checkCross' | 'scan'; title: string; note?: string };
export type StoryAccentScene = StoryRange & { kind: 'accent'; text: string };
export type StoryInsertScene = StoryRange & { kind: 'insert'; clip: string };
export type StoryLensScene = StoryRange & { kind: 'lens'; title: string; text: string; flaw: string };
export type StoryStatementScene = StoryRange & { kind: 'statement'; lines: string[]; glyphs?: boolean };
export type StoryQuestionsScene = StoryRange & { kind: 'questions'; wrong: string; right: string };
export type StoryCompareScene = StoryRange & { kind: 'compare'; badLabel: string; goodLabel: string };
export type StoryCtaScene = StoryRange & { kind: 'cta'; text: string };

export type StoryScene =
  | StoryTalkingHeadScene
  | StoryMetaphorScene
  | StoryProofScene
  | StoryInsertScene
  | StoryLensScene
  | StoryAccentScene
  | StoryStatementScene
  | StoryQuestionsScene
  | StoryCompareScene
  | StoryCtaScene;

export type Story = {
  /** Путь к подготовленному видео относительно папки ролика. */
  source: string;
  scenes: StoryScene[];
};

export type VideoConfig = {
  template: string;
  /** Пусто у story@1: речь снята, а не синтезирована. */
  voiceId: string;
  bg: string;
  accent: string;
  music: string | null;
  musicVolume: number;
  diagram: Diagram | null;
  promo: Promo | null;
  story: Story | null;
  /** Пусто у story@1 — раскадровка лежит в story.scenes. */
  scenes: VideoScene[];
};

export declare const TEMPLATES: string[];
export declare const COMPOSITION_BY_TEMPLATE: Record<string, string | null>;
export declare const DEFAULT_GAP_MS: number;
export declare const RENDER_DEFAULTS: {
  bg: string;
  accent: string;
  music: string | null;
  musicVolume: number;
};

export declare function parseVideoJson(raw: unknown, opts?: { file?: string }): VideoConfig;
