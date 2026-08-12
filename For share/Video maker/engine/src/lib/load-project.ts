import { staticFile } from 'remotion';
import { parseVideoJson } from './video-schema.mjs';
import type { VideoConfig } from './video-schema.d.mts';
import type { Timeline } from '../schema';

// Чтение привязанного ролика из бандла. Раньше эти две функции жили внутри
// templates/kinetic/v1/Kinetic.tsx, и второму шаблону пришлось бы импортировать
// их из чужого шаблона — связь, которой быть не должно: шаблоны не знают друг о
// друге. Kinetic их реэкспортирует, поэтому прежние импорты продолжают работать.
//
// public/project — копия текущего ролика, её кладёт scripts/lib/public-dir.mjs.

export const loadTimeline = async (slug: string): Promise<Timeline> => {
  const res = await fetch(staticFile('project/audio/timeline.json'));
  if (!res.ok) throw new Error(`Нет timeline.json для ${slug} — сначала node scripts/tts.mjs ${slug}`);
  return res.json();
};

export const loadVideoConfig = async (slug: string): Promise<VideoConfig> => {
  const res = await fetch(staticFile('project/video.json'));
  if (!res.ok) throw new Error(`Нет video.json для ${slug}`);
  return parseVideoJson(await res.json(), { file: `projects/${slug}/video.json` });
};
