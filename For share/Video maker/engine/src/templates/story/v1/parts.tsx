import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { storyTokens, storyComponents, storyMotion } from '../../../brand/story-tokens';
import { fontFamily } from '../../../brand/fonts';

// Общие узлы сцен story@1.
//
// Все анимации построены на useCurrentFrame() + interpolate(): CSS transition и
// animation в рендере не работают — Remotion рисует кадры по одному, а не
// проигрывает страницу во времени.
//
// Кадр внутри сцены локальный (сцены обёрнуты в <Sequence>), поэтому появление
// считается от нуля и одинаково во всех сценах.

const easeIn = Easing.bezier(...storyMotion.entrance);

/** Кадры на появление панели. Длительность из токенов, не из головы. */
export const useEnterFrames = () => {
  const { fps } = useVideoConfig();
  return Math.round((storyMotion.durationMs.panel / 1000) * fps);
};

/**
 * Появление: прозрачность плюс короткий подъём.
 *
 * Подъём на 24 px, а не на 100: движение должно сообщить «здесь появилось
 * новое», а не тащить взгляд через экран. Затухания в конце сцены нет
 * намеренно — сцены идут встык, и уход одной совпал бы с приходом следующей,
 * дав кадр, где на экране нет ничего.
 */
export const useEnter = (delayFrames = 0) => {
  const frame = useCurrentFrame();
  const enter = useEnterFrames();
  const range: [number, number] = [delayFrames, delayFrames + enter];
  return {
    opacity: interpolate(frame, range, [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: easeIn,
    }),
    translate: interpolate(frame, range, ['0px 24px', '0px 0px'], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: easeIn,
    }),
  };
};

/**
 * Отступ снизу для панелей тезисов.
 *
 * Раньше сюда закладывалась ещё и высота зоны субтитров: субтитр стоял под
 * панелью, и они читались одним блоком. После перехода на однословные субтитры
 * (11.08.2026) субтитр ушёл к лицу, на 65 % высоты, и нижняя полоса
 * освободилась целиком — панель садится прямо на безопасную зону.
 */
export const STACK_BOTTOM = storyTokens.safeBottom;

/**
 * Хук — заголовок ролика в верхней полосе.
 *
 * Стоит НАД головой, и это возможно не всегда, а по замеру: в первые 8 секунд
 * макушка не поднимается выше y≈380, безопасная зона кончается на 220 — значит
 * между ними 160 px, куда хук и садится (storyComponents.hook). На сценах, где
 * говорящий подаётся к камере, места сверху нет вовсе, поэтому хук и живёт
 * только в начале ролика.
 *
 * Внизу он стоял в промежуточной версии: там ничего не перекрывал, но и
 * заголовком быть перестал — читался как ещё одна подпись среди прочих.
 */
export const Kicker: React.FC<{ text: string }> = ({ text }) => {
  const { opacity, translate } = useEnter();

  return (
    <div
      style={{
        position: 'absolute',
        top: storyTokens.safeTop,
        left: storyTokens.safeSide,
        right: storyTokens.safeSide,
        display: 'flex',
        justifyContent: 'center',
        opacity,
        translate,
      }}
    >
      <div
        style={{
          paddingBlock: storyComponents.hook.padding,
          paddingInline: storyComponents.hook.padding,
          borderRadius: storyTokens.radius.card,
          backgroundColor: storyComponents.hook.background,
          fontFamily,
          fontSize: storyComponents.hook.fontSize,
          fontWeight: storyTokens.weight.bold,
          lineHeight: storyTokens.line.tight,
          color: storyTokens.color.textPrimary,
          textAlign: 'center',
          textTransform: 'uppercase',
        }}
      >
        {text}
      </div>
    </div>
  );
};

/**
 * Сплошная подложка фулскрин-сцены вместе со всем её содержимым.
 *
 * Переходы РЕЗКИЕ — решение автора 11.08.2026 после просмотра. Плавные
 * затемнения здесь не работают: пока врезка проявляется или тает, графика
 * полупрозрачно лежит поверх лица, и кадр читается как наложение, а не как
 * смена сцены. Плюс на выходе появлялся лишний кадр — врезка уже ушла, а
 * субтитр предыдущей фразы ещё висел.
 *
 * Резкая склейка убирает обе проблемы: врезка появляется и исчезает на границе
 * сцены, ровно там, где меняется мысль в речи. Так режут монтажёры, а плавные
 * переходы оставляют для смены времени или места.
 *
 * Метафоры рисуются линиями, а линия на пёстром кадре теряется — отсюда
 * непрозрачный фон.
 *
 * Появление и уход зависят от СОСЕДЕЙ, и это не украшательство. На сборке
 * 11.08.2026 каждая врезка гасила фон сама по себе, ничего не зная о соседних:
 *
 *   · Две врезки подряд (дом → палатка). Первая закрывалась вместе со своей
 *     <Sequence>, вторая начинала прозрачной и набирала фон 400 мс — в эту щель
 *     8 кадров было видно живое видео. Вспышка лица посреди графики читается
 *     как сбой воспроизведения. Замер: 12,47 с, скачок яркости +33,8.
 *
 *   · Последняя врезка обрывалась за ОДИН кадр: 25,6 → 63,5 на 18,90 с. Вход
 *     плавный, выход рубленый — асимметрия всегда читается как недоделка.
 *
 * Поэтому: если соседняя сцена тоже фулскрин, переход с ней не анимируется
 * вовсе (фон уже стоит, гасить и зажигать его нечего), а если нет — делается
 * симметричное появление и затухание. Затухает весь блок целиком, а не только
 * фон: иначе фигура последние 400 мс висела бы поверх лица.
 */
export const Scrim: React.FC<{
  children: React.ReactNode;
  /** Длительность сцены в кадрах — внутри <Sequence> её больше неоткуда взять. */
  durationInFrames: number;
  /** Предыдущая сцена тоже фулскрин: фон уже стоит. */
  continuesFromPrev?: boolean;
  /** Следующая сцена тоже фулскрин: она подхватит. */
  continuesToNext?: boolean;
}> = ({ children }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      backgroundColor: storyComponents.scrim.background,
    }}
  >
    {children}
  </div>
);

/**
 * Заголовок и пояснение фулскрин-сцены.
 *
 * Иерархия здесь тройная — размер (112 против 40), вес (800 против 400) и
 * позиция. Цветом не различаются намеренно: иерархия обязана читаться в ч/б.
 */
export const SceneCaption: React.FC<{ title: string; note: string }> = ({ title, note }) => {
  // Без проявления. Врезки входят резкой склейкой, и текст, проявляющийся ещё
  // 240 мс после неё, давал пустой тёмный кадр в самом начале сцены — зритель
  // видел чёрный экран вместо заголовка. Если переход резкий, содержимое
  // обязано быть на месте с первого же кадра.
  return (
    <div
      style={{
        position: 'absolute',
        top: storyTokens.safeTop,
        left: storyTokens.safeSide,
        right: storyTokens.safeSide,
        textAlign: 'center',
        fontFamily,
      }}
    >
      <div
        style={{
          // Кегль 80, а не 112: прописные шире строчных примерно на 10 %, и на
          // 112 «ДОМ В ЧЕТВЕРТЬ» переставало помещаться в строку. Вторая строка
          // заголовка съедала место под фигуру, а фигура здесь — главное.
          fontSize: storyTokens.font.kicker,
          fontWeight: storyTokens.weight.bold,
          lineHeight: storyTokens.line.tight,
          color: storyTokens.color.textPrimary,
          // Все тексты ролика набраны прописными — решение автора 11.08.2026.
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: storyTokens.space[4],
          fontSize: storyTokens.font.caption,
          fontWeight: storyTokens.weight.regular,
          lineHeight: storyTokens.line.normal,
          color: storyTokens.color.textMuted,
          textTransform: 'uppercase',
        }}
      >
        {note}
      </div>
    </div>
  );
};

/**
 * Область под графику фулскрин-сцены.
 *
 * Границы не декоративные и не постоянные — они считаются от двух соседей:
 *   сверху — подпись сцены (заголовок в строку плюс пояснение в две);
 *   снизу — СУБТИТР, который живёт на 65 % высоты и на фулскрин-сценах никуда
 *           не девается: речь под врезкой не прекращается.
 *
 * До перехода на однословные субтитры они стояли внизу кадра, и фигура спокойно
 * занимала всю середину. После переноса субтитра к лицу фигура начала попадать
 * под него — «ВООБЩЕ» легло прямо на крест поверх дома. Отсюда нижняя граница
 * не константой, а по якорю субтитра.
 */
export const SceneStage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { height } = useVideoConfig();
  const subtitleTop = height * storyComponents.subtitleWord.verticalAnchor;
  // Полкегля субтитра плюс воздух: слово центрируется по якорю, значит его
  // верхний край выше якоря на половину строки.
  const clearance = storyComponents.subtitleWord.fontSize * 0.7 + 32;

  return (
    <div
      style={{
        position: 'absolute',
        top: storyTokens.safeTop + 260,
        bottom: height - (subtitleTop - clearance),
        left: storyTokens.safeSide,
        right: storyTokens.safeSide,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  );
};
