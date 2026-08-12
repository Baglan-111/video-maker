import { Composition } from 'remotion';
import { Kinetic } from './templates/kinetic/v1/Kinetic';
import { Promo } from './templates/promo/v1/Promo';
import { Story } from './templates/story/v1/Story';
import { loadTimeline, loadVideoConfig } from './lib/load-project';
import { kineticSchema, promoSchema, storySchema } from './schema';
import { RENDER_DEFAULTS } from './lib/video-schema.mjs';

// Цвета, музыка и её громкость живут в video.json конкретного ролика (дефект I4).
// defaultProps остаются значениями по умолчанию — на случай, если в video.json
// поля нет.
//
// Тонкость про Studio: calculateMetadata подставляет значение из video.json
// только туда, где проп равен дефолту, то есть где пользователь ничего не
// трогал. Иначе правка цвета мышкой в Studio затиралась бы при каждом
// пересчёте метаданных, а дизайн (раздел 4.4) обещает ручную правку.
function fromVideoJson<T>(propValue: T, videoValue: T, defaultValue: T): T {
  return propValue === defaultValue ? videoValue : propValue;
}

// Композиций две, и они не пересекаются: Kinetic — вертикальный 1080×1920,
// Promo — горизонтальный 1920×1080. Общий у них только источник данных
// (public/project) и звуковой конвейер. Какую рендерить, решает поле template
// в video.json — см. COMPOSITION_BY_TEMPLATE и scripts/render.mjs.
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Kinetic"
      component={Kinetic}
      schema={kineticSchema}
      defaultProps={{
        slug: 'test-ok',
        bg: RENDER_DEFAULTS.bg,
        accent: RENDER_DEFAULTS.accent,
        timeline: null,
        music: RENDER_DEFAULTS.music,
        musicVolume: RENDER_DEFAULTS.musicVolume,
      }}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      calculateMetadata={async ({ props }) => {
        const [timeline, video] = await Promise.all([
          loadTimeline(props.slug),
          loadVideoConfig(props.slug),
        ]);
        return {
          durationInFrames: Math.max(1, timeline.totalFrames),
          props: {
            ...props,
            // slug приводим к реально привязанному ролику: источник правды —
            // public/project, а не значение в форме Studio.
            slug: timeline.slug ?? props.slug,
            bg: fromVideoJson(props.bg, video.bg, RENDER_DEFAULTS.bg),
            accent: fromVideoJson(props.accent, video.accent, RENDER_DEFAULTS.accent),
            music: fromVideoJson(props.music, video.music, RENDER_DEFAULTS.music),
            musicVolume: fromVideoJson(props.musicVolume, video.musicVolume, RENDER_DEFAULTS.musicVolume),
            timeline,
          },
        };
      }}
    />
    <Composition
      id="Promo"
      component={Promo}
      schema={promoSchema}
      defaultProps={{
        slug: 'promo-kartoteka',
        bg: '#C9D8F0',
        accent: RENDER_DEFAULTS.accent,
        timeline: null,
        panels: [],
        music: RENDER_DEFAULTS.music,
        musicVolume: RENDER_DEFAULTS.musicVolume,
      }}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={300}
      calculateMetadata={async ({ props }) => {
        const [timeline, video] = await Promise.all([
          loadTimeline(props.slug),
          loadVideoConfig(props.slug),
        ]);
        return {
          durationInFrames: Math.max(1, timeline.totalFrames),
          props: {
            ...props,
            slug: timeline.slug ?? props.slug,
            // bg у promo@1 — нижний тон градиента, дефолта в RENDER_DEFAULTS для
            // него нет (тот дефолт тёмный, из вертикального шаблона), поэтому
            // значение из video.json берётся напрямую.
            bg: video.bg,
            accent: fromVideoJson(props.accent, video.accent, RENDER_DEFAULTS.accent),
            music: fromVideoJson(props.music, video.music, RENDER_DEFAULTS.music),
            musicVolume: fromVideoJson(props.musicVolume, video.musicVolume, RENDER_DEFAULTS.musicVolume),
            // Панели — данные ролика, а не настройка рендера, поэтому в
            // --props их не передают: они читаются из того же video.json.
            panels: video.promo?.panels ?? [],
            timeline,
          },
        };
      }}
    />
    {/* story@1 — вертикальный, как Kinetic, но кадр приходит из снятого видео,
        а не рисуется. Длительность задаёт таймлайн, собранный из раскадровки
        (scripts/prepare-source.mjs), а не синтез речи. */}
    <Composition
      id="Story"
      component={Story}
      schema={storySchema}
      defaultProps={{
        slug: 'mvp-palatka',
        bg: RENDER_DEFAULTS.bg,
        timeline: null,
        story: null,
      }}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      calculateMetadata={async ({ props }) => {
        const [timeline, video] = await Promise.all([
          loadTimeline(props.slug),
          loadVideoConfig(props.slug),
        ]);
        return {
          durationInFrames: Math.max(1, timeline.totalFrames),
          props: {
            ...props,
            slug: timeline.slug ?? props.slug,
            bg: fromVideoJson(props.bg, video.bg, RENDER_DEFAULTS.bg),
            // Раскадровка — данные ролика, а не настройка рендера: в форме
            // Studio ей делать нечего, правится она в video.json.
            story: video.story,
            timeline,
          },
        };
      }}
    />
  </>
);
