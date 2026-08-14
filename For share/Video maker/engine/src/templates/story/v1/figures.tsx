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
 * Галочка, которую перечёркивает крест.
 *
 * Метафора отчёта об успехе, который оказался ложью: инструмент рисует ту же
 * галочку, что видишь в любом интерфейсе после удачной операции, и держит её
 * ровно столько, чтобы зритель успел ей поверить. Крест ложится поверх, а не
 * вместо: галочка остаётся на месте и видна под ним — иначе читалось бы «была
 * ошибка», а нужно «успех и был ошибкой».
 *
 * Пауза между ними обязательна. Без неё это один жест, и удивления не возникает.
 */
export const CheckCrossFigure: React.FC = () => {
  const { fps } = useVideoConfig();
  const s = (ms: number) => Math.round((ms / 1000) * fps);

  const check = useDraw(s(100), s(620));
  // Пауза 380 мс: зритель успевает принять галочку за правду. Дальше крест
  // рисуется быстро и остаётся на экране почти секунду — врезка длится 2,4 с,
  // и полный крест обязан висеть дольше, чем чертится.
  const cross = useDraw(s(1000), s(1480));

  return (
    <svg viewBox="0 0 600 460" style={{ width: '100%', height: '100%' }}>
      {/* Галочка интерфейса: короткое плечо вниз, длинное вверх */}
      <Drawn
        d="M 195 240 L 268 315 L 412 148"
        progress={check}
        stroke={storyTokens.color.accentSolution}
        width={22}
      />

      {/* Крест толще галочки и лежит поверх: пометка обязана читаться в ч/б.
          Цвет — markNegative, а не accentProblem: второй приглушённый и на
          тёмном фоне тонет, у него контраст 3.55:1 против 6.39:1. */}
      <Drawn d="M 175 120 L 425 345" progress={cross} stroke={storyTokens.color.markNegative} width={28} />
      <Drawn d="M 425 120 L 175 345" progress={cross} stroke={storyTokens.color.markNegative} width={28} />
    </svg>
  );
};

/**
 * Строки документа, по которым проходит проверка.
 *
 * Пять строк набегают сверху вниз, потом слева направо идёт линия — жест
 * «веду пальцем и сверяю». На третьей строке линия задерживается, строка
 * краснеет и уезжает вправо: ошибка была там, где текст выглядел ровно так же,
 * как остальные.
 *
 * Смещается только одна строка, а не все: если поедет весь блок, это прочтётся
 * как «документ развалился», а мысль другая — снаружи всё цело.
 */
export const ScanFigure: React.FC = () => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const s = (ms: number) => Math.round((ms / 1000) * fps);

  // Пять вызовов подряд, а не цикл: хук в цикле нарушает правила React, даже
  // когда длина массива постоянна.
  const row0 = useDraw(s(80), s(560));
  const row1 = useDraw(s(170), s(650));
  const row2 = useDraw(s(260), s(740));
  const row3 = useDraw(s(350), s(830));
  const row4 = useDraw(s(440), s(920));
  const rows = [row0, row1, row2, row3, row4];
  const scan = useDraw(s(700), s(2100));

  // Момент срыва третьей строки привязан к линии: она доходит до неё примерно
  // на 60% пути, и сдвиг начинается там же, а не по своему таймеру.
  const breakStart = s(1540);
  const shift = interpolate(frame, [breakStart, breakStart + s(420)], [0, 46], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeStandard,
  });
  const broken = interpolate(frame, [breakStart, breakStart + s(240)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const ROW_Y = [120, 190, 260, 330, 400];
  const ROW_W = [420, 380, 440, 350, 300];

  return (
    <svg viewBox="0 0 600 460" style={{ width: '100%', height: '100%' }}>
      {ROW_Y.map((y, i) => {
        const isBroken = i === 2;
        return (
          <g key={y} transform={isBroken ? `translate(${shift} 0)` : undefined}>
            <Drawn
              d={`M 90 ${y} L ${90 + ROW_W[i]} ${y}`}
              progress={rows[i]}
              stroke={isBroken ? storyTokens.color.markNegative : storyTokens.color.textMuted}
              width={isBroken ? 16 : 12}
            />
            {/* Подсветка сломанной строки: та же линия поверх, проявляется в
                момент сдвига. Отдельным элементом, потому что Drawn чертит от
                нуля, а здесь нужно проявление на готовой линии. */}
            {isBroken ? (
              <line
                x1="90"
                y1={y}
                x2={90 + ROW_W[i]}
                y2={y}
                stroke={storyTokens.color.markNegative}
                strokeWidth={22}
                strokeLinecap="round"
                opacity={broken * 0.45}
              />
            ) : null}
          </g>
        );
      })}

      {/* Линия проверки: идёт слева направо на всю высоту блока строк */}
      <line
        x1={70 + scan * 470}
        y1="70"
        x2={70 + scan * 470}
        y2="450"
        stroke={storyTokens.color.accentSolution}
        strokeWidth={8}
        strokeLinecap="round"
        opacity={scan > 0 && scan < 1 ? 1 : scan >= 1 ? 0.35 : 0}
      />
    </svg>
  );
};

/**
 * Значки трёх нейросетей для хука.
 *
 * Контуры — официальные монохромные начертания марок (Simple Icons, CC0 на сами
 * файлы; марки принадлежат владельцам). Взяты потому, что нарисованные «по
 * мотивам» формы не узнавались: ради узнавания хук и ставился.
 *
 * Один цвет на все три — textPrimary. Фирменные цвета здесь спорят между собой
 * и с оранжевым акцентом панели, а ряд должен читаться как один объект
 * «нейросети», а не как три бренда.
 *
 * Использование номинативное: ролик говорит об этих продуктах, не заявляет
 * партнёрства и не выдаёт себя за них.
 */
const LOGO_SIZE = 72;

const Glyph: React.FC<{ d: string }> = ({ d }) => (
  <svg viewBox="0 0 24 24" style={{ width: LOGO_SIZE, height: LOGO_SIZE, flexShrink: 0 }}>
    <path d={d} fill={storyTokens.color.textPrimary} />
  </svg>
);

const OPENAI_PATH =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z';
const GEMINI_PATH =
  'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81';
const CLAUDE_PATH =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z';

export const KnotGlyph: React.FC = () => <Glyph d={OPENAI_PATH} />;
export const SparkGlyph: React.FC = () => <Glyph d={GEMINI_PATH} />;
export const BurstGlyph: React.FC = () => <Glyph d={CLAUDE_PATH} />;

/**
 * Лупа, под которой текст оказывается другим.
 *
 * Снаружи строка выглядит законченным ответом. Круг проезжает по ней слева
 * направо, и под увеличением видно, что одно слово красное и зачёркнуто — то
 * самое место, где ответ врёт. Лупа останавливается на нём и держится до конца
 * врезки: зрителю нужно время прочитать, а не проводить круг мимо.
 *
 * Приём: два слоя одного текста. Нижний обычный, верхний увеличен вокруг центра
 * лупы и обрезан по кругу. Совмещение даёт эффект увеличительного стекла без
 * фильтров и без растровых масок.
 */
export const LensFigure: React.FC<{ text: string; flaw: string }> = ({ text, flaw }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const s = (ms: number) => Math.round((ms / 1000) * fps);

  const W = 1000;
  const H = 420;
  const BASE_Y = 210;
  const FONT = 52;
  const ZOOM = 1.45;
  const R = 172;

  // Слово-дефект стоит в конце строки, поэтому лупа едет вправо и там замирает.
  const travel = interpolate(frame, [s(150), s(1750)], [0.10, 0.53], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeStandard,
  });
  const cx = W * travel;
  const cy = BASE_Y - 18;

  // Подмена включается, только когда лупа доехала: до этого под стеклом тот же
  // текст, что снаружи, иначе фокус раскрывается заранее.
  const revealed = frame >= s(1600);

  const Line: React.FC<{ flawColor: string; strike: boolean }> = ({ flawColor, strike }) => (
    <text
      x="40"
      y={BASE_Y}
      fontSize={FONT}
      fill={storyTokens.color.textMuted}
      style={{ fontWeight: 500 }}
    >
      {text}{' '}
      <tspan fill={flawColor} textDecoration={strike ? 'line-through' : undefined}>
        {flaw}
      </tspan>
    </text>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <clipPath id="lens-clip">
          <circle cx={cx} cy={cy} r={R} />
        </clipPath>
      </defs>

      {/* Слой без увеличения — то, что видно невооружённым глазом */}
      <Line flawColor={storyTokens.color.textMuted} strike={false} />

      {/* Слой под стеклом: тот же текст крупнее, дефект красный и зачёркнут */}
      <g clipPath="url(#lens-clip)">
        <rect x="0" y="0" width={W} height={H} fill={storyTokens.color.surface} opacity={0.92} />
        <g transform={`translate(${cx} ${cy}) scale(${ZOOM}) translate(${-cx} ${-cy})`}>
          <Line
            flawColor={revealed ? storyTokens.color.markNegative : storyTokens.color.textPrimary}
            strike={revealed}
          />
        </g>
      </g>

      {/* Оправа: обод и ручка. Ручка уходит вниз-вправо от центра */}
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke={storyTokens.color.accentSolution}
        strokeWidth={9}
      />
      <line
        x1={cx + R * 0.72}
        y1={cy + R * 0.72}
        x2={cx + R * 1.45}
        y2={cy + R * 1.45}
        stroke={storyTokens.color.accentSolution}
        strokeWidth={16}
        strokeLinecap="round"
      />
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
