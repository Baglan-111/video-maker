import { component } from '../../brand/promo-tokens';
import type { PromoTheme } from '../../brand/promo-tokens';

// Строка списка внутри карточки.
//
// Разделительная линия здесь разрешена именно потому, что это строки списка, —
// единственное исключение из правила «группировку делают отступами, а не
// линиями» (design-foundations, правило 1). Линия рисуется снизу и только между
// строками: у последней её нет, иначе она читается как оборванный список.
export const ListRow: React.FC<{
  theme: PromoTheme;
  text: string;
  divider: boolean;
}> = ({ theme, text, divider }) => (
  <div
    style={{
      height: component.card.rowHeight,
      display: 'flex',
      alignItems: 'center',
      borderBottom: divider ? `${component.card.hairlineHeight}px solid ${theme.color.hairline}` : 'none',
      boxSizing: 'border-box',
    }}
  >
    <span
      style={{
        fontSize: theme.size.row,
        fontWeight: theme.weight.regular,
        color: theme.color.textPrimary,
        // Одна строка на строку списка: перенос сломал бы фиксированную высоту,
        // по которой шаблон считает точки курсора.
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {text}
    </span>
  </div>
);
