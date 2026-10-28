/**
 * Resolução de membros da equipe (forma em batalha, habilidade efetiva, golpes,
 * atributos) e sets prováveis das ameaças do meta. Base para análise e sugestões.
 */
import type { EngineContext } from './api.ts';
import { toId } from './id.ts';
import { calcStat, calcStats, emptySP } from './stats.ts';
import { attackEffectiveness } from './typechart.ts';
import { memo } from './util.ts';
import type { ItemData, MetaPokemon, MoveData, NatureData, PokemonSet, SpeciesData, StatsTable, TypeName } from './types.ts';

export type Weather = 'Sun' | 'Rain' | 'Sand' | 'Snow';
export type Terrain = 'Electric' | 'Grassy' | 'Psychic' | 'Misty';

export interface FieldState {
  weather?: Weather;
  terrain?: Terrain;
}

export interface Member {
  slot: number;
  set: PokemonSet;
  /** Forma escolhida no team builder. */
  species?: SpeciesData;
  /** Forma em batalha (Mega, se segura a Mega Stone correta). */
  form?: SpeciesData;
  name: string;
  formName: string;
  types: TypeName[];
  /** id da habilidade ativa em batalha. */
  ability: string;
  abilityName: string;
  item?: ItemData;
  itemId: string;
  isMega: boolean;
  /** Golpes do set; se o set não tem golpes, os mais usados no meta. */
  moves: MoveData[];
  moveIds: Set<string>;
  assumedMoves: boolean;
  nature?: NatureData;
  stats: StatsTable;
  meta?: MetaPokemon;
}

const ATE_ABILITIES: Record<string, TypeName> = {
  aerilate: 'Flying', pixilate: 'Fairy', refrigerate: 'Ice', galvanize: 'Electric', dragonize: 'Dragon',
};
const WEATHER_BALL: Record<Weather, TypeName> = { Sun: 'Fire', Rain: 'Water', Sand: 'Rock', Snow: 'Ice' };
export const TERRAIN_TYPE: Record<Terrain, TypeName> = { Electric: 'Electric', Grassy: 'Grass', Psychic: 'Psychic', Misty: 'Fairy' };
/** Clima ativado pela habilidade ao entrar (Drought, Drizzle...). */
export const ABILITY_WEATHER: Record<string, Weather> = { drought: 'Sun', drizzle: 'Rain', sandstream: 'Sand', snowwarning: 'Snow' };
/** Terreno ativado pela habilidade ao entrar (Psychic Surge...). */
export const ABILITY_TERRAIN: Record<string, Terrain> = {
  psychicsurge: 'Psychic', grassysurge: 'Grassy', electricsurge: 'Electric', mistysurge: 'Misty', seedsower: 'Grassy',
};

/** Campo que o próprio Pokémon cria com a habilidade (para tipar Weather Ball/Terrain Pulse dele). */
export function ownField(ability: string): FieldState {
  return { weather: ABILITY_WEATHER[ability], terrain: ABILITY_TERRAIN[ability] };
}

/** Golpes de dano fixo/condicional que não contam para cobertura de tipos. */
export const NON_COVERAGE = new Set(['seismictoss', 'nightshade', 'superfang', 'endeavor', 'finalgambit', 'counter', 'mirrorcoat', 'metalburst', 'fling', 'spitup', 'beatup', 'comeuppance']);

export const PROTECT_MOVES = new Set(['protect', 'detect', 'spikyshield', 'banefulbunker', 'kingsshield']);

export const isDamaging = (move: MoveData | undefined): boolean => !!move && move.category !== 'Status';

export function natureOf(ctx: EngineContext, name: string | undefined | null): NatureData | undefined {
  if (!name) return undefined;
  return ctx.dex.data.natures[toId(name)] ?? Object.values(ctx.dex.data.natures).find(n => toId(n.name) === toId(name));
}

export function metaOf(ctx: EngineContext, species: SpeciesData | undefined): MetaPokemon | undefined {
  if (!species) return undefined;
  return ctx.meta.pokemon?.[species.id];
}

export function hasMetaData(ctx: EngineContext): boolean {
  return memo(ctx, 'hasMeta', () => Object.keys(ctx.meta.pokemon ?? {}).length > 0);
}

/** Habilidade mais provável quando o set não informa: a mais usada no meta ou a de maior rating. */
export function defaultAbility(ctx: EngineContext, species: SpeciesData): string {
  const top = metaOf(ctx, species)?.abilities?.[0]?.name;
  if (top && Object.values(species.abilities).some(a => toId(a) === toId(top))) return top;
  const options = ctx.dex.abilitiesOf(species);
  if (!options.length) return species.abilities['0'] ?? '';
  return options.reduce((a, b) => ((b.rating ?? 0) > (a.rating ?? 0) ? b : a)).name;
}

/** Mega Stones legais da espécie com as formas resultantes. */
export function megaOptions(ctx: EngineContext, species: SpeciesData | undefined): { item: ItemData; form: SpeciesData }[] {
  if (!species?.megas?.length) return [];
  const out: { item: ItemData; form: SpeciesData }[] = [];
  for (const m of species.megas) {
    const item = ctx.dex.item(m.item);
    const form = ctx.dex.species(m.id);
    if (item && form && item.legal[ctx.dex.regulation] && form.legal[ctx.dex.regulation]) out.push({ item, form });
  }
  return out;
}

export const isMegaStone = (item: ItemData | undefined): boolean => !!item?.megaStone;

/**
 * Fração dos sets do meta desta espécie que usam a mesma forma em batalha do
 * set (Mega X × Mega Y × sem Mega), pelo uso das Mega Stones. Golpes e spreads
 * do meta só valem para a forma que de fato aparece (ex.: o meta do Charizard é
 * quase todo Mega Y; um Charizard-Mega-X não deve herdar Heat Wave/Timid).
 */
export function metaFormShare(ctx: EngineContext, species: SpeciesData, item: ItemData | undefined, meta: MetaPokemon): number {
  const stones = megaOptions(ctx, species).map(o => o.item.id);
  const items = meta.items ?? [];
  if (!stones.length || !items.length) return 1;
  const total = items.reduce((sum, i) => sum + (i.share > 0 ? i.share : 0), 0);
  if (total <= 0) return 1;
  const share = (id: string) => Math.max(0, items.find(i => i.id === id)?.share ?? 0);
  if (item && stones.includes(item.id)) return share(item.id) / total;
  return Math.max(0, total - stones.reduce((sum, id) => sum + share(id), 0)) / total;
}

/** Forma do set é comum o bastante no meta para herdar golpes e spreads de lá. */
export const META_FORM_MIN = 0.25;

export function resolveMember(ctx: EngineContext, set: PokemonSet, slot: number): Member {
  const species = ctx.dex.species(set.species);
  const form = species ? ctx.dex.battleForm(set) ?? species : undefined;
  const item = ctx.dex.item(set.item);
  const isMega = !!form?.isMega;
  const abilitySource = isMega ? form!.abilities['0'] : set.ability || (species ? defaultAbility(ctx, species) : '');
  const ability = toId(abilitySource);
  const meta = metaOf(ctx, species);
  let moves = (set.moves ?? []).map(m => ctx.dex.move(m)).filter((m): m is MoveData => !!m);
  let assumedMoves = false;
  const sameForm = !!species && !!meta && metaFormShare(ctx, species, item, meta) >= META_FORM_MIN;
  if (!moves.length && species && !(set.moves ?? []).some(Boolean) && meta?.moves?.length && sameForm) {
    moves = meta.moves
      .filter(m => ctx.dex.canLearn(species, m.id))
      .slice(0, 4)
      .map(m => ctx.dex.move(m.id))
      .filter((m): m is MoveData => !!m);
    assumedMoves = moves.length > 0;
  }
  const nature = natureOf(ctx, set.nature);
  return {
    slot,
    set,
    species,
    form,
    name: species?.name ?? set.species,
    formName: form?.name ?? set.species,
    types: form?.types ?? [],
    ability,
    abilityName: ctx.dex.ability(ability)?.name ?? abilitySource ?? '',
    item,
    itemId: toId(set.item),
    isMega,
    moves,
    moveIds: new Set(moves.map(m => m.id)),
    assumedMoves,
    nature,
    stats: form ? calcStats(form, { ...emptySP(), ...(set.sp ?? {}) }, nature) : emptySP(),
    meta,
  };
}

export function resolveTeam(ctx: EngineContext, team: PokemonSet[]): Member[] {
  return team.map((set, i) => resolveMember(ctx, set, i));
}

/** Tipo efetivo do golpe (habilidades -ate, Weather Ball, Terrain Pulse, Liquid Voice). */
export function moveTypeFor(move: MoveData, ability: string, field: FieldState = {}): { type: TypeName; mult: number } {
  if (move.id === 'weatherball') {
    const weather = ability === 'megasol' ? 'Sun' : field.weather;
    if (weather) return { type: WEATHER_BALL[weather], mult: 2 };
  }
  if (move.id === 'terrainpulse' && field.terrain) return { type: TERRAIN_TYPE[field.terrain], mult: 2 };
  if (move.type === 'Normal' && ATE_ABILITIES[ability]) return { type: ATE_ABILITIES[ability], mult: 1.2 };
  if (ability === 'liquidvoice' && move.flags.includes('sound')) return { type: 'Water', mult: 1 };
  return { type: move.type, mult: 1 };
}

export function stabTypes(member: Pick<Member, 'types'>): TypeName[] {
  return [...member.types];
}

/** Tipos de ataque do membro: golpes de dano; sem golpes, os tipos STAB. */
export function attackTypesOf(member: Member, field: FieldState = {}): TypeName[] {
  const out = new Set<TypeName>();
  for (const m of member.moves) {
    if (!isDamaging(m) || NON_COVERAGE.has(m.id)) continue;
    out.add(moveTypeFor(m, member.ability, field).type);
  }
  if (!out.size && !member.moves.length) for (const t of member.types) out.add(t);
  return [...out];
}

/** Multiplicador defensivo do membro contra um tipo (habilidade e Air Balloon incluídos). */
export function defenseMult(ctx: EngineContext, member: Member, type: TypeName, attackerAbility?: string): number {
  if (!member.form) return 1;
  let mult = attackEffectiveness(ctx.dex.data.typechart, type, member.types, member.ability, attackerAbility);
  if (type === 'Ground' && member.itemId === 'airballoon') mult = 0;
  return mult;
}

/** Spread padrão quando não há dados: ofensivo rápido ou PS + ataque para lentos. */
export function defaultSpread(form: SpeciesData): { nature: string; sp: StatsTable } {
  const phys = form.baseStats.atk >= form.baseStats.spa;
  const sp = emptySP();
  if (form.baseStats.spe >= 70) {
    sp.spe = 32;
    sp[phys ? 'atk' : 'spa'] = 32;
    sp.hp = 2;
    return { nature: phys ? 'Jolly' : 'Timid', sp };
  }
  sp.hp = 32;
  sp[phys ? 'atk' : 'spa'] = 32;
  sp.def = 1;
  sp.spd = 1;
  return { nature: phys ? 'Adamant' : 'Modest', sp };
}

/** Velocidade máxima (32 SP + natureza +Spe). */
export function maxSpeed(form: SpeciesData): number {
  return calcStat(form.baseStats.spe, 32, 'spe', { name: 'Jolly', plus: 'spe', minus: 'spa' });
}

/** Set provável de um Pokémon do meta (item, habilidade, spread e golpes mais usados). */
export function likelySet(ctx: EngineContext, mp: MetaPokemon): PokemonSet {
  return memo(ctx, `likely:${mp.id}`, () => {
    const species = ctx.dex.species(mp.id);
    const item = mp.items?.find(i => ctx.dex.item(i.id)?.legal[ctx.dex.regulation])?.name;
    const set: PokemonSet = { species: species?.name ?? mp.name, item, sp: emptySP(), moves: [] };
    if (species) {
      const top = mp.abilities?.find(a => Object.values(species.abilities).some(x => toId(x) === a.id))?.name;
      set.ability = top ?? defaultAbility(ctx, species);
      set.moves = (mp.moves ?? []).filter(m => ctx.dex.canLearn(species, m.id)).slice(0, 4).map(m => m.name);
      const spread = mp.spreads?.[0];
      if (spread) {
        set.nature = spread.nature;
        set.sp = { ...emptySP(), ...spread.sp };
      } else {
        const form = ctx.dex.battleForm(set) ?? species;
        const def = defaultSpread(form);
        set.nature = def.nature;
        set.sp = def.sp;
      }
    }
    return set;
  });
}

export interface ThreatProfile {
  meta: MetaPokemon;
  set: PokemonSet;
  member: Member;
  /** Tipos de ataque prováveis: STAB + golpes comuns (≥ 20% de uso). */
  attackTypes: TypeName[];
  speed: number;
  hasSpreadData: boolean;
  scarf: boolean;
}

/** Ameaças do meta ordenadas por uso, com set provável resolvido. */
export function metaThreats(ctx: EngineContext, limit = 30): ThreatProfile[] {
  return memo(ctx, `threats:${limit}`, () => {
    const list = Object.values(ctx.meta.pokemon ?? {})
      .filter(mp => {
        const s = ctx.dex.species(mp.id);
        return s && ctx.dex.isLegal(s) && mp.usage > 0;
      })
      .sort((a, b) => b.usage - a.usage)
      .slice(0, limit);
    return list.map(mp => {
      const set = likelySet(ctx, mp);
      const member = resolveMember(ctx, set, -1);
      const types = new Set<TypeName>(member.types);
      // Weather Ball de quem tem Drought (ex.: Charizard-Mega-Y) é de Fogo, não Normal.
      const field = ownField(member.ability);
      for (const share of mp.moves ?? []) {
        const move = ctx.dex.move(share.id);
        if (share.share >= 0.2 && isDamaging(move) && !NON_COVERAGE.has(move!.id) && (move!.basePower >= 50 || move!.basePower === 0)) {
          types.add(moveTypeFor(move!, member.ability, field).type);
        }
      }
      const scarf = member.itemId === 'choicescarf';
      return {
        meta: mp,
        set,
        member,
        attackTypes: [...types],
        speed: scarf ? Math.floor(member.stats.spe * 1.5) : member.stats.spe,
        hasSpreadData: !!mp.spreads?.length,
        scarf,
      };
    });
  });
}

/** Atributo de ataque relevante (com Huge Power/Pure Power). */
export function attackStat(member: Pick<Member, 'stats' | 'ability'>, category: 'Physical' | 'Special'): number {
  if (category === 'Special') return member.stats.spa;
  const doubled = member.ability === 'hugepower' || member.ability === 'purepower';
  return doubled ? member.stats.atk * 2 : member.stats.atk;
}

/** Maior atributo ofensivo base (para heurísticas de papel). */
export function baseAttack(species: SpeciesData, ability?: string): number {
  const atk = ability === 'hugepower' || ability === 'purepower' ? species.baseStats.atk * 2 : species.baseStats.atk;
  return Math.max(atk, species.baseStats.spa);
}

export function baseBulk(species: SpeciesData): number {
  return species.baseStats.hp + (species.baseStats.def + species.baseStats.spd) / 2;
}

/** Efetividade de um golpe específico (Freeze-Dry, Flying Press, tipo resolvido por habilidade/clima). */
export function moveEffectiveness(
  ctx: EngineContext,
  move: MoveData,
  attackerAbility: string,
  defenderTypes: readonly TypeName[],
  defenderAbility?: string,
  field: FieldState = {},
): number {
  const chart = ctx.dex.data.typechart;
  const { type } = moveTypeFor(move, attackerAbility, field);
  let mult = attackEffectiveness(chart, type, defenderTypes, defenderAbility, attackerAbility);
  if (move.id === 'freezedry' && defenderTypes.includes('Water')) mult *= 2 / (chart.Water?.Ice || 0.5);
  if (move.id === 'flyingpress') mult *= attackEffectiveness(chart, 'Flying', defenderTypes, undefined, attackerAbility);
  return mult;
}

/** Melhor multiplicador do membro contra um defensor (golpes de dano; sem golpes, STAB). */
export function bestHit(
  ctx: EngineContext,
  member: Member,
  defenderTypes: readonly TypeName[],
  defenderAbility?: string,
  field: FieldState = {},
): number {
  let best = 0;
  let any = false;
  for (const m of member.moves) {
    if (!isDamaging(m) || NON_COVERAGE.has(m.id)) continue;
    any = true;
    best = Math.max(best, moveEffectiveness(ctx, m, member.ability, defenderTypes, defenderAbility, field));
  }
  if (!any && !member.moves.length) {
    for (const t of member.types) best = Math.max(best, attackEffectiveness(ctx.dex.data.typechart, t, defenderTypes, defenderAbility, member.ability));
  }
  return best;
}
