/** Tipos de domínio compartilhados entre o app, a CLI e os scripts de dados. */

export type TypeName =
  | 'Normal' | 'Fire' | 'Water' | 'Electric' | 'Grass' | 'Ice' | 'Fighting' | 'Poison' | 'Ground'
  | 'Flying' | 'Psychic' | 'Bug' | 'Rock' | 'Ghost' | 'Dragon' | 'Dark' | 'Steel' | 'Fairy';

export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type StatsTable = Record<StatId, number>;

export interface SpeciesData {
  id: string;
  name: string;
  num: number;
  types: TypeName[];
  baseStats: StatsTable;
  /** Slots de habilidade do Showdown: 0, 1, H (oculta), S (especial). */
  abilities: Partial<Record<'0' | '1' | 'H' | 'S', string>>;
  weightkg: number;
  baseSpecies?: string;
  forme?: string;
  otherFormes?: string[];
  /** Item necessário (ex.: Mega Stone) para esta forma. */
  requiredItem?: string;
  battleOnly?: string | string[];
  isMega?: boolean;
  /** ids das Megas disponíveis para esta espécie (com o item correspondente). */
  megas?: { id: string; item: string }[];
  tags?: string[];
  tier?: string;
  doublesTier?: string;
  /** Legalidade por regulação (ex.: { "M-C": true, "M-B": false }). */
  legal: Record<string, boolean>;
  /** Golpes que pode aprender no Champions (ids). */
  learnset: string[];
  /** Forma idêntica em batalha a outra espécie (só cosmética); fica fora do seletor. */
  duplicateOf?: string;
}

export type MoveCategory = 'Physical' | 'Special' | 'Status';

export interface MoveData {
  id: string;
  name: string;
  type: TypeName;
  category: MoveCategory;
  basePower: number;
  accuracy: number | true;
  /** PP base dos dados (já com o limite de 20 do Champions). */
  pp: number;
  /** PP efetivo em batalha no Champions. */
  ppInGame: number;
  priority: number;
  target: string;
  flags: string[];
  shortDesc: string;
  desc?: string;
  /** Efeitos resumidos usados pelas heurísticas. */
  effects: MoveEffects;
}

export interface MoveEffects {
  secondaryChance?: number;
  status?: string;
  volatileStatus?: string;
  sideCondition?: string;
  weather?: string;
  terrain?: string;
  pseudoWeather?: string;
  boosts?: Partial<Record<string, number>>;
  selfBoosts?: Partial<Record<string, number>>;
  targetBoostsOnHit?: Partial<Record<string, number>>;
  drain?: [number, number];
  recoil?: [number, number];
  heal?: [number, number];
  multihit?: number | [number, number];
  critRatio?: number;
  willCrit?: boolean;
  selfSwitch?: boolean | string;
  forceSwitch?: boolean;
  breaksProtect?: boolean;
  ohko?: boolean;
  isSpread?: boolean;
}

export interface AbilityData {
  id: string;
  name: string;
  shortDesc: string;
  desc?: string;
  rating?: number;
}

export interface ItemData {
  id: string;
  name: string;
  shortDesc: string;
  desc?: string;
  /** Para Mega Stones: espécie base -> forma Mega. */
  megaStone?: Record<string, string>;
  isBerry?: boolean;
  legal: Record<string, boolean>;
}

export interface NatureData {
  name: string;
  plus?: StatId;
  minus?: StatId;
}

export interface FormatInfo {
  id: string;
  name: string;
  /** Código curto da regulação, ex.: "M-C". */
  regulation: string;
  season: number;
  mod: string;
  current: boolean;
  bo3Id?: string;
  ruleset: string[];
  banlist: string[];
}

export interface DataChange {
  kind: 'move' | 'ability' | 'item' | 'species';
  id: string;
  name: string;
  field: string;
  from: unknown;
  to: unknown;
  direction: 'buff' | 'nerf' | 'change';
  notePt: string;
}

export interface Dex {
  version: number;
  generatedAt: string;
  source: { repo: string; ref: string; commit: string | null; mod: string; kind: string };
  statPoints: { total: number; maxPerStat: number; level: number };
  formats: FormatInfo[];
  currentRegulation: string;
  species: Record<string, SpeciesData>;
  moves: Record<string, MoveData>;
  abilities: Record<string, AbilityData>;
  items: Record<string, ItemData>;
  natures: Record<string, NatureData>;
  /** typechart[defensor][ataque] = multiplicador (0, 0.5, 1, 2). */
  typechart: Record<TypeName, Record<TypeName, number>>;
  /** Diferenças automáticas Champions x Scarlet/Violet. */
  changes: DataChange[];
}

/* ----------------------------- Meta / uso ------------------------------ */

export interface Share {
  id: string;
  name: string;
  share: number;
}

export interface SpreadShare {
  nature: string;
  sp: StatsTable;
  share: number;
}

/** Dados do meta de uma forma em batalha (ex.: Salamence-Mega x Salamence sem Mega). */
export interface MetaForm {
  id: string;
  name: string;
  mega: boolean;
  /** Mega Stone da forma (só Megas). */
  item?: string;
  /** Fração dos sets da espécie que usam esta forma (0-1). */
  share: number;
  /** Fração de equipes com a espécie nesta forma. */
  usage: number;
  winRate: number | null;
  rawWinRate?: number | null;
  games: number;
  moves: Share[];
  items: Share[];
  abilities: Share[];
  spreads: SpreadShare[];
  teammates?: (Share & { lift?: number; winRate?: number | null; games?: number })[];
}

export interface MetaPokemon {
  id: string;
  name: string;
  /** Fração ponderada de equipes que usam a espécie (0-1). */
  usage: number;
  rank: number;
  /** Taxa de vitória ajustada (shrinkage bayesiano) e jogos considerados. */
  winRate: number | null;
  games: number;
  /** Taxa de vitória bruta (sem ajuste). */
  rawWinRate?: number | null;
  /** Fração de aparições em top cut de torneios (quando disponível). */
  topCutRate?: number | null;
  moves: Share[];
  items: Share[];
  abilities: Share[];
  spreads: SpreadShare[];
  teammates: (Share & { lift?: number; winRate?: number | null; games?: number })[];
  /** Tendência: uso no período recente vs anterior. */
  trend?: { recent: number; previous: number } | null;
  sources: string[];
  /** Divisão por forma para espécies com Mega (ordenada pela fração de uso). */
  forms?: MetaForm[];
  /** Presente quando o objeto é a visão de uma só forma (ver metaForForm). */
  formId?: string;
  formShare?: number;
}

export interface MetaCore {
  members: string[];
  usage: number;
  winRate: number | null;
  games: number;
}

export interface MetaArchetype {
  id: string;
  name: string;
  namePt: string;
  keyMembers: string[];
  share: number | null;
  description: string;
  regulation?: string;
  winRate?: number | null;
  games?: number | null;
}

export interface TournamentTeamMember {
  species: string;
  item?: string | null;
  ability?: string | null;
  moves: string[];
  nature?: string | null;
  sp?: Partial<StatsTable> | null;
}

export interface TournamentTeam {
  player: string;
  country?: string | null;
  placing: number | null;
  record?: { wins: number; losses: number; ties: number } | null;
  pokemon: TournamentTeamMember[];
}

export interface TournamentEvent {
  id: string;
  name: string;
  date: string;
  regulation: string;
  game: 'Champions' | 'SV' | string;
  tier: 'worlds' | 'international' | 'regional' | 'special' | 'online' | string;
  players: number | null;
  url?: string | null;
  teams: TournamentTeam[];
}

export interface MetaSource {
  id: string;
  kind: 'usage' | 'tournament' | 'replays' | 'seed';
  label: string;
  url?: string;
  period?: string;
  regulation: string;
  samples: number;
  weight: number;
  fetchedAt: string;
}

export interface Meta {
  version: number;
  generatedAt: string;
  regulation: string;
  formatId: string;
  /** Meia-vida (dias) usada no decaimento temporal. */
  halfLifeDays: number;
  sources: MetaSource[];
  pokemon: Record<string, MetaPokemon>;
  cores: MetaCore[];
  archetypes: MetaArchetype[];
  events: TournamentEvent[];
  notes: string[];
}

/* ------------------------------ Equipe -------------------------------- */

export interface PokemonSet {
  species: string;
  item?: string;
  ability?: string;
  nature?: string;
  /** Stat Points (0-32 por atributo, 66 no total). */
  sp: StatsTable;
  moves: string[];
  nickname?: string;
  gender?: 'M' | 'F' | '';
  shiny?: boolean;
  level?: number;
}

export type Team = PokemonSet[];
