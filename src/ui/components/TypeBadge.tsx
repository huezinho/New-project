import { TYPE_COLORS, TYPE_PT } from '../../core/i18n.ts';
import type { TypeName } from '../../core/types.ts';

/** Luminância relativa aproximada para escolher texto claro/escuro. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
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
