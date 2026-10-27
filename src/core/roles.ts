/**
 * Detecção de papéis de VGC (heuristics.json): para um set concreto (golpes,
 * habilidade em batalha e item) e para o potencial de uma espécie (learnset e
 * habilidades, ponderados pelo uso no meta quando houver dados).
 */
import type { EngineContext, RoleDef } from './api.ts';
import { toId } from './id.ts';
import { baseAttack, baseBulk, defaultAbility, isDamaging, megaOptions, metaOf, resolveMember, type Member } from './team.ts';
import { memo } from './util.ts';
import type { MoveData, PokemonSet, SpeciesData, TypeName } from './types.ts';

export interface RoleHit {
  role: RoleDef;
  /** Golpes/habilidades/itens que cumprem o papel. */
  via: string[];
  /** 0-1: qualidade do melhor recurso (ponderada pelo uso no meta, no potencial). */
  strength: number;
}
export type RoleMap = Map<string, RoleHit>;

export interface RoleIndexEntry {
  role: RoleDef;
  quality: number;
}

interface RoleIndex {
  byId: Map<string, RoleDef>;
  moves: Map<string, RoleIndexEntry[]>;
  abilities: Map<string, RoleIndexEntry[]>;
  items: Map<string, RoleIndexEntry[]>;
}

const NOT_PRIORITY = new Set(['fakeout', 'feint']);

function roleIndex(ctx: EngineContext): RoleIndex {
  return memo(ctx, 'roleIndex', () => {
    const idx: RoleIndex = { byId: new Map(), moves: new Map(), abilities: new Map(), items: new Map() };
    const push = (map: Map<string, RoleIndexEntry[]>, id: string, role: RoleDef) => {
      const key = toId(id);
      const quality = role.quality?.[key] ?? 1;
      const list = map.get(key) ?? [];
      if (!list.some(e => e.role.id === role.id)) list.push({ role, quality });
      map.set(key, list);
    };
    for (const role of ctx.heuristics.roles ?? []) {
      idx.byId.set(role.id, role);
      role.moves.forEach(m => push(idx.moves, m, role));
      role.abilities.forEach(a => push(idx.abilities, a, role));
      role.items.forEach(i => push(idx.items, i, role));
    }
    return idx;
  });
}

export function roleById(ctx: EngineContext, id: string): RoleDef | undefined {
  return roleIndex(ctx).byId.get(id);
}

export function allRoles(ctx: EngineContext): RoleDef[] {
  return [...roleIndex(ctx).byId.values()];
}

/** Papéis de um golpe (lista curada + detecção automática de área e prioridade). */
export function rolesOfMove(ctx: EngineContext, move: MoveData): RoleIndexEntry[] {
  return memo(ctx, `moveRoles:${move.id}`, () => {
    const idx = roleIndex(ctx);
    const out = [...(idx.moves.get(move.id) ?? [])];
    const has = (id: string) => out.some(e => e.role.id === id);
    const spread = idx.byId.get('spread');
    const isSpread = !!move.effects?.isSpread || move.target === 'allAdjacentFoes' || move.target === 'allAdjacent';
    if (spread && !has('spread') && isDamaging(move) && isSpread) out.push({ role: spread, quality: move.basePower >= 60 ? 0.9 : 0.4 });
    const priority = idx.byId.get('priority');
    if (priority && !has('priority') && isDamaging(move) && move.priority > 0 && !NOT_PRIORITY.has(move.id)) out.push({ role: priority, quality: 0.5 });
    return out;
  });
}

export function rolesOfAbility(ctx: EngineContext, ability: string | undefined): RoleIndexEntry[] {
  return roleIndex(ctx).abilities.get(toId(ability)) ?? [];
}

export function rolesOfItem(ctx: EngineContext, item: string | undefined): RoleIndexEntry[] {
  return roleIndex(ctx).items.get(toId(item)) ?? [];
}

/* ------------------------------ traços ------------------------------ */

export interface TraitSubject {
  species: SpeciesData;
  types: readonly TypeName[];
  ability?: string;
  /** Golpes do set (ou potenciais). */
  moves: { has(id: string): boolean };
}

/** Avalia um traço ("type:Fire&attack>=90", "basespe<=60", "move:weatherball"). Sem o prefixo "!". */
export function matchTrait(trait: string, subj: TraitSubject): boolean {
  const clean = trait.replace(/^!/, '');
  if (!clean) return false;
  return clean.split('&').every(part => {
    const p = part.trim();
    const colon = p.indexOf(':');
    if (colon > 0) {
      const key = p.slice(0, colon);
      const value = p.slice(colon + 1);
      if (key === 'type') return subj.types.includes(value as TypeName);
      if (key === 'move') return subj.moves.has(toId(value));
      if (key === 'ability') return toId(subj.ability) === toId(value);
      return false;
    }
    const m = /^([a-z]+)\s*(<=|>=|<|>|=)\s*(\d+(?:\.\d+)?)$/.exec(p);
    if (!m) return false;
    const b = subj.species.baseStats;
    const stats: Record<string, number> = {
      basespe: b.spe, hp: b.hp, atk: b.atk, def: b.def, spa: b.spa, spd: b.spd,
      attack: baseAttack(subj.species, toId(subj.ability)), bulk: baseBulk(subj.species),
    };
    const v = stats[m[1]];
    if (v === undefined) return false;
    const n = Number(m[3]);
    switch (m[2]) {
      case '<=': return v <= n;
      case '>=': return v >= n;
      case '<': return v < n;
      case '>': return v > n;
      default: return v === n;
    }
  });
}

/* ------------------------------ papéis ------------------------------ */

function add(map: RoleMap, role: RoleDef, via: string, strength: number) {
  const cur = map.get(role.id);
  if (cur) {
    if (!cur.via.includes(via)) cur.via.push(via);
    cur.strength = Math.max(cur.strength, strength);
  } else {
    map.set(role.id, { role, via: [via], strength });
  }
}

/** Papéis cumpridos por um membro já resolvido. */
export function memberRoles(ctx: EngineContext, member: Member): RoleMap {
  const out: RoleMap = new Map();
  if (!member.form) return out;
  for (const move of member.moves) for (const e of rolesOfMove(ctx, move)) add(out, e.role, move.name, e.quality);
  if (member.ability) for (const e of rolesOfAbility(ctx, member.ability)) add(out, e.role, member.abilityName, e.quality);
  if (member.item) for (const e of rolesOfItem(ctx, member.itemId)) add(out, e.role, member.item.name, e.quality);
  const subj: TraitSubject = { species: member.form, types: member.types, ability: member.ability, moves: member.moveIds };
  for (const role of allRoles(ctx)) {
    if (role.traits?.some(t => !t.startsWith('!') && matchTrait(t, subj))) add(out, role, 'perfil', 0.8);
  }
  return out;
}

/** Papéis de um set (golpes + habilidade em batalha + item). */
export function setRoles(ctx: EngineContext, set: PokemonSet): RoleMap {
  return memberRoles(ctx, resolveMember(ctx, set, 0));
}

/** Viabilidade de um recurso pelo uso no meta (sem dados: valor neutro). */
function viability(share: number | undefined, hasData: boolean, neutral: number): number {
  if (!hasData) return neutral;
  if (!share || share < 0.03) return 0.15;
  return 0.4 + 0.6 * Math.min(1, share / 0.5);
}

/**
 * Potencial da espécie: papéis que ela pode cumprir pelo learnset e habilidades
 * (inclui as Megas). Com dados de meta, pondera pelo uso real de cada golpe.
 */
export function speciesPotential(ctx: EngineContext, species: SpeciesData): RoleMap {
  return memo(ctx, `potential:${species.id}`, () => {
    const out: RoleMap = new Map();
    const meta = metaOf(ctx, species);
    const moveShare = new Map((meta?.moves ?? []).map(m => [m.id, m.share]));
    const abilityShare = new Map((meta?.abilities ?? []).map(a => [a.id, a.share]));
    const hasMoves = moveShare.size > 0;
    const hasAbilities = abilityShare.size > 0;
    for (const move of ctx.dex.learnset(species)) {
      const entries = rolesOfMove(ctx, move);
      if (!entries.length) continue;
      const v = viability(moveShare.get(move.id), hasMoves, 0.6);
      for (const e of entries) add(out, e.role, move.name, e.quality * v);
    }
    for (const a of ctx.dex.abilitiesOf(species)) {
      const v = viability(abilityShare.get(a.id), hasAbilities, 0.8);
      for (const e of rolesOfAbility(ctx, a.id)) add(out, e.role, a.name, e.quality * v);
    }
    for (const { form } of megaOptions(ctx, species)) {
      const ab = ctx.dex.ability(form.abilities['0']);
      if (!ab) continue;
      for (const e of rolesOfAbility(ctx, ab.id)) add(out, e.role, `${ab.name} (${form.name})`, e.quality * 0.7);
    }
    const subj: TraitSubject = { species, types: species.types, ability: toId(defaultAbility(ctx, species)), moves: new Set(species.learnset) };
    for (const role of allRoles(ctx)) {
      if (role.traits?.some(t => !t.startsWith('!') && matchTrait(t, subj))) add(out, role, 'perfil', 0.8);
    }
    return out;
  });
}

/** Força (0-1) do potencial de uma espécie num papel. */
export function potentialStrength(ctx: EngineContext, species: SpeciesData, roleId: string): number {
  return speciesPotential(ctx, species).get(roleId)?.strength ?? 0;
}
