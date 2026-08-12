import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import { Video } from '@remotion/media';
import { StorySubtitles } from '../../../components/story/StorySubtitles';
import { fontFamily } from '../../../brand/fonts';
import { buildWordPages } from '../../../lib/story-pages.mjs';
import type { StoryProps, Timeline } from '../../../schema';
import type { Story as StoryConfig } from '../../../lib/video-schema.d.mts';
import { StorySceneView, FULLSCREEN_KINDS } from './scenes';

// story@1 — сторителлинг поверх снятого видео.
//
// Устройство слоёв (снизу вверх):
//   1. Видео — идёт непрерывно от первого кадра до последнего и НИКОГДА не
//      обрывается. Отсюда весь звук ролика.
//   2. Сцены — оверлеи и фулскрин-врезки по отрезкам времени.
//   3. Субтитры — поверх всего, включая врезки: речь под ними не прекращается.
//
// Почему видео не режется на куски по сценам: голос снят одним дублем. Любая
// склейка видеослоя — это склейка звука, то есть щелчок на каждом стыке и
// рассинхрон субтитров с речью. Фулскрин-сцены поэтому именно ЗАКРЫВАЮТ кадр
// непрозрачной графикой, а не заменяют его.

export type StoryFullProps = StoryProps & {
  timeline: Timeline | null;
  story: StoryConfig | null;
};

export const Story: React.FC<StoryFullProps> = ({ slug, bg, timeline, story }) => {
  if (!timeline) {
    throw new Error(`Нет timeline.json для ${slug} — сначала node scripts/prepare-source.mjs ${slug}`);
  }
  if (!story) {
    throw new Error(`В video.json ролика ${slug} нет секции story — шаблону story@1 нечего рисовать`);
  }

  // Одно слово на экране — по разбору референсов 11.08.2026.
  //
  // Страницы строятся по СПЛОШНОМУ потоку слов, а не отдельно по сценам: речь
  // снята одним дублем и идёт сквозь монтажные границы. Разбивка по сценам
  // давала бы хвост страницы одной сцены поверх начала следующей — замерено, до
  // 400 мс отставания на 7 стыках из 7.
  const pages = buildWordPages(timeline.scenes.flatMap((s) => s.captions));

  return (
    <AbsoluteFill style={{ backgroundColor: bg, fontFamily }}>
      <Video
        src={staticFile(`project/${story.source}`)}
        // Кадр совпадает с канвой (прокси готовится ровно 1080×1920), cover
        // страхует от исходника другой пропорции — лучше обрезать края, чем
        // растянуть лицо.
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />

      {timeline.scenes.map((s, i) => {
        const scene = story.scenes[i];
        if (!scene) {
          throw new Error(
            `Сцена ${i} есть в timeline.json, но её нет в video.json → story.scenes. ` +
              `Пересобери таймлайн: node scripts/prepare-source.mjs ${slug}`,
          );
        }
        // Соседи считаются здесь, а не внутри сцены: сцена себя в ролике не
        // видит, а от того, фулскрин ли соседи, зависит, анимировать ли стык.
        const ctx = {
          durationInFrames: s.durationFrames,
          prevIsFullscreen: FULLSCREEN_KINDS.has(story.scenes[i - 1]?.kind),
          nextIsFullscreen: FULLSCREEN_KINDS.has(story.scenes[i + 1]?.kind),
        };
        return (
          <Sequence key={s.index} from={s.startFrame} durationInFrames={s.durationFrames}>
            <StorySceneView scene={scene} ctx={ctx} />
          </Sequence>
        );
      })}

      {/* Вне сцен: субтитры живут в абсолютном времени ролика и не должны
          перезапускать свой отсчёт на каждой сцене. */}
      {/* Субтитры молчат на акцентах: там фраза уже написана во весь экран. */}
      <StorySubtitles
        pages={pages}
        mutedRanges={story.scenes
          .filter((s) => s.kind === 'accent')
          .map((s) => ({ fromMs: s.startMs, toMs: s.endMs }))}
      />
    </AbsoluteFill>
  );
};
