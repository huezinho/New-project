/**
 * Contrato público do motor de análise/sugestões. A UI e a CLI dependem
 * apenas destes tipos e das funções exportadas por src/core/engine.ts.
 */
import type { DexAccess } from './dex.ts';
import type { Meta, MetaPokemon, PokemonSet, StatsTable, Team, TypeName } from './types.ts';

/* --------------------------- Heurísticas --------------------------- */

export interface RoleDef {
  id: string;
  namePt: string;
  description: string;
  moves: string[];
  abilities: string[];
  items: string[];
  /** Importância relativa do papel numa equipe de VGC (0-1). */
  weight: number;
}

export interface ArchetypeDef {
  id: string;
  namePt: string;
  setters: { moves: string[]; abilities: string[] };
  abusers: { abilities: string[]; traits: string[] };
  speedProfile: 'fast' | 'slow' | 'mixed';
  antiSynergyMoves: string[];
  description: string;
}

export interface Heuristics {
  version: number;
  roles: RoleDef[];
  archetypes: ArchetypeDef[];
  abilityImmunities: { ability: string; immuneTo: TypeName; bonus?: string }[];
  pairSynergies: { id: string; descriptionPt: string; condition: string; weight: number }[];
  moveHeuristics: { id: string; descriptionPt: string; rule: string; weight: number }[];
  spreadPrinciples: { id: string; descriptionPt: string }[];
  itemHeuristics: { item: string; whenPt: string }[];
}

/* ---------------------------- Contexto ----------------------------- */

export interface EngineContext {
  dex: DexAccess;
  meta: Meta;
  heuristics: Heuristics;
  /** Pesos ajustáveis pelo usuário (0-1). Valores ausentes usam o padrão. */
  weights?: Partial<SuggestionWeights>;
}

export interface SuggestionWeights {
  meta: number;
  winRate: number;
  synergy: number;
  defensive: number;
  offensive: number;
  roles: number;
  threats: number;
  archetype: number;
}

/* ----------------------------- Análise ----------------------------- */

export interface TypeMatchupRow {
  type: TypeName;
  /** Multiplicador por membro (mesma ordem da equipe). */
  multipliers: number[];
  weak: number;
  resist: number;
  immune: number;
  /** Membros com imunidade/absorção vinda de habilidade. */
  abilityNotes: string[];
  /** "ok" | "atenção" | "problema" */
  status: 'ok' | 'warn' | 'bad';
}

export interface CoverageRow {
  type: TypeName;
  /** Melhor multiplicador obtido pela equipe contra Pokémon puros deste tipo. */
  best: number;
  /** Quem acerta super efetivo. */
  hitters: string[];
}

export interface RoleCoverage {
  role: RoleDef;
  providers: { slot: number; species: string; via: string[] }[];
}

export interface SpeedEntry {
  slot?: number;
  species: string;
  speed: number;
  label: string;
  /** Pokémon do meta (true) ou da equipe (false). */
  isMeta: boolean;
  usage?: number;
}

export interface ThreatEntry {
  species: string;
  usage: number;
  /** 0-1: quanto essa ameaça pressiona a equipe. */
  danger: number;
  /** Membros que respondem bem (resistem e/ou acertam super efetivo). */
  answers: string[];
  /** Membros vulneráveis a ela. */
  victims: string[];
  reasonPt: string;
}

export interface TeamIssue {
  severity: 'info' | 'warn' | 'error';
  messagePt: string;
  slot?: number;
}

export interface TeamAnalysis {
  defensive: TypeMatchupRow[];
  offensive: CoverageRow[];
  roles: RoleCoverage[];
  missingRoles: RoleDef[];
  archetypes: { def: ArchetypeDef; confidence: number; via: string[] }[];
  speedTiers: SpeedEntry[];
  threats: ThreatEntry[];
  issues: TeamIssue[];
  /** Nota geral 0-100 e resumo textual. */
  score: number;
  summaryPt: string[];
}

/* --------------------------- Sugestões ---------------------------- */

export interface ScoreComponent {
  key: keyof SuggestionWeights;
  labelPt: string;
  /** Valor normalizado 0-1 antes do peso. */
  value: number;
  weight: number;
}

export interface PokemonSuggestion {
  species: string;
  score: number;
  components: ScoreComponent[];
  reasonsPt: string[];
  meta?: MetaPokemon;
  /** Set recomendado para esta equipe. */
  set: PokemonSet;
}

export interface MoveSuggestion {
  move: string;
  score: number;
  /** Fração de uso deste golpe nessa espécie no meta. */
  usage: number;
  reasonsPt: string[];
  tags: string[];
}

export interface MoveSetSuggestion {
  /** Golpes recomendados para a equipe atual. */
  recommended: string[];
  /** Golpes mais usados no meta. */
  mostUsed: string[];
  ranked: MoveSuggestion[];
  /** Explicação das diferenças entre recomendado e mais usado. */
  diffPt: string[];
}

export interface ItemSuggestion {
  item: string;
  score: number;
  usage: number;
  reasonsPt: string[];
  /** Já usado por outro membro (Item Clause). */
  blocked: boolean;
}

export interface AbilitySuggestion {
  ability: string;
  score: number;
  usage: number;
  reasonsPt: string[];
}

export interface SpreadSuggestion {
  id: string;
  labelPt: string;
  nature: string;
  sp: StatsTable;
  stats: StatsTable;
  usage?: number;
  reasonsPt: string[];
}

export interface EngineApi {
  analyzeTeam(ctx: EngineContext, team: Team): TeamAnalysis;
  suggestPokemon(ctx: EngineContext, team: Team, limit?: number): PokemonSuggestion[];
  suggestMoves(ctx: EngineContext, team: Team, slot: number): MoveSetSuggestion;
  suggestItems(ctx: EngineContext, team: Team, slot: number): ItemSuggestion[];
  suggestAbilities(ctx: EngineContext, team: Team, slot: number): AbilitySuggestion[];
  suggestSpreads(ctx: EngineContext, team: Team, slot: number): SpreadSuggestion[];
  /** Monta um set completo (golpes, item, habilidade, natureza, SP) para uma espécie na equipe. */
  buildSet(ctx: EngineContext, team: Team, species: string): PokemonSet;
  /** Completa a equipe até 6 membros com as melhores sugestões. */
  autoComplete(ctx: EngineContext, team: Team): Team;
}
