import { useState } from 'react';
import { TYPE_COLORS } from '../../core/i18n.ts';
import type { SpeciesData } from '../../core/types.ts';
import { initials, spriteUrl } from '../util.ts';

interface Props {
  species: SpeciesData | undefined;
  /** Nome usado quando a espécie não existe no dex. */
  name?: string;
  size?: number;
  className?: string;
}

/** Sprite do Showdown (gen5) com reserva: círculo na cor do tipo com as iniciais. */
export function Sprite({ species, name, size = 56, className = '' }: Props) {
  const src = species ? spriteUrl(species) : '';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const label = species?.name ?? name ?? '?';
  if (!src || failedSrc === src) {
    const [a, b] = species?.types ?? [];
    const c1 = a ? TYPE_COLORS[a] : '#8892a6';
    const c2 = b ? TYPE_COLORS[b] : c1;
    return (
      <span
        className={`sprite sprite-fallback ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(11, size * 0.32), background: `linear-gradient(135deg, ${c1} 0 50%, ${c2} 50% 100%)` }}
        role="img"
        aria-label={label}
        title={label}
      >
        <span>{initials(label)}</span>
      </span>
    );
  }
  return (
    <img
      className={`sprite ${className}`}
      src={src}
      alt={label}
      title={label}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  );
}
