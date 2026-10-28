import { TYPE_COLORS, TYPE_PT } from '../../core/i18n.ts';
import type { TypeName } from '../../core/types.ts';

const DARK_TEXT = '#0f1420';

/** Luminância relativa (WCAG) de uma cor #rrggbb. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** true quando texto escuro contrasta mais que branco com o fundo (ex.: Gelo, Elétrico, Lutador). */
function isLight(hex: string): boolean {
  const l = luminance(hex);
  return (l + 0.05) / (luminance(DARK_TEXT) + 0.05) > 1.05 / (l + 0.05);
}

export function TypeBadge({ type, small = false }: { type: TypeName; small?: boolean }) {
  const color = TYPE_COLORS[type] ?? '#888';
  return (
    <span className={`type-badge${small ? ' small' : ''}${isLight(color) ? ' light' : ''}`} style={{ background: color }}>
      {TYPE_PT[type] ?? type}
    </span>
  );
}

export function TypeList({ types, small = false }: { types: readonly TypeName[] | undefined; small?: boolean }) {
  if (!types?.length) return null;
  return (
    <span className="type-list">
      {types.map(t => (
        <TypeBadge key={t} type={t} small={small} />
      ))}
    </span>
  );
}
