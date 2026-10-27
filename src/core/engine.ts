/**
 * Ponto de entrada do motor. ESQUELETO: as funções serão implementadas nos
 * módulos analysis.ts / suggest/*.ts; a assinatura é o contrato usado pela UI.
 */
import { DexAccess } from './dex.ts';
import type {
  AbilitySuggestion, EngineContext, Heuristics, ItemSuggestion, MoveSetSuggestion, PokemonSuggestion,
  SpreadSuggestion, SuggestionWeights, TeamAnalysis,
} from './api.ts';
import type { Dex, Meta, PokemonSet, Team } from './types.ts';

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

export function createEngineContext(dex: Dex, meta: Meta, heuristics: Heuristics, weights?: Partial<SuggestionWeights>, regulation?: string): EngineContext {
  return { dex: new DexAccess(dex, regulation), meta, heuristics, weights };
}

const todo = (name: string): never => {
  throw new Error(`${name}: não implementado`);
};

export function analyzeTeam(_ctx: EngineContext, _team: Team): TeamAnalysis {
  return todo('analyzeTeam');
}
export function suggestPokemon(_ctx: EngineContext, _team: Team, _limit = 12): PokemonSuggestion[] {
  return todo('suggestPokemon');
}
export function suggestMoves(_ctx: EngineContext, _team: Team, _slot: number): MoveSetSuggestion {
  return todo('suggestMoves');
}
export function suggestItems(_ctx: EngineContext, _team: Team, _slot: number): ItemSuggestion[] {
  return todo('suggestItems');
}
export function suggestAbilities(_ctx: EngineContext, _team: Team, _slot: number): AbilitySuggestion[] {
  return todo('suggestAbilities');
}
export function suggestSpreads(_ctx: EngineContext, _team: Team, _slot: number): SpreadSuggestion[] {
  return todo('suggestSpreads');
}
export function buildSet(_ctx: EngineContext, _team: Team, _species: string): PokemonSet {
  return todo('buildSet');
}
export function autoComplete(_ctx: EngineContext, _team: Team): Team {
  return todo('autoComplete');
}
