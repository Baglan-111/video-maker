import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { storyTokens, storyMotion } from '../../../brand/story-tokens';

// Векторные фигуры метафор.
//
// Рисуются линиями, а не картинками: линия строится во времени, и именно это
// здесь содержательно — дом ДОСТРАИВАЕТСЯ и всё равно не годится, палатка
// РАСКРЫВАЕТСЯ и сразу годится. Готовая картинка показала бы результат, но не
// разницу между процессом и результатом, а вся мысль ролика про неё.
//
// Приём отрисовки: pathLength="1" нормализует длину любого пути к единице, и
// dashoffset от 1 до 0 «прочерчивает» его независимо от реальной геометрии.
// Без этого длину каждого пути пришлось бы мерить в DOM.

const easeStandard = Easing.bezier(...storyMotion.standard);

const STROKE = 10;

/** Прогресс 0→1 на отрезке кадров. Вынесен, потому что нужен всем фигурам. */
const useDraw = (fromFrame: number, toFrame: number) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [fromFrame, toFrame], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeStandard,
  });
};

const Drawn: React.FC<{
  d: string;
  progress: number;
  stroke: string;
  width?: number;
}> = ({ d, progress, stroke, width = STROKE }) => (
  <path
    d={d}
    fill="none"
    stroke={stroke}
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    pathLength={1}
    strokeDasharray={1}
    strokeDashoffset={1 - progress}
  />
);

/**
 * Недостроенный дом.
 *
 * Читается как «стройка», а не как «маленький дом»: стены есть, крыши нет,
 * вместо неё торчат балки, внутри строительная штриховка. Крест в конце —
 * пометка «жить нельзя», и она не только цветом: линии креста толще остальных
 * и лежат поверх, поэтому пометка видна и в ч/б.
 */
export const HouseFigure: React.FC = () => {
  const { fps } = useVideoConfig();
  const s = (ms: number) => Math.round((ms / 1000) * fps);

  // Порядок появления повторяет порядок стройки: земля → стены → перекрытие →
  // торчащая арматура → штриховка → приговор.
  const ground = useDraw(s(200), s(700));
  const walls = useDraw(s(500), s(1400));
  const floor = useDraw(s(1100), s(1700));
  const rebar = useDraw(s(1500), s(2100));
  const hatch = useDraw(s(1900), s(2600));
  const cross = useDraw(s(2900), s(3500));

  return (
    <svg viewBox="0 0 600 460" style={{ width: '100%', height: '100%' }}>
      <Drawn d="M 20 420 L 580 420" progress={ground} stroke={storyTokens.color.accentProblem} />

      {/* Стены и перекрытие — коробка без крыши */}
      <Drawn d="M 105 420 L 105 150" progress={walls} stroke={storyTokens.color.textPrimary} />
      <Drawn d="M 495 420 L 495 150" progress={walls} stroke={storyTokens.color.textPrimary} />
      <Drawn d="M 105 150 L 495 150" progress={floor} stroke={storyTokens.color.textPrimary} />

      {/* Торчащая арматура вместо крыши */}
      <Drawn d="M 155 150 L 143 62" progress={rebar} stroke={storyTokens.color.accentProblem} width={8} />
      <Drawn d="M 300 150 L 300 45" progress={rebar} stroke={storyTokens.color.accentProblem} width={8} />
      <Drawn d="M 445 150 L 457 62" progress={rebar} stroke={storyTokens.color.accentProblem} width={8} />

      {/* Строительная штриховка внутри: внутри нет комнат, есть стройплощадка */}
      <g opacity={0.55}>
        <Drawn d="M 140 420 L 300 190" progress={hatch} stroke={storyTokens.color.accentProblem} width={7} />
        <Drawn d="M 255 420 L 415 190" progress={hatch} stroke={storyTokens.color.accentProblem} width={7} />
        <Drawn d="M 370 420 L 490 245" progress={hatch} stroke={storyTokens.color.accentProblem} width={7} />
      </g>

      {/* Приговор */}
      <Drawn d="M 130 110 L 470 405" progress={cross} stroke={storyTokens.color.markNegative} width={18} />
      <Drawn d="M 470 110 L 130 405" progress={cross} stroke={storyTokens.color.markNegative} width={18} />
    </svg>
  );
};

/**
 * Палатка.
 *
 * Собирается за секунду с небольшим против трёх с лишним у дома — разница в
 * скорости здесь такой же аргумент, как сама форма. Внутри загорается огонь:
 * это единственное место в ролике, где свет означает «работает», поэтому он
 * тёплый и он один.
 */
export const TentFigure: React.FC = () => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const s = (ms: number) => Math.round((ms / 1000) * fps);

  const ground = useDraw(s(150), s(500));
  const body = useDraw(s(350), s(1100));
  const door = useDraw(s(900), s(1500));
  const peg = useDraw(s(1200), s(1700));

  const glowStart = s(1600);
  const glow = interpolate(frame, [glowStart, glowStart + s(500)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeStandard,
  });

  return (
    <svg viewBox="0 0 600 460" style={{ width: '100%', height: '100%' }}>
      <defs>
        <radialGradient id="tent-glow">
          <stop offset="0%" stopColor={storyTokens.color.accentSolution} stopOpacity="0.9" />
          <stop offset="100%" stopColor={storyTokens.color.accentSolution} stopOpacity="0" />
        </radialGradient>
        {/* Свет обрезается по линии земли: без этого он светит и под неё, и
            палатка перестаёт стоять на поверхности — начинает парить. */}
        <clipPath id="tent-above-ground">
          <rect x="0" y="0" width="600" height="420" />
        </clipPath>
      </defs>

      <Drawn d="M 20 420 L 580 420" progress={ground} stroke={storyTokens.color.accentProblem} />

      {/* Свет изнутри — раньше контура двери, чтобы не перекрывал линии */}
      <g clipPath="url(#tent-above-ground)">
        <circle cx="300" cy="345" r="165" fill="url(#tent-glow)" opacity={glow} />
      </g>

      {/* Скаты */}
      <Drawn d="M 300 70 L 105 420" progress={body} stroke={storyTokens.color.accentSolution} />
      <Drawn d="M 300 70 L 495 420" progress={body} stroke={storyTokens.color.accentSolution} />

      {/* Вход */}
      <Drawn d="M 300 165 L 232 420" progress={door} stroke={storyTokens.color.accentSolution} width={8} />
      <Drawn d="M 300 165 L 368 420" progress={door} stroke={storyTokens.color.accentSolution} width={8} />

      {/* Растяжки: палатка стоит на земле, а не висит в воздухе */}
      <Drawn d="M 105 420 L 40 420" progress={peg} stroke={storyTokens.color.accentSolutionDeep} width={8} />
      <Drawn d="M 495 420 L 560 420" progress={peg} stroke={storyTokens.color.accentSolutionDeep} width={8} />
    </svg>
  );
};

/**
 * Мелкие значки для сцены сравнения.
 *
 * Отличаются формой (коробка без крыши против треугольника) и пометкой
 * (крест против галки), а не только цветом — в ч/б разница обязана оставаться.
 */
export const MINI_SIZE = 120;

export const MiniHouse: React.FC<{ progress: number }> = ({ progress }) => (
  <svg viewBox="0 0 200 200" style={{ width: MINI_SIZE, height: MINI_SIZE, flexShrink: 0 }}>
    <Drawn d="M 55 165 L 55 70" progress={progress} stroke={storyTokens.color.textPrimary} width={8} />
    <Drawn d="M 145 165 L 145 70" progress={progress} stroke={storyTokens.color.textPrimary} width={8} />
    <Drawn d="M 55 70 L 145 70" progress={progress} stroke={storyTokens.color.textPrimary} width={8} />
    <Drawn d="M 30 165 L 170 165" progress={progress} stroke={storyTokens.color.accentProblem} width={8} />
    <Drawn d="M 62 40 L 138 130" progress={progress} stroke={storyTokens.color.markNegative} width={14} />
    <Drawn d="M 138 40 L 62 130" progress={progress} stroke={storyTokens.color.markNegative} width={14} />
  </svg>
);

export const MiniTent: React.FC<{ progress: number }> = ({ progress }) => (
  <svg viewBox="0 0 200 200" style={{ width: MINI_SIZE, height: MINI_SIZE, flexShrink: 0 }}>
    <Drawn d="M 100 55 L 40 165" progress={progress} stroke={storyTokens.color.accentSolution} width={8} />
    <Drawn d="M 100 55 L 160 165" progress={progress} stroke={storyTokens.color.accentSolution} width={8} />
    <Drawn d="M 100 100 L 78 165" progress={progress} stroke={storyTokens.color.accentSolution} width={6} />
    <Drawn d="M 100 100 L 122 165" progress={progress} stroke={storyTokens.color.accentSolution} width={6} />
    <Drawn d="M 30 165 L 170 165" progress={progress} stroke={storyTokens.color.accentProblem} width={8} />
    <Drawn d="M 58 42 L 88 72 L 148 22" progress={progress} stroke={storyTokens.color.accentSolution} width={14} />
  </svg>
);
