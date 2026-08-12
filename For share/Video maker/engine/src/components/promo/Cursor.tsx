import { component } from '../../brand/promo-tokens';
import type { PromoTheme } from '../../brand/promo-tokens';

// Курсор мыши, нарисованный кодом.
//
// Две краски намеренно: тёмная заливка и светлая обводка. Одноцветный курсор
// пропадает, как только заезжает на подложку своего тона, — а он по сюжету
// ездит и по белой карточке, и по фону. Обводка делает его читаемым на любом,
// не полагаясь на то, что подложка окажется удачной.
//
// x, y — координаты ОСТРИЯ, а не угла картинки: шаблон рассуждает точками
// интереса («центр второй строки»), и попадание острия в точку не должно
// зависеть от размера значка.
const ASPECT = 12 / 19; // пропорции контура, чтобы масштаб не искажал форму

export const Cursor: React.FC<{ theme: PromoTheme; x: number; y: number; opacity: number }> = ({
  theme,
  x,
  y,
  opacity,
}) => {
  const height = component.cursor.size;
  const width = height * ASPECT;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 12 19"
      style={{
        position: 'absolute',
        // остриё контура лежит в (1, 1) единиц viewBox — вычитаем его, чтобы
        // (x, y) снаружи означало именно остриё
        left: x - (1 / 12) * width,
        top: y - (1 / 19) * height,
        opacity,
        filter: 'drop-shadow(0 4px 8px rgba(15, 20, 25, 0.28))',
      }}
    >
      <path
        d="M1 1 L1 16.2 L4.6 12.9 L7 18 L9.4 17 L7.1 12 L11.5 12 Z"
        fill={theme.color.cursor}
        stroke={theme.color.surface}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
};
