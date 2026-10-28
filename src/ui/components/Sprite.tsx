import { useState, type CSSProperties } from 'react';
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
  const [a, b] = species?.types ?? [];
  const c1 = a ? TYPE_COLORS[a] : '#8892a6';
  const c2 = b ? TYPE_COLORS[b] : c1;
  if (!src || failedSrc === src) {
    return (
      <span
        className={`sprite sprite-fallback ${className}`}
        style={{ '--sz': `${size}px`, background: `linear-gradient(135deg, ${c1} 0 50%, ${c2} 50% 100%)` } as CSSProperties}
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
      // disco suave na cor do tipo enquanto carrega (e atrás do sprite)
      style={{ '--sz': `${size}px`, background: `radial-gradient(circle, color-mix(in srgb, ${c1} 22%, transparent) 0 60%, transparent 61%)` } as CSSProperties}
      onError={() => setFailedSrc(src)}
    />
  );
}
