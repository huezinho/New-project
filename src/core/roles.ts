/**
 * Detecção de papéis de VGC (heuristics.json): para um set concreto (golpes,
 * habilidade em batalha e item) e para o potencial de uma espécie (learnset e
 * habilidades, ponderados pelo uso no meta quando houver dados).
 */
import type { EngineContext, RoleDef } from './api.ts';
import { toId } from './id.ts';
import { baseAttack, baseBulk, defaultAbility, isDamaging, megaOptions, metaOf, resolveMember, type Member } from './team.ts';
import { lowerFirst, memo } from './util.ts';
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

type TraitPart =
  | { kind: 'type' | 'move' | 'ability'; value: string }
  | { kind: 'stat'; stat: string; op: string; n: number }
  | { kind: 'never' };

// Traços vêm do heuristics.json (conjunto pequeno): compilados uma vez.
const compiled = new Map<string, TraitPart[]>();

function compileTrait(clean: string): TraitPart[] {
  let parts = compiled.get(clean);
  if (parts) return parts;
  parts = clean.split('&').map((part): TraitPart => {
    const p = part.trim();
    const colon = p.indexOf(':');
    if (colon > 0) {
      const key = p.slice(0, colon);
      const value = p.slice(colon + 1);
      if (key === 'type') return { kind: 'type', value };
      if (key === 'move' || key === 'ability') return { kind: key, value: toId(value) };
      return { kind: 'never' };
    }
    const m = /^([a-z]+)\s*(<=|>=|<|>|=)\s*(\d+(?:\.\d+)?)$/.exec(p);
    return m ? { kind: 'stat', stat: m[1], op: m[2], n: Number(m[3]) } : { kind: 'never' };
  });
  compiled.set(clean, parts);
  return parts;
}

function statOf(subj: TraitSubject, stat: string): number | undefined {
  const b = subj.species.baseStats;
  switch (stat) {
    case 'basespe': return b.spe;
    case 'hp': return b.hp;
    case 'atk': return b.atk;
    case 'def': return b.def;
    case 'spa': return b.spa;
    case 'spd': return b.spd;
    case 'attack': return baseAttack(subj.species, toId(subj.ability));
    case 'bulk': return baseBulk(subj.species);
    default: return undefined;
  }
}

/** Avalia um traço ("type:Fire&attack>=90", "basespe<=60", "move:weatherball"). Sem o prefixo "!". */
export function matchTrait(trait: string, subj: TraitSubject): boolean {
  const clean = trait.startsWith('!') ? trait.slice(1) : trait;
  if (!clean) return false;
  return compileTrait(clean).every(p => {
    switch (p.kind) {
      case 'type': return subj.types.includes(p.value as TypeName);
      case 'move': return subj.moves.has(p.value);
      case 'ability': return toId(subj.ability) === p.value;
      case 'never': return false;
      default: {
        const v = statOf(subj, p.stat);
        if (v === undefined) return false;
        switch (p.op) {
          case '<=': return v <= p.n;
          case '>=': return v >= p.n;
          case '<': return v < p.n;
          case '>': return v > p.n;
          default: return v === p.n;
        }
      }
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
 * `withMega = false` ignora as habilidades das Megas (avaliação sem Mega Stone).
 */
export function speciesPotential(ctx: EngineContext, species: SpeciesData, withMega = true): RoleMap {
  return memo(ctx, `potential:${species.id}:${withMega ? 1 : 0}`, () => {
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
    for (const { form } of withMega ? megaOptions(ctx, species) : []) {
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

/* ------------------------------ textos ------------------------------ */

const ROLE_PHRASE: Record<string, string> = {
  speedcontrol: 'controle de velocidade',
  fakeout: 'Fake Out',
  intimidate: 'Intimidate ou redução de ataque',
  redirection: 'redirecionamento',
  spread: 'ataques em área',
  disruption: 'disrupção',
  support: 'suporte ao parceiro',
  pivot: 'pivô',
  priority: 'golpes de prioridade',
  teamprotect: 'proteção da dupla',
  screens: 'telas',
  setup: 'setup',
  antiintimidate: 'resposta a Intimidate',
  weather: 'clima',
  terrain: 'terreno',
  trapping: 'quem prenda o oponente',
  trickroomattacker: 'atacante de Trick Room',
  protect: 'Protect',
};

/** Nome do papel para usar no meio de uma frase ("sua equipe não tem ..."). */
export function rolePhrase(role: RoleDef): string {
  return ROLE_PHRASE[role.id] ?? lowerFirst(role.namePt);
}
