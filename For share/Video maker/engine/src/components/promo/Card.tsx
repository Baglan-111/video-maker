import type { CSSProperties, ReactNode } from 'react';
import { component } from '../../brand/promo-tokens';
import type { PromoTheme } from '../../brand/promo-tokens';

// Карточка «интерфейса», нарисованная кодом, а не заснятая скриншотом.
//
// Геометрия фиксированная (component.card), а не «по содержимому»: по этим же
// числам шаблон считает точки для курсора. Если бы высота зависела от вёрстки,
// курсор пришлось бы ставить на глаз и он бы разъезжался со строками.
//
// Границу карточку несёт сама, а не родитель, — это её собственный контур, а не
// внешний отступ (отступы делегированы родителю, правило 1 design-foundations).
export const Card: React.FC<{
  theme: PromoTheme;
  children: ReactNode;
  style?: CSSProperties;
}> = ({ theme, children, style }) => (
  <div
    style={{
      position: 'absolute',
      left: (1920 - component.card.width) / 2,
      top: component.card.top,
      width: component.card.width,
      boxSizing: 'border-box',
      padding: component.card.padding,
      backgroundColor: theme.color.surface,
      border: `${component.card.borderWidth}px solid ${theme.color.surfaceBorder}`,
      borderRadius: theme.radius.card,
      // Тень — второй, независимый от цвета признак края: белая карточка на
      // светлом фоне разностью заливок не читается (1.44:1), контур несёт
      // граница, объём — тень.
      boxShadow: '0 24px 64px rgba(15, 20, 25, 0.14)',
      display: 'flex',
      flexDirection: 'column',
      gap: theme.space.normal,
      ...style,
    }}
  >
    {children}
  </div>
);

/** Шапка карточки: заголовок слева, счётчик справа. */
export const CardHeader: React.FC<{ theme: PromoTheme; title: string; children?: ReactNode }> = ({
  theme,
  title,
  children,
}) => (
  <div
    style={{
      height: component.card.headerHeight,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.normal,
    }}
  >
    <span
      style={{
        fontSize: theme.size.cardTitle,
        fontWeight: theme.weight.bold,
        color: theme.color.textPrimary,
        // Разрядка у КАПСА обязательна: без неё прописные слипаются в полосу.
        letterSpacing: '0.08em',
      }}
    >
      {title}
    </span>
    {children}
  </div>
);
