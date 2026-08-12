import { useCurrentFrame, useVideoConfig } from 'remotion';
import { tokens } from '../brand/tokens';
import { fontFamily } from '../brand/fonts';
import type { SubtitlePage } from '../lib/pages.d.mts';
import { pageAt } from '../lib/pages.mjs';

// На экране одна страница субтитров (до 4 слов), а не весь транскрипт ролика.
// Разбивка и обоснование — src/lib/pages.mjs.
//
// Страницы приходят готовыми (собраны в Kinetic через buildPagesForScenes —
// отдельно по сценам, чтобы combine-окно не склеивало слова через границу
// сцены), Subtitles их только показывает по текущему времени.
export const Subtitles: React.FC<{ pages: SubtitlePage[]; accent: string }> = ({ pages, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const page = pageAt(pages, ms);

  if (!page) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: tokens.safeBottom,
        left: tokens.space[5],
        right: tokens.space[5],
        display: 'flex',
        flexWrap: 'wrap',
        gap: tokens.space[2],
        justifyContent: 'center',
        fontFamily,
        fontSize: tokens.size.caption,
        fontWeight: 700,
        color: tokens.fg,
        lineHeight: 1.15,
      }}
    >
      {page.words.map((w, i) => {
        const active = ms >= w.startMs && ms <= w.endMs;
        return (
          <span key={i} style={{ color: active ? accent : tokens.fg, opacity: active ? 1 : 0.65 }}>
            {w.text}
          </span>
        );
      })}
    </div>
  );
};
