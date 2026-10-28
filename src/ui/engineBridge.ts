/**
 * Ponte entre a interface e o motor (src/core/engine.ts). Toda chamada é
 * protegida por try/catch e memorizada por (regulação + pesos + equipe),
 * para que a UI continue funcionando mesmo se o motor falhar.
 */
import type {
  AbilitySuggestion, EngineContext, ItemSuggestion, MegaAlternative, MoveSetSuggestion, PokemonSuggestion, SpreadSuggestion,
  SuggestionWeights, TeamAnalysis,
} from '../core/api.ts';
import { DexAccess } from '../core/dex.ts';
import {
  analyzeTeam, autoComplete, buildSet, createEngineContext, suggestAbilities, suggestItems, suggestMegaAlternatives, suggestMoves,
  suggestPokemon, suggestSpreads,
} from '../core/engine.ts';
import { toId } from '../core/id.ts';
import { emptySP } from '../core/stats.ts';
import type { PokemonSet, Team } from '../core/types.ts';
import type { AppData } from './data.ts';
import { normalizeSet, sanitizeSet, sanitizeSP, sanitizeTeam } from './util.ts';

export type Safe<T> = { ok: true; value: T } | { ok: false; error: string };

const warned = new Set<string>();

export function safe<T>(label: string, fn: () => T): Safe<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!warned.has(label + msg)) {
      warned.add(label + msg);
      console.warn(`[motor] ${label}: ${msg}`);
    }
    return { ok: false, error: msg };
  }
}

/* Cache LRU simples: guarda resultados (inclusive falhas) por chave. */
const cache = new Map<string, Safe<unknown>>();
const CACHE_MAX = 120;

function cached<T>(key: string, label: string, fn: () => T): Safe<T> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit as Safe<T>;
  }
  const res = safe(label, fn);
  cache.set(key, res);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return res;
}

export interface Bridge {
  ctx: EngineContext;
  dex: DexAccess;
  data: AppData;
  /** Identifica regulação + pesos (parte da chave do cache). */
  key: string;
}

export function makeBridge(data: AppData, regulation: string, weights: SuggestionWeights): Bridge {
  const res = safe('createEngineContext', () => createEngineContext(data.dex, data.meta, data.heuristics, weights, regulation));
  const ctx: EngineContext = res.ok ? res.value : { dex: new DexAccess(data.dex, regulation), meta: data.meta, heuristics: data.heuristics, weights };
  return { ctx, dex: ctx.dex, data, key: `${regulation}|${JSON.stringify(weights)}` };
}

export const teamKeyOf = (team: Team) => JSON.stringify(team);

export function runAnalysis(b: Bridge, team: Team, teamKey: string): Safe<TeamAnalysis> {
  return cached(`a|${b.key}|${teamKey}`, 'analyzeTeam', () => analyzeTeam(b.ctx, team));
}

export function runPokemon(b: Bridge, team: Team, teamKey: string, limit = 12): Safe<PokemonSuggestion[]> {
  return cached(`p|${b.key}|${limit}|${teamKey}`, 'suggestPokemon', () => {
    const out = suggestPokemon(b.ctx, team, limit);
    if (!Array.isArray(out)) throw new Error('resposta inválida');
    return out;
  });
}

/** Com 2 Megas na equipe: quem seria sugerido como Mega se uma vaga fosse liberada. */
export function runMegaAlternatives(b: Bridge, team: Team, teamKey: string, limit = 3): Safe<MegaAlternative[]> {
  return cached(`ma|${b.key}|${limit}|${teamKey}`, 'suggestMegaAlternatives', () => {
    const out = suggestMegaAlternatives(b.ctx, team, limit);
    if (!Array.isArray(out)) throw new Error('resposta inválida');
    return out;
  });
}

export function runMoves(b: Bridge, team: Team, teamKey: string, slot: number): Safe<MoveSetSuggestion> {
  return cached(`m|${b.key}|${slot}|${teamKey}`, 'suggestMoves', () => {
    const out = suggestMoves(b.ctx, team, slot);
    return { recommended: out?.recommended ?? [], mostUsed: out?.mostUsed ?? [], ranked: out?.ranked ?? [], diffPt: out?.diffPt ?? [] };
  });
}

export function runItems(b: Bridge, team: Team, teamKey: string, slot: number): Safe<ItemSuggestion[]> {
  return cached(`i|${b.key}|${slot}|${teamKey}`, 'suggestItems', () => suggestItems(b.ctx, team, slot) ?? []);
}

export function runAbilities(b: Bridge, team: Team, teamKey: string, slot: number): Safe<AbilitySuggestion[]> {
  return cached(`h|${b.key}|${slot}|${teamKey}`, 'suggestAbilities', () => suggestAbilities(b.ctx, team, slot) ?? []);
}

export function runSpreads(b: Bridge, team: Team, teamKey: string, slot: number): Safe<SpreadSuggestion[]> {
  return cached(`s|${b.key}|${slot}|${teamKey}`, 'suggestSpreads', () => suggestSpreads(b.ctx, team, slot) ?? []);
}

/** Set completo para a espécie: motor -> dados de uso -> heurística simples. */
export function runBuildSet(b: Bridge, team: Team, species: string): { set: PokemonSet; fromEngine: boolean } {
  const res = safe('buildSet', () => sanitizeSet(buildSet(b.ctx, team, species)));
  if (res.ok && res.value && toId(res.value.species)) return { set: normalizeSet(b.dex, res.value).set, fromEngine: true };
  return { set: fallbackSet(b, team, species), fromEngine: false };
}

export function runAutoComplete(b: Bridge, team: Team): Safe<Team> {
  return safe('autoComplete', () => sanitizeTeam(autoComplete(b.ctx, team)).map(s => normalizeSet(b.dex, s).set));
}

/** Set de reserva quando o motor não responde: usa o mais usado no meta ou um spread básico. */
export function fallbackSet(b: Bridge, team: Team, speciesName: string): PokemonSet {
  const { dex } = b;
  const species = dex.species(speciesName);
  if (!species) return { species: speciesName, sp: emptySP(), moves: [] };
  const meta = b.data.meta.pokemon[species.id];
  const usedItems = new Set(team.map(s => toId(s.item)).filter(Boolean));
  if (meta && meta.moves.length) {
    const learnable = meta.moves.filter(m => dex.canLearn(species, m.id)).slice(0, 4).map(m => dex.move(m.id)?.name ?? m.name);
    const item = meta.items.find(i => !usedItems.has(toId(i.id)) && dex.item(i.id)?.legal[dex.regulation]);
    const spread = meta.spreads[0];
    return {
      species: species.name,
      item: item ? dex.item(item.id)?.name ?? item.name : undefined,
      ability: meta.abilities[0] ? dex.ability(meta.abilities[0].id)?.name ?? meta.abilities[0].name : species.abilities['0'],
      nature: spread?.nature,
      sp: spread ? sanitizeSP(spread.sp) : emptySP(),
      moves: learnable,
    };
  }
  const physical = species.baseStats.atk >= species.baseStats.spa;
  const fast = species.baseStats.spe >= 80;
  const sp = emptySP();
  sp[physical ? 'atk' : 'spa'] = 32;
  if (fast) {
    sp.spe = 32;
    sp.hp = 2;
  } else {
    sp.hp = 32;
    sp.def = 2;
  }
  return {
    species: species.name,
    ability: species.abilities['0'],
    nature: physical ? (fast ? 'Jolly' : 'Adamant') : fast ? 'Timid' : 'Modest',
    sp,
    moves: dex.canLearn(species, 'protect') ? ['Protect'] : [],
  };
}
