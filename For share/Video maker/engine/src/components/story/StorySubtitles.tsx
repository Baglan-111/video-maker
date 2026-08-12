import { useCurrentFrame, useVideoConfig } from 'remotion';
import { storyTokens, storyComponents } from '../../brand/story-tokens';
import { fontFamily } from '../../brand/fonts';
import type { SubtitlePage } from '../../lib/pages.d.mts';
import { pageAt } from '../../lib/pages.mjs';
import { stripPunctuation } from '../../lib/story-pages.mjs';

// Субтитры story@1: одно слово у лица, без плашки.
//
// Прежняя версия ставила 3–5 слов на тёмной плашке в нижней трети. Разбор
// референсов 11.08.2026 (роликов, которые нравятся автору) показал ровно
// обратное устройство: одно слово, кегль ~90 при ширине 1080, без подложки,
// на 40–62 % высоты — рядом с говорящим. Одно слово опознаётся, а не читается,
// и взгляд не уходит вниз.
//
// Читаемость держит плотный ореол вместо плашки. Это не косметика: белым по
// светлой стене офиса контраст 1.58:1 при норме 4.5:1, и без тени субтитр
// пропадал бы на любом светлом кадре. Ореол, в отличие от плашки, не
// прямоугольник — он не перекрывает лицо и не читается как объект.

export const StorySubtitles: React.FC<{
  pages: SubtitlePage[];
  /** Отрезки, где субтитр не показывается: там текст уже есть на экране. */
  mutedRanges?: { fromMs: number; toMs: number }[];
}> = ({ pages, mutedRanges = [] }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  // На сценах-акцентах субтитр молчит: там во весь экран стоит фраза, и
  // подпись под ней повторяет то же слово. Два текста об одном — шум, а не
  // дублирование для беззвучного просмотра.
  if (mutedRanges.some((r) => ms >= r.fromMs && ms < r.toMs)) return null;

  const page = pageAt(pages, ms);
  if (!page) return null;

  return (
    <div
      style={{
        position: 'absolute',
        // Якорь задан долей высоты, а не пикселями от низа: позиция привязана к
        // тому, где в кадре находится говорящий, а не к краю экрана.
        top: height * storyComponents.subtitleWord.verticalAnchor,
        left: storyTokens.safeSide,
        right: storyTokens.safeSide,
        display: 'flex',
        justifyContent: 'center',
        // Слово центрируется по якорю, а не свисает вниз от него.
        transform: 'translateY(-50%)',
        fontFamily,
        fontSize: storyComponents.subtitleWord.fontSize,
        fontWeight: storyTokens.weight.bold,
        lineHeight: storyTokens.line.tight,
        color: storyTokens.color.textPrimary,
        textShadow: storyComponents.subtitleWord.shadow,
        textAlign: 'center',
        // Прописные во всех текстах ролика — решение автора 11.08.2026.
        // Заглавные шире строчных примерно на 10 %, поэтому длинное слово
        // («ПЕРЕНОЧЕВАТЬ», 12 знаков) идёт впритык к полям: 833 px при
        // доступных 856. Более длинных слов в русской речи почти не бывает,
        // но если появятся — резать надо кегль, а не поля.
        textTransform: 'uppercase',
      }}
    >
      {/* Слова страницы соединяются пробелом: в однословном режиме это всегда
          одно слово, но компонент не обязан ломаться, если ему отдадут фразу.
          Пунктуация снимается здесь, а не в данных: разбивке она нужна, чтобы
          ставить границы страниц по фразам. */}
      {page.words.map((w) => stripPunctuation(w.text)).join(' ')}
    </div>
  );
};
