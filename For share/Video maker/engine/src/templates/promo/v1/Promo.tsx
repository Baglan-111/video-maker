import { AbsoluteFill, Easing, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Audio } from '@remotion/media';
import { Music } from '../../../components/Music';
import { Card, CardHeader } from '../../../components/promo/Card';
import { CounterBadge } from '../../../components/promo/CounterBadge';
import { ListRow } from '../../../components/promo/ListRow';
import { Cursor } from '../../../components/promo/Cursor';
import { SubtitleBar } from '../../../components/promo/SubtitleBar';
import { component, semantic } from '../../../brand/promo-tokens';
import type { PromoTheme } from '../../../brand/promo-tokens';
import { fontFamily } from '../../../brand/fonts';
import {
  cursorSegment,
  panelPhase,
  sceneAt,
  sceneSpeech,
  splitTitle,
  surfaceOpacity,
} from '../../../lib/promo-motion.mjs';
import type { PromoCardPanel, PromoPanel } from '../../../lib/video-schema.d.mts';
import type { KineticProps, Timeline } from '../../../schema';

// Шаблон promo@1 — горизонтальное продуктовое промо 1920×1080.
//
// Чем отличается от kinetic@1, кроме размера кадра:
//   • экран не режется на сцены. Каждая панель проявляется, пока предыдущая
//     уходит (panelPhase берёт окно с опережением), поэтому монтажных склеек
//     нет вообще — кадр всё время один и тот же, меняется его содержимое;
//   • субтитр — плашка с целой фразой, а не пословное караоке;
//   • «интерфейс» рисуется примитивами (карточка, бейдж, строка, курсор),
//     скриншотов нет.
//
// Что осталось общим и намеренно не продублировано: озвучка, метки времени,
// длительности сцен, музыка с ducking, нормализация громкости. Всё это приходит
// из timeline.json и из того же конвейера, что у kinetic@1.

export type PromoFullProps = KineticProps & {
  timeline: Timeline | null;
  panels: PromoPanel[];
};

const CARD_LEFT = (1920 - component.card.width) / 2;

// Вертикаль карточки считается арифметикой, а не подбирается: по этим же числам
// ставятся точки курсора, и «поправить на глаз» здесь означало бы промах курсора
// мимо строки. ListRow держит высоту через box-sizing: border-box, поэтому
// разделитель не добавляет к шагу ни пикселя — шаг ровно rowHeight.
const HEADER_TO_ROWS_GAP = 32; // = space.normal, тот же gap стоит во flex у Card
const ROWS_TOP =
  component.card.top +
  component.card.borderWidth +
  component.card.padding +
  component.card.headerHeight +
  HEADER_TO_ROWS_GAP;
const rowCenterY = (i: number) => ROWS_TOP + i * component.card.rowHeight + component.card.rowHeight / 2;

/** Точки, по которым идёт курсор: подход сверху, затем каждая строка списка. */
const cursorPoints = (rowCount: number) => [
  { x: CARD_LEFT + 200, y: component.card.top - 40 },
  ...Array.from({ length: rowCount }, (_, i) => ({ x: CARD_LEFT + 160, y: rowCenterY(i) })),
];

const enterEase = Easing.bezier(...component.motion.entranceEasing);
const standardEase = Easing.bezier(...component.motion.standardEasing);

/**
 * Появление и уход панели одним набором чисел.
 * Прозрачность и подъём идут вместе: движение без прозрачности читается как
 * рывок, прозрачность без движения — как подмена кадра.
 *
 * solid отмечает панель-поверхность (карточку). Она набирает непрозрачность за
 * первую треть появления и дальше только подъезжает — иначе уходящий заголовок
 * просвечивает сквозь неё. Разбор — surfaceOpacity в promo-motion.mjs.
 */
const panelStyle = (phase: { enter: number; exit: number }, solid = false) => {
  const appear = interpolate(phase.enter, [0, 1], [0, 1], { easing: enterEase });
  const leave = interpolate(phase.exit, [0, 1], [0, 1], { easing: standardEase });
  const rise = solid ? component.motion.surfaceRise : component.motion.riseDistance;
  return {
    opacity: surfaceOpacity(appear, leave, { solid }),
    transform: `translateY(${(1 - appear) * rise - leave * component.motion.riseDistance}px)`,
  };
};

const TitlePanel: React.FC<{ theme: PromoTheme; display: string; phase: { enter: number; exit: number } }> = ({
  theme,
  display,
  phase,
}) => {
  const { lead, accent } = splitTitle(display);
  return (
    <div
      style={{
        position: 'absolute',
        left: theme.space.page,
        right: theme.space.page,
        top: 334,
        textAlign: 'center',
        fontSize: theme.size.hero,
        fontWeight: theme.weight.bold,
        lineHeight: 1.15,
        ...panelStyle(phase),
      }}
    >
      {/* Заголовок в две краски: первая часть нейтральная, вторая акцентная.
          Иерархия при этом держится не только цветом — вторая часть стоит второй
          строкой, то есть читается по позиции даже в ч/б (правило 2). */}
      <div style={{ color: theme.color.textPrimary }}>{lead}</div>
      {accent ? <div style={{ color: theme.color.textAccent }}>{accent}</div> : null}
    </div>
  );
};

const CardPanel: React.FC<{
  theme: PromoTheme;
  panel: PromoCardPanel;
  phase: { enter: number; exit: number; sceneFrame: number };
}> = ({ theme, panel, phase }) => {
  const style = panelStyle(phase, true);
  const points = cursorPoints(panel.rows.length);

  // Курсор трогается, когда сцена реально началась, а не пока карточка ещё
  // проявляется: движущийся курсор на полупрозрачной карточке выглядит как сбой.
  const seg = cursorSegment(points, phase.sceneFrame, {
    travelFrames: component.cursor.travelFrames,
    dwellFrames: component.cursor.dwellFrames,
  });
  // Плавное замедление на подъезде к строке: стандартная кривая Carbon —
  // элемент виден всё время движения. Баунса в ней нет по построению.
  const t = seg ? interpolate(seg.t, [0, 1], [0, 1], { easing: standardEase }) : 0;
  const cursorX = seg ? seg.from.x + (seg.to.x - seg.from.x) * t : 0;
  const cursorY = seg ? seg.from.y + (seg.to.y - seg.from.y) * t : 0;

  return (
    <div style={{ position: 'absolute', inset: 0, ...style }}>
      <Card theme={theme}>
        <CardHeader theme={theme} title={panel.title}>
          {panel.counter ? (
            <CounterBadge theme={theme} value={panel.counter.value} label={panel.counter.label} />
          ) : null}
        </CardHeader>
        <div>
          {panel.rows.map((row, i) => (
            <ListRow key={i} theme={theme} text={row} divider={i < panel.rows.length - 1} />
          ))}
        </div>
      </Card>
      {seg && phase.sceneFrame >= 0 ? (
        <Cursor theme={theme} x={cursorX} y={cursorY} opacity={1} />
      ) : null}
    </div>
  );
};

export const Promo: React.FC<PromoFullProps> = ({ slug, bg, accent, timeline, music, musicVolume, panels }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!timeline) {
    throw new Error(`Нет timeline.json для ${slug} — сначала node scripts/tts.mjs ${slug}`);
  }

  const theme = semantic(accent);
  const allCaptions = timeline.scenes.flatMap((s) => s.captions);

  // Плашка-субтитр живёт по границам сцены: одна фраза от начала сцены до её
  // конца. Появление и уход короче панельных — субтитр не должен спорить за
  // внимание с тем, что происходит на карточке.
  const active = sceneAt(timeline.scenes, frame);
  const subtitlePhase = active
    ? panelPhase(active.scene.startFrame, active.durationFrames, frame, { enterFrames: 5, exitFrames: 5 })
    : null;

  return (
    <AbsoluteFill
      style={{
        // Единый градиентный фон на весь ролик: он не меняется между сценами и
        // тем самым склеивает их в одно непрерывное движение.
        // Нижний тон берётся из bg ролика — это единственная настройка фона,
        // которую понимает плоское поле video.json. Контрасты в promo-tokens
        // посчитаны для значения #C9D8F0; поменять его — значит пересчитать их.
        background: `linear-gradient(180deg, ${theme.color.pageTop} 0%, ${theme.color.pageTop} 42%, ${bg} 100%)`,
        fontFamily,
      }}
    >
      {/* Звук — сценами, как в kinetic@1: <Audio> обязан жить внутри своего
          окна, иначе фраза заиграет не в своё время. Картинка при этом сценами
          НЕ режется, она непрерывна. */}
      {timeline.scenes.map((s) =>
        s.audioFile ? (
          <Sequence key={s.index} from={s.startFrame} durationInFrames={s.durationFrames}>
            <Audio src={staticFile(`project/${s.audioFile}`)} />
          </Sequence>
        ) : null,
      )}

      {panels.map((panel, i) => {
        const scene = timeline.scenes.find((s) => s.index === panel.scene);
        if (!scene) return null;
        const phase = panelPhase(scene.startFrame, scene.durationFrames, frame, {
          enterFrames: component.motion.enterFrames,
          exitFrames: component.motion.exitFrames,
        });
        if (!phase) return null;
        return panel.kind === 'card' ? (
          <CardPanel key={i} theme={theme} panel={panel} phase={phase} />
        ) : (
          <TitlePanel key={i} theme={theme} display={scene.display} phase={phase} />
        );
      })}

      {music ? <Music src={`music/${music}`} captions={allCaptions} fps={fps} base={musicVolume} /> : null}

      {active && subtitlePhase ? (
        <SubtitleBar
          theme={theme}
          text={sceneSpeech(active.scene)}
          opacity={
            interpolate(subtitlePhase.enter, [0, 1], [0, 1], { easing: enterEase }) *
            (1 - interpolate(subtitlePhase.exit, [0, 1], [0, 1], { easing: standardEase }))
          }
        />
      ) : null}
    </AbsoluteFill>
  );
};
