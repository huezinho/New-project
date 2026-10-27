/** Pesos padrão das sugestões de Pokémon (reexportados por engine.ts). */
import type { EngineContext, SuggestionWeights } from './api.ts';

export const DEFAULT_WEIGHTS: SuggestionWeights = {
  meta: 0.18,
  winRate: 0.12,
  synergy: 0.16,
  defensive: 0.16,
  offensive: 0.1,
  roles: 0.14,
  threats: 0.08,
  archetype: 0.06,
};

/** Pesos padrão sobrescritos pelos do usuário (valores inválidos são ignorados). */
export function mergedWeights(ctx: EngineContext): SuggestionWeights {
  const out = { ...DEFAULT_WEIGHTS };
  for (const [key, value] of Object.entries(ctx.weights ?? {})) {
    if (key in out && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[key as keyof SuggestionWeights] = value;
    }
  }
  return out;
}
