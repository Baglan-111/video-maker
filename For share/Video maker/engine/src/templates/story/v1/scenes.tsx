import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { storyTokens, storyComponents, storyMotion } from '../../../brand/story-tokens';
import { fontFamily } from '../../../brand/fonts';
import { Kicker, Scrim, SceneCaption, SceneStage, useEnter, STACK_BOTTOM } from './parts';
import { HouseFigure, TentFigure, MiniHouse, MiniTent } from './figures';
import type {
  StoryScene,
  StoryMetaphorScene,
  StoryStatementScene,
  StoryQuestionsScene,
  StoryCompareScene,
  StoryCtaScene,
  StoryAccentScene,
  StoryTalkingHeadScene,
} from '../../../lib/video-schema.d.mts';

// Сцены story@1.
//
// Общее правило раскладки: весь текст поверх кадра живёт в НИЖНЕЙ трети, одним
// блоком с субтитрами. Лицо не перекрывается вообще, и глаз не мечется между
// тезисом наверху и субтитром внизу.
//
// Первая сборка ставила тезисы сверху, от safeTop: расчёт был на то, что центр
// занят лицом, а верх свободен. На снятом монологе это не работает — говорящий
// наклоняется к камере, и панель садится на лоб (18–29 с). Низ занят торсом и
// руками, там перекрывать нечего.
//
// Фулскрин-сцены живут по своим правилам: лица под ними нет, поэтому подпись
// стоит сверху, а фигура занимает середину.

const easeIn = Easing.bezier(...storyMotion.entrance);

/** Панель поверх кадра. Та же подложка, что у кикера, — контраст уже посчитан. */
const Panel: React.FC<{ children: React.ReactNode; delayFrames?: number }> = ({
  children,
}) => {
  // Плашка стоит с первого кадра сцены. Проявление здесь давало кадр, где
  // сцена уже началась, а на экране только лицо — зритель читал это как
  // лишнюю склейку между врезками.
  const opacity = 1;
  const translate = '0px 0px';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: STACK_BOTTOM,
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
          // Плашка обнимает содержимое, а не растягивается на всю ширину:
          // иначе одно слово CTA плавает в пустом прямоугольнике, и плашка
          // читается как незаполненный блок, а не как акцент.
          width: 'fit-content',
          maxWidth: '100%',
          paddingBlock: storyComponents.panel.padding,
          paddingInline: storyComponents.panel.padding,
          borderRadius: storyTokens.radius.card,
          backgroundColor: storyComponents.kicker.background,
          fontFamily,
          textAlign: 'center',
          textTransform: 'uppercase',
        }}
      >
        {children}
      </div>
    </div>
  );
};

const TalkingHead: React.FC<{ scene: StoryTalkingHeadScene }> = ({ scene }) =>
  scene.kicker ? <Kicker text={scene.kicker} /> : null;

const Metaphor: React.FC<{ scene: StoryMetaphorScene; ctx: SceneContext }> = ({ scene, ctx }) => (
  <Scrim
    durationInFrames={ctx.durationInFrames}
    continuesFromPrev={ctx.prevIsFullscreen}
    continuesToNext={ctx.nextIsFullscreen}
  >
    <SceneCaption title={scene.title} note={scene.note} />
    <SceneStage>{scene.kind === 'house' ? <HouseFigure /> : <TentFigure />}</SceneStage>
  </Scrim>
);

/**
 * Акцент — одна фраза во весь экран.
 *
 * Кегль title (112), не kicker: фраза здесь одна и держится три секунды, ей
 * положено занимать экран. Строки появляются целиком, без побуквенного вывода —
 * читать три секунды нечего, нужно узнать за долю секунды.
 */
const Accent: React.FC<{ scene: StoryAccentScene; ctx: SceneContext }> = ({ scene, ctx }) => {
  // Без проявления: врезка входит резко, текст стоит с первого кадра.
  return (
    <Scrim
      durationInFrames={ctx.durationInFrames}
      continuesFromPrev={ctx.prevIsFullscreen}
      continuesToNext={ctx.nextIsFullscreen}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingInline: storyTokens.safeSide,
          // Снизу оставлено место под субтитр: речь под акцентом не прекращается.
          paddingBottom: 320,
          fontFamily,
          fontSize: storyTokens.font.title,
          fontWeight: storyTokens.weight.bold,
          lineHeight: storyTokens.line.tight,
          color: storyTokens.color.accentSolution,
          textAlign: 'center',
          textTransform: 'uppercase',
        }}
      >
        {scene.text}
      </div>
    </Scrim>
  );
};

/**
 * Формула из нескольких строк.
 *
 * Строки появляются по очереди с шагом 240 мс, а не разом: они произносятся
 * последовательно, и одновременное появление обогнало бы речь — зритель
 * дочитал бы вывод раньше, чем услышал.
 */
const Statement: React.FC<{ scene: StoryStatementScene }> = ({ scene }) => {
  const { fps } = useVideoConfig();
  const step = Math.round((storyMotion.durationMs.panel / 1000) * fps);

  return (
    <Panel>
      {scene.lines.map((line, i) => (
        <StatementLine key={i} text={line} delayFrames={i * step} last={i === scene.lines.length - 1} />
      ))}
    </Panel>
  );
};

const StatementLine: React.FC<{ text: string; delayFrames: number; last: boolean }> = ({
  text,
  delayFrames,
  last,
}) => {
  const { opacity, translate } = useEnter(delayFrames);

  return (
    <div
      style={{
        opacity,
        translate,
        marginTop: delayFrames === 0 ? 0 : storyTokens.space[3],
        fontSize: storyComponents.panel.fontSize,
        // Последняя строка — вывод, и она весомее предыдущих. Разница дана
        // весом и цветом сразу: вес работает в ч/б, цвет — в ленте.
        fontWeight: last ? storyTokens.weight.bold : storyTokens.weight.medium,
        color: last ? storyTokens.color.accentSolution : storyTokens.color.textPrimary,
        lineHeight: storyTokens.line.tight,
      }}
    >
      {text}
    </div>
  );
};

/**
 * Два вопроса: неверный зачёркивается, верный остаётся.
 *
 * Зачёркивание анимировано линией, а не текстовым `line-through`: линия
 * проводится во времени и совпадает с моментом, когда он говорит «не что
 * выкинуть». Мгновенная перечёркнутость показала бы результат до слов.
 */
const Questions: React.FC<{ scene: StoryQuestionsScene }> = ({ scene }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const step = Math.round((storyMotion.durationMs.panel / 1000) * fps);
  const strikeStart = step * 3;

  const strike = interpolate(frame, [strikeStart, strikeStart + step * 2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeIn,
  });

  const right = useEnter(strikeStart + step * 2);

  return (
    <Panel>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <div
          style={{
            fontSize: storyComponents.panel.fontSize,
            fontWeight: storyTokens.weight.medium,
            lineHeight: storyTokens.line.tight,
            color: storyTokens.color.textPrimary,
            // Гаснет до 0.72, не ниже: отвергнутый вопрос обязан остаться
            // читаемым — на нём держится контраст с верным. Ниже этого порога
            // он превращается в серое пятно, и сравнение пропадает.
            opacity: interpolate(strike, [0, 1], [1, 0.72]),
          }}
        >
          {scene.wrong}
        </div>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            height: 8,
            width: `${strike * 100}%`,
            borderRadius: storyTokens.radius.pill,
            backgroundColor: storyTokens.color.markNegative,
          }}
        />
      </div>

      <div
        style={{
          marginTop: storyComponents.panel.gap,
          opacity: right.opacity,
          translate: right.translate,
          fontSize: storyComponents.panel.fontSize,
          fontWeight: storyTokens.weight.bold,
          lineHeight: storyTokens.line.tight,
          color: storyTokens.color.accentSolution,
        }}
      >
        {scene.right}
      </div>
    </Panel>
  );
};

/** Сравнение в лоб: две фигуры рядом, подписи под ними. */
const Compare: React.FC<{ scene: StoryCompareScene }> = ({ scene }) => {
  // Подпись стоит СБОКУ от значка, а не под ним. Разница не косметическая: с
  // подписью снизу панель была 420 px высотой и её верхний край доставал
  // говорящему до рта (замечено на 31-й секунде первой нижней сборки). Сбоку
  // высоту задаёт только значок — 216 px вместе с полями, вдвое меньше.
  const Column: React.FC<{ figure: React.ReactNode; label: string; good: boolean }> = ({
    figure,
    label,
    good,
  }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: storyTokens.space[2] }}>
      {figure}
      <div
        style={{
          // Колонка под подпись. 240 — не «на глаз»: доступная ширина панели
          // 856 минус два значка по 120, минус внутренние зазоры и зазор между
          // группами, пополам. При 210 жирная подпись «Меньше, но целиком»
          // ломалась на три строки и растягивала панель по высоте — ровно то,
          // от чего эту панель и ужимали.
          width: 240,
          // Без этого flex сжимает колонку под содержимое родителя, и перенос
          // случается раньше заданной ширины — подпись ломается на три строки
          // при том, что в две помещается.
          flexShrink: 0,
          textAlign: 'left',
          fontSize: storyTokens.font.caption,
          lineHeight: storyTokens.line.normal,
          fontWeight: good ? storyTokens.weight.bold : storyTokens.weight.medium,
          color: good ? storyTokens.color.accentSolution : storyTokens.color.textMuted,
        }}
      >
        {label}
      </div>
    </div>
  );

  return (
    <Panel>
      <div style={{ display: 'flex', justifyContent: 'center', gap: storyTokens.space[5] }}>
        <Column figure={<MiniHouse progress={1} />} label={scene.badLabel} good={false} />
        <Column figure={<MiniTent progress={1} />} label={scene.goodLabel} good />
      </div>
    </Panel>
  );
};

/** CTA — одно действие, без второго конкурирующего призыва. */
const Cta: React.FC<{ scene: StoryCtaScene }> = ({ scene }) => (
  <Panel>
    <div
      style={{
        fontSize: storyTokens.font.title,
        fontWeight: storyTokens.weight.bold,
        lineHeight: storyTokens.line.tight,
        color: storyTokens.color.accentSolution,
      }}
    >
      {scene.text}
    </div>
  </Panel>
);

/**
 * Виды сцен, закрывающих кадр целиком.
 *
 * Список нужен не только для отрисовки: по нему считается, надо ли анимировать
 * переход между соседними сценами. Две фулскрин-сцены подряд не должны гасить и
 * зажигать фон на стыке — см. Scrim.
 */
export const FULLSCREEN_KINDS = new Set(['house', 'tent', 'accent']);

/** Что сцене нужно знать о своём месте в ролике. */
export type SceneContext = {
  durationInFrames: number;
  prevIsFullscreen: boolean;
  nextIsFullscreen: boolean;
};

/** Разводит сцену по её kind. Новый вид сцены добавляется здесь и в схеме. */
export const StorySceneView: React.FC<{ scene: StoryScene; ctx: SceneContext }> = ({ scene, ctx }) => {
  switch (scene.kind) {
    case 'talkingHead':
      return <TalkingHead scene={scene} />;
    case 'house':
    case 'tent':
      return <Metaphor scene={scene} ctx={ctx} />;
    case 'accent':
      return <Accent scene={scene} ctx={ctx} />;
    case 'statement':
      return <Statement scene={scene} />;
    case 'questions':
      return <Questions scene={scene} />;
    case 'compare':
      return <Compare scene={scene} />;
    case 'cta':
      return <Cta scene={scene} />;
    default: {
      // Недостижимо при валидной схеме, но если вид сцены добавят в video-schema
      // и забудут здесь, TypeScript покажет это на этой строке, а не молчаливым
      // пустым экраном в готовом ролике.
      const never: never = scene;
      throw new Error(`Неизвестный вид сцены: ${JSON.stringify(never)}`);
    }
  }
};
