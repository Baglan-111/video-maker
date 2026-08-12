import { component } from '../../brand/promo-tokens';
import type { PromoTheme } from '../../brand/promo-tokens';

// Бейдж-счётчик: крупное значение и подпись рядом.
//
// Подпись обязательна по схеме, и это не формальность: голая цифра «7» на
// карточке не значит ничего, читателю нужно «7 карточек». Правило 6
// design-foundations в обратную сторону — тест Дженги проходит по слову, а не
// по смыслу.
//
// Цифра идёт табличными цифрами (font-variant-numeric): значение счётчика —
// число, а не текст, и в кадре не должно «плясать» по базовой линии.
export const CounterBadge: React.FC<{ theme: PromoTheme; value: string; label: string }> = ({
  theme,
  value,
  label,
}) => (
  <div
    style={{
      height: component.badge.height,
      paddingLeft: component.badge.paddingInline,
      paddingRight: component.badge.paddingInline,
      display: 'flex',
      alignItems: 'baseline',
      gap: theme.space.tight,
      backgroundColor: theme.color.accentFill,
      borderRadius: theme.radius.pill,
      color: theme.color.textOnAccent,
    }}
  >
    <span
      style={{
        fontSize: theme.size.counter,
        fontWeight: theme.weight.bold,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
      }}
    >
      {value}
    </span>
    <span style={{ fontSize: theme.size.label, fontWeight: theme.weight.regular, lineHeight: 1 }}>{label}</span>
  </div>
);
