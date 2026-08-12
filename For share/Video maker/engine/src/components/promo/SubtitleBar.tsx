import { component } from '../../brand/promo-tokens';
import type { PromoTheme } from '../../brand/promo-tokens';

// Плашка-субтитр: одна произнесённая фраза целиком, а не пословное караоке
// (караоке живёт в components/Subtitles.tsx и остаётся у шаблона kinetic@1).
//
// Почему для промо именно так. Караоке заставляет читать в темпе речи и тянет
// внимание на себя — в вертикальном ролике это приём, там текст и есть главный
// объект. В продуктовом промо главный объект — интерфейс, а субтитр обслуживает
// его: зритель считывает фразу одним взглядом и возвращается к карточке.
//
// Плашка стоит в самом низу и центрирована; карточка заканчивается выше её
// верхнего края — расстояние проверено арифметикой в Promo.tsx, а не глазом.
export const SubtitleBar: React.FC<{ theme: PromoTheme; text: string; opacity: number }> = ({
  theme,
  text,
  opacity,
}) => {
  if (!text) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: component.subtitleBar.bottom,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity,
      }}
    >
      <div
        style={{
          maxWidth: component.subtitleBar.maxWidth,
          paddingTop: component.subtitleBar.paddingBlock,
          paddingBottom: component.subtitleBar.paddingBlock,
          paddingLeft: component.subtitleBar.paddingInline,
          paddingRight: component.subtitleBar.paddingInline,
          backgroundColor: theme.color.scrim,
          borderRadius: component.subtitleBar.radius,
          color: theme.color.textOnScrim,
          fontSize: theme.size.subtitle,
          fontWeight: theme.weight.regular,
          lineHeight: 1.25,
          textAlign: 'center',
          // Фраза обязана уместиться в одну строку: высота плашки заложена в
          // расчёт зазора до карточки. Схема ограничивает длину фразы косвенно —
          // это защита от переполнения, если фраза окажется длиннее ожидаемого.
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {text}
      </div>
    </div>
  );
};
