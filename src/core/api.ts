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
  /** Qualidade (0-1) de cada golpe/habilidade/item neste papel (padrão 1). */
  quality?: Record<string, number>;
  /** Traços de espécie que também cumprem o papel (ex.: "basespe<=60&attack>=100"). */
  traits?: string[];
  /** "member": avaliado em cada membro (ex.: Protect) e não entra em papéis faltando. */
  scope?: 'team' | 'member';
}

export interface ArchetypeDef {
  id: string;
  namePt: string;
  setters: { moves: string[]; abilities: string[] };
  abusers: { abilities: string[]; traits: string[] };
  speedProfile: 'fast' | 'slow' | 'mixed';
  antiSynergyMoves: string[];
  description: string;
  /** Além do setter, exige pelo menos um destes (ex.: Perish Trap precisa de quem prenda). */
  requires?: { moves: string[]; abilities: string[] };
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

/*
 * Convenção: espécies, golpes, itens, habilidades e naturezas nas sugestões
 * usam o NOME de exibição (como no paste do Showdown: "Rotom-Wash", "Fake Out",
 * "Sitrus Berry"); use toId() para comparar.
 */

export interface PokemonSuggestion {
  species: string;
  score: number;
  components: ScoreComponent[];
  reasonsPt: string[];
  meta?: MetaPokemon;
  /** Forma em que o candidato foi avaliado (Mega ou comum). */
  form?: { name: string; mega: boolean };
  /** Set recomendado para esta equipe. */
  set: PokemonSet;
}

/** Pokémon que seria sugerido como Mega se uma das 2 vagas de Mega fosse liberada. */
export interface MegaAlternative {
  species: string;
  megaItem: string;
  megaForm: string;
  score: number;
  /** Nota do mesmo Pokémon sem Mega (como aparece nas sugestões normais). */
  scoreWithoutMega: number | null;
  /** Megas atuais da equipe que poderiam ceder a vaga. */
  replaces: string[];
  reasonsPt: string[];
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

/* ------------------------------ Dano ------------------------------- */

export interface DamageFieldOptions {
  weather?: 'Sun' | 'Rain' | 'Sand' | 'Snow';
  terrain?: 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
  helpingHand?: boolean;
  reflect?: boolean;
  lightScreen?: boolean;
  auroraVeil?: boolean;
  friendGuard?: boolean;
  /** Estágios de boost do atacante/defensor (ex.: Intimidate = { atk: -1 }). */
  attackerBoosts?: Partial<StatsTable>;
  defenderBoosts?: Partial<StatsTable>;
}

export interface DamageResult {
  attacker: string;
  defender: string;
  move: string;
  /** Dano em PS e em % do PS máximo do defensor. */
  min: number;
  max: number;
  minPct: number;
  maxPct: number;
  /** Chance de KO em `koHits` golpes (0-1); koHits = 0 quando não há KO em até 4 golpes. */
  koChance: number;
  koHits: number;
  koTextPt: string;
  /** Descrição completa do @smogon/calc (em inglês). */
  desc: string;
}

export interface MatchupEntry {
  slot: number;
  species: string;
  threat: string;
  threatUsage: number;
  /** Melhor golpe do membro contra a ameaça. */
  offense: DamageResult | null;
  /** Melhor golpe da ameaça (set comum do meta) contra o membro. */
  defense: DamageResult | null;
  /** O membro age antes da ameaça (sem modificadores de campo). */
  outspeeds: boolean | null;
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
