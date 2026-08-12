import { AbsoluteFill, Sequence, staticFile, useVideoConfig } from 'remotion';
import { Audio } from '@remotion/media';
import { Subtitles } from '../../../components/Subtitles';
import { Music } from '../../../components/Music';
import { tokens } from '../../../brand/tokens';
import { fontFamily } from '../../../brand/fonts';
import { buildPagesForScenes } from '../../../lib/pages.mjs';
import { loadTimeline, loadVideoConfig } from '../../../lib/load-project';
import type { KineticProps, Timeline } from '../../../schema';

// Таймлайн приходит пропсом из calculateMetadata — грузить его в компоненте нельзя,
// длительность композиции должна быть известна до первого кадра. До первого прогона
// calculateMetadata (например, дефолтные пропсы в Studio до его резолва) timeline
// может быть null — это допустимое, но не рабочее состояние: компонент обязан упасть
// с понятной ошибкой, а не молча показать пустой экран.
export type KineticFullProps = KineticProps & { timeline: Timeline | null };

// Загрузчики переехали в src/lib/load-project.ts — их читает и второй шаблон
// (promo@1), а шаблоны не должны импортировать друг из друга. Реэкспорт оставлен,
// чтобы прежние импорты из Kinetic не сломались.
export { loadTimeline, loadVideoConfig };

export const Kinetic: React.FC<KineticFullProps> = ({ slug, bg, accent, timeline, music, musicVolume }) => {
  if (!timeline) {
    throw new Error(`Нет timeline.json для ${slug} — сначала node scripts/tts.mjs ${slug}`);
  }

  const { fps } = useVideoConfig();
  const allCaptions = timeline.scenes.flatMap((s) => s.captions);
  // Страницы строятся отдельно по каждой сцене (buildPagesForScenes), а не по
  // общему списку captions — иначе окно комбинирования склеивает последние
  // слова одной сцены с первыми словами следующей в одну страницу субтитров
  // (регрессия, найдена на 1.2 с test-ok.mp4, финальное ревью 06.08.2026).
  const pages = buildPagesForScenes(timeline.scenes);

  return (
    <AbsoluteFill style={{ backgroundColor: bg, fontFamily }}>
      {timeline.scenes.map((s) => (
        <Sequence key={s.index} from={s.startFrame} durationInFrames={s.durationFrames}>
          {s.audioFile ? <Audio src={staticFile(`project/${s.audioFile}`)} /> : null}
          <AbsoluteFill style={{
            justifyContent: 'center', alignItems: 'center', padding: tokens.space[5],
            color: tokens.fg, fontSize: tokens.size.title, fontWeight: 700, textAlign: 'center',
          }}>
            {s.display}
          </AbsoluteFill>
        </Sequence>
      ))}
      {music ? (
        <Music src={`music/${music}`} captions={allCaptions} fps={fps} base={musicVolume} />
      ) : null}
      {/* Субтитры сами выбирают текущую страницу слов — весь транскрипт разом
          на экран больше не выводится (дефект C2). Страницы строятся отдельно
          по сценам (buildPagesForScenes), поэтому слова разных сцен в одну
          страницу не попадают. */}
      <Subtitles pages={pages} accent={accent} />
    </AbsoluteFill>
  );
};
