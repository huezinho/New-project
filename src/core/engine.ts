/**
 * Ponto de entrada do motor: implementa o contrato EngineApi (api.ts)
 * delegando para analysis.ts, suggest/*.ts e damage.ts. A UI e a CLI usam só
 * estas funções.
 */
import { DexAccess } from './dex.ts';
import type {
  AbilitySuggestion, DamageFieldOptions, DamageResult, EngineApi, EngineContext, Heuristics, ItemSuggestion, MatchupEntry,
  MoveSetSuggestion, PokemonSuggestion, SpreadSuggestion, SuggestionWeights, TeamAnalysis,
} from './api.ts';
import { analyzeTeam as analyze } from './analysis.ts';
import { calcDamage as damage, quickMatchups as matchups } from './damage.ts';
import { emptySP, STAT_IDS } from './stats.ts';
import { suggestAbilities as abilities } from './suggest/abilities.ts';
import { autoComplete as complete } from './suggest/autocomplete.ts';
import { buildSet as build } from './suggest/build.ts';
import { suggestItems as items } from './suggest/items.ts';
import { suggestMoves as moves } from './suggest/moves.ts';
import { rankPokemon as rank, suggestPokemon as pokemon, type RankedPokemon } from './suggest/pokemon.ts';
import { suggestSpreads as spreads } from './suggest/spreads.ts';
import type { Dex, Meta, PokemonSet, Team } from './types.ts';
import { DEFAULT_WEIGHTS } from './weights.ts';

export { DEFAULT_WEIGHTS };
export type { RankedPokemon };

export function createEngineContext(dex: Dex, meta: Meta, heuristics: Heuristics, weights?: Partial<SuggestionWeights>, regulation?: string): EngineContext {
  return { dex: new DexAccess(dex, regulation), meta, heuristics, weights };
}

const TEXT_FIELDS = ['item', 'ability', 'nature', 'nickname'] as const;

/**
 * Set com campos de tipo errado normalizados (golpes viram lista de textos, SP
 * viram números). Valores fora da regra (SP negativo, acima de 32...) são
 * mantidos para a análise apontar; entrada inválida vira slot vazio.
 */
function cleanSet(s: unknown): PokemonSet {
  if (!s || typeof s !== 'object' || typeof (s as PokemonSet).species !== 'string') return { species: '', sp: emptySP(), moves: [] };
  const set = s as PokemonSet;
  const raw = (set.sp && typeof set.sp === 'object' ? set.sp : {}) as Partial<Record<string, unknown>>;
  const sp = emptySP();
  for (const k of STAT_IDS) {
    const v = typeof raw[k] === 'number' ? (raw[k] as number) : Number(raw[k] ?? 0);
    sp[k] = Number.isFinite(v) ? v : 0;
  }
  const moves = Array.isArray(set.moves) ? set.moves.filter((m): m is string => typeof m === 'string') : [];
  const out: PokemonSet = { ...set, sp, moves };
  for (const key of TEXT_FIELDS) if (out[key] !== undefined && typeof out[key] !== 'string') delete out[key];
  if (out.level != null && (typeof out.level !== 'number' || !Number.isFinite(out.level))) delete out.level;
  return out;
}

/** Equipe com entradas inválidas trocadas por slots vazios (mantém os índices dos slots). */
const clean = (team: Team): Team => (Array.isArray(team) ? team.map(cleanSet) : []);

export function analyzeTeam(ctx: EngineContext, team: Team): TeamAnalysis {
  return analyze(ctx, clean(team));
}
export function suggestPokemon(ctx: EngineContext, team: Team, limit = 12): PokemonSuggestion[] {
  return pokemon(ctx, clean(team), limit);
}
export function suggestMoves(ctx: EngineContext, team: Team, slot: number): MoveSetSuggestion {
  return moves(ctx, clean(team), slot);
}
export function suggestItems(ctx: EngineContext, team: Team, slot: number): ItemSuggestion[] {
  return items(ctx, clean(team), slot);
}
export function suggestAbilities(ctx: EngineContext, team: Team, slot: number): AbilitySuggestion[] {
  return abilities(ctx, clean(team), slot);
}
export function suggestSpreads(ctx: EngineContext, team: Team, slot: number): SpreadSuggestion[] {
  return spreads(ctx, clean(team), slot);
}
export function buildSet(ctx: EngineContext, team: Team, species: string): PokemonSet {
  return build(ctx, clean(team), species);
}
export function autoComplete(ctx: EngineContext, team: Team): Team {
  return complete(ctx, clean(team));
}
/** Ranking completo de candidatos (sem montar sets). */
export function rankPokemon(ctx: EngineContext, team: Team): RankedPokemon[] {
  return rank(ctx, clean(team));
}
/** Dano de `move` do atacante contra o defensor (null se o calc não suportar). */
export function calcDamage(
  ctx: EngineContext, attacker: PokemonSet, defender: PokemonSet, move: string, field: DamageFieldOptions = {},
): DamageResult | null {
  return damage(ctx, cleanSet(attacker), cleanSet(defender), typeof move === 'string' ? move : '', field ?? {});
}
/** Confrontos rápidos de cada membro contra as ameaças mais usadas do meta. */
export function quickMatchups(ctx: EngineContext, team: Team, limit = 6): MatchupEntry[] {
  return matchups(ctx, clean(team), limit);
}

/** Implementação do contrato completo (útil para injeção na CLI/testes). */
export const engine: EngineApi = {
  analyzeTeam,
  suggestPokemon,
  suggestMoves,
  suggestItems,
  suggestAbilities,
  suggestSpreads,
  buildSet,
  autoComplete,
};
