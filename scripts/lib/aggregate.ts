/**
 * Agrega snapshots de uso (ladder) e times com resultado (torneios, replays,
 * seeds) em public/data/meta.json, com:
 *  - decaimento temporal (meia-vida configurável);
 *  - peso por regulação (atual > anteriores > era SV);
 *  - penalidade para dados anteriores a patches que afetaram a espécie;
 *  - taxa de vitória com encolhimento bayesiano.
 */
import { DexAccess } from '../../src/core/dex.ts';
import { toId } from '../../src/core/id.ts';
import type {
  Dex, Meta, MetaArchetype, MetaCore, MetaPokemon, MetaSource, Share, SpreadShare, StatsTable, TournamentEvent,
} from '../../src/core/types.ts';
import type { PatchEvent, RecordMember, TeamRecord, UsageSnapshot } from './records.ts';

export interface EventInfo {
  id: string;
  name: string;
  date: string;
  tier: string;
  players: number | null;
  url?: string | null;
  game?: string;
  regulation: string;
}

export interface AggregateInput {
  dex: Dex;
  regulation: string;
  /** Regulações do Champions da mais nova para a mais antiga. */
  regulationOrder: string[];
  snapshots: UsageSnapshot[];
  records: TeamRecord[];
  patches: PatchEvent[];
  /** Data de referência (ISO yyyy-mm-dd). */
  now: string;
  halfLifeDays?: number;
  shrinkK?: number;
  archetypes?: MetaArchetype[];
  events?: EventInfo[];
  notes?: string[];
  maxOfficialEvents?: number;
  maxOnlineEvents?: number;
}

const DAY = 86_400_000;
const KIND_WEIGHT: Record<TeamRecord['sourceKind'], number> = { official: 1, online: 0.7, ladder: 0.5, seed: 0.8 };
const STATS: (keyof StatsTable)[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

interface Resolved {
  id: string;
  name: string;
  item?: string;
  ability?: string;
  moves: string[];
  spread?: string;
}

class Tally {
  w = 0;
  map = new Map<string, number>();
  add(key: string, w: number) {
    this.map.set(key, (this.map.get(key) ?? 0) + w);
  }
}

class SpeciesAcc {
  // família "torneios/replays" (rec) e "ladder" (snap)
  recW = 0; // soma de pesos de amostras onde a espécie aparece
  recDen = 0; // soma de pesos de todas as amostras (para uso)
  snapW = 0;
  snapDen = 0;
  recSets = { moves: new Tally(), items: new Tally(), abilities: new Tally(), spreads: new Tally(), mates: new Tally() };
  snapSets = { moves: new Tally(), items: new Tally(), abilities: new Tally(), spreads: new Tally(), mates: new Tally() };
  wins = 0;
  games = 0;
  rawWins = 0;
  rawGames = 0;
  topCut = 0;
  topCutDen = 0;
  recent = { num: 0, den: 0 };
  previous = { num: 0, den: 0 };
  sources = new Set<string>();
}

export function daysBetween(a: string, b: string): number {
  return Math.max(0, (Date.parse(b) - Date.parse(a)) / DAY);
}

export function decay(date: string, now: string, halfLifeDays: number): number {
  return 0.5 ** (daysBetween(date, now) / halfLifeDays);
}

export function regulationWeight(reg: string, order: string[]): number {
  const idx = order.indexOf(reg);
  if (idx === 0) return 1;
  if (idx === 1) return 0.35;
  if (idx === 2) return 0.15;
  if (idx > 2) return 0.1;
  return 0.05; // Scarlet/Violet ou desconhecida
}

export function shrinkWinRate(wins: number, games: number, k: number): number {
  return (wins + k * 0.5) / (games + k);
}

function topCutSize(players: number | null | undefined): number {
  if (!players) return 8;
  if (players >= 512) return 64;
  if (players >= 256) return 32;
  if (players >= 128) return 16;
  return 8;
}

function toShares(t: Tally, total: number, dex: Dex, kind: 'moves' | 'items' | 'abilities' | 'species', limit: number): Share[] {
  if (total <= 0) return [];
  const out: Share[] = [];
  for (const [id, w] of t.map) {
    const name =
      kind === 'moves' ? dex.moves[id]?.name : kind === 'items' ? dex.items[id]?.name : kind === 'abilities' ? dex.abilities[id]?.name : dex.species[id]?.name;
    if (!name) continue;
    out.push({ id, name, share: Math.min(1, w / total) });
  }
  return out.sort((a, b) => b.share - a.share).slice(0, limit);
}

function mixTally(a: Tally, aTotal: number, fa: number, b: Tally, bTotal: number, fb: number): { tally: Tally; total: number } {
  // Mistura duas distribuições normalizadas com pesos de família fa/fb.
  const out = new Tally();
  const keys = new Set([...a.map.keys(), ...b.map.keys()]);
  const wa = aTotal > 0 ? fa : 0;
  const wb = bTotal > 0 ? fb : 0;
  const den = wa + wb;
  if (!den) return { tally: out, total: 0 };
  for (const k of keys) {
    const va = aTotal > 0 ? (a.map.get(k) ?? 0) / aTotal : 0;
    const vb = bTotal > 0 ? (b.map.get(k) ?? 0) / bTotal : 0;
    out.add(k, (wa * va + wb * vb) / den);
  }
  return { tally: out, total: 1 };
}

function parseSpreadKey(key: string): SpreadShare | null {
  const m = /^([A-Za-z]+):(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(key);
  if (!m) return null;
  const sp = Object.fromEntries(STATS.map((s, i) => [s, Number(m[i + 2])])) as StatsTable;
  return { nature: m[1], sp, share: 0 };
}

export function aggregate(input: AggregateInput): Meta {
  const dexData = input.dex;
  const dex = new DexAccess(dexData, input.regulation);
  const half = input.halfLifeDays ?? 60;
  const k = input.shrinkK ?? 20;
  const notes = [...(input.notes ?? [])];
  const unknown = new Set<string>();
  let unknownSV = 0;
  // 0 = registro do Champions; 1 = era SV (silencioso); 2 = era SV (contabiliza nomes ignorados)
  let svContext: 0 | 1 | 2 = 0;

  /* ---------------------- resolução de nomes ---------------------- */
  const formeFallback = new Map<string, string>();
  for (const sp of Object.values(dexData.species)) {
    if (sp.isMega || !sp.baseSpecies) continue;
    const baseId = toId(sp.baseSpecies);
    if (!dexData.species[baseId] && sp.legal[input.regulation]) formeFallback.set(baseId, sp.id);
  }
  const resolveSpecies = (raw: string): { id: string; megaItem?: string } | null => {
    const name = raw.replace(/\s*♀/g, '-F').replace(/\s*♂/g, '-M');
    let id = toId(name);
    let sp = dexData.species[id];
    if (!sp && formeFallback.has(id)) sp = dexData.species[formeFallback.get(id)!];
    if (!sp && name.includes('-')) {
      const base = toId(name.slice(0, name.lastIndexOf('-')));
      sp = dexData.species[base] ?? (formeFallback.has(base) ? dexData.species[formeFallback.get(base)!] : undefined);
    }
    if (!sp) {
      if (svContext === 2) unknownSV++;
      else if (!svContext) unknown.add(name);
      return null;
    }
    if (sp.duplicateOf && dexData.species[sp.duplicateOf]) sp = dexData.species[sp.duplicateOf];
    if (sp.isMega) {
      const base = dex.baseOf(sp);
      return { id: base.id, megaItem: sp.requiredItem };
    }
    id = sp.id;
    return { id };
  };
  const resolveAbility = (speciesId: string, raw: string | null | undefined): string | undefined => {
    const sp = dexData.species[speciesId];
    if (raw === null || raw === undefined) return undefined;
    if (sp && (raw === '' || raw === '0' || raw === '1' || raw === 'H' || raw === 'S')) {
      const slot = (raw === '' ? '0' : raw) as '0' | '1' | 'H' | 'S';
      return sp.abilities[slot] ? toId(sp.abilities[slot]) : undefined;
    }
    const id = toId(raw);
    if (!dexData.abilities[id]) return undefined;
    // Só habilidades da própria espécie: um time listado pela forma Mega (Charizard-Mega-Y)
    // pode trazer a habilidade da Mega (Drought), que não diz nada da forma base.
    return !sp || Object.values(sp.abilities).some(a => toId(a) === id) ? id : undefined;
  };
  const resolveMember = (m: RecordMember): Resolved | null => {
    const sp = resolveSpecies(m.species);
    if (!sp) return null;
    const itemId = toId(m.item ?? sp.megaItem ?? '');
    const item = dexData.items[itemId] ? itemId : sp.megaItem ? toId(sp.megaItem) : undefined;
    const moves = [...new Set(m.moves.map(toId).filter(id => dexData.moves[id]))];
    let spread: string | undefined;
    if (m.nature && m.sp) {
      const nature = dexData.natures[toId(m.nature)]?.name;
      if (nature) spread = `${nature}:${STATS.map(s => m.sp?.[s] ?? 0).join('/')}`;
    }
    return { id: sp.id, name: dexData.species[sp.id].name, item, ability: resolveAbility(sp.id, m.ability), moves, spread };
  };

  /* ------------------------ patches por espécie ------------------------ */
  const patchDatesFor = new Map<string, string[]>(); // speciesId -> datas de patches
  {
    const byName = new Map<string, string[]>();
    for (const p of input.patches) for (const a of p.affects) byName.set(toId(a), [...(byName.get(toId(a)) ?? []), p.date]);
    // Associa golpes/habilidades/itens comuns de cada espécie (pelos próprios dados).
    const common = new Map<string, Set<string>>();
    const note = (sid: string, key: string) => {
      if (!common.has(sid)) common.set(sid, new Set([sid]));
      common.get(sid)!.add(key);
    };
    for (const r of input.records) {
      svContext = r.game === 'SV' || r.regulation.startsWith('SV') ? 1 : 0;
      for (const m of r.pokemon) {
        const res = resolveMember(m);
        if (!res) continue;
        note(res.id, res.id);
        res.moves.forEach(x => note(res.id, x));
        if (res.ability) note(res.id, res.ability);
        if (m.ability) note(res.id, toId(m.ability)); // inclui a habilidade da Mega
        if (res.item) note(res.id, res.item);
      }
    }
    svContext = 0;
    for (const s of input.snapshots) {
      for (const [name, e] of Object.entries(s.pokemon)) {
        const sp = resolveSpecies(name);
        if (!sp) continue;
        note(sp.id, sp.id);
        for (const [mv, share] of Object.entries(e.moves)) if (share >= 0.2) note(sp.id, toId(mv));
        for (const [ab, share] of Object.entries(e.abilities)) if (share >= 0.2) note(sp.id, toId(ab));
      }
    }
    for (const [sid, keys] of common) {
      const dates = new Set<string>();
      for (const key of keys) for (const d of byName.get(key) ?? []) dates.add(d);
      if (dates.size) patchDatesFor.set(sid, [...dates]);
    }
  }
  const patchFactor = (sid: string, date: string) => {
    let f = 1;
    for (const d of patchDatesFor.get(sid) ?? []) if (d > date) f *= 0.5;
    return f;
  };

  /* ---------------------------- acumulação ---------------------------- */
  const acc = new Map<string, SpeciesAcc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = new SpeciesAcc()));
    return a;
  };
  const isRecent = (date: string) => daysBetween(date, input.now) <= 30;
  const isPrevious = (date: string) => {
    const d = daysBetween(date, input.now);
    return d > 30 && d <= 120;
  };

  // Resolve todos os registros uma vez.
  const resolvedRecords = input.records
    .map(r => {
      svContext = r.game === 'SV' || r.regulation.startsWith('SV') ? 2 : 0;
      const members = r.pokemon.map(resolveMember).filter((m): m is Resolved => !!m);
      svContext = 0;
      return { r, members };
    })
    .filter(x => x.members.length >= 4);

  const allSpecies = new Set<string>();
  // Regulações em que cada espécie aparece nos dados (cobre as que o dex não conhece: M-A, era SV).
  const seenIn = new Map<string, Set<string>>();
  const markSeen = (reg: string, sid: string) => {
    allSpecies.add(sid);
    let set = seenIn.get(reg);
    if (!set) seenIn.set(reg, (set = new Set()));
    set.add(sid);
  };
  for (const { r, members } of resolvedRecords) members.forEach(m => markSeen(r.regulation, m.id));
  for (const s of input.snapshots) for (const name of Object.keys(s.pokemon)) {
    const sp = resolveSpecies(name);
    if (sp) markSeen(s.regulation, sp.id);
  }
  // O denominador do uso só inclui amostras de regulações em que a espécie podia ser usada:
  // times da M-B (onde Rillaboom era ilegal) não dizem nada sobre o uso de Rillaboom.
  const eligible = (sid: string, reg: string) => !!dexData.species[sid]?.legal[reg] || !!seenIn.get(reg)?.has(sid);
  const eligibleByReg = new Map<string, string[]>();
  const eligibleSpecies = (reg: string) => {
    let list = eligibleByReg.get(reg);
    if (!list) eligibleByReg.set(reg, (list = [...allSpecies].filter(sid => eligible(sid, reg))));
    return list;
  };

  const pair = new Map<string, { w: number; wins: number; games: number; n: number }>();
  const triple = new Map<string, { w: number; wins: number; games: number; n: number }>();
  let recTotalW = 0;
  const recTotalByReg = new Map<string, number>();

  for (const { r, members } of resolvedRecords) {
    const base = decay(r.date, input.now, half) * regulationWeight(r.regulation, input.regulationOrder) * KIND_WEIGHT[r.sourceKind];
    if (base <= 1e-6) continue;
    recTotalW += base;
    recTotalByReg.set(r.regulation, (recTotalByReg.get(r.regulation) ?? 0) + base);
    const ids = new Set(members.map(m => m.id));
    const games = (r.wins ?? 0) + (r.losses ?? 0);
    // Denominador de uso por espécie (inclui equipes sem ela, se ela era legal ali).
    for (const sid of eligibleSpecies(r.regulation)) {
      const w = base * patchFactor(sid, r.date);
      const a = get(sid);
      a.recDen += w;
      if (r.regulation === input.regulation) {
        if (isRecent(r.date)) a.recent.den += 1;
        else if (isPrevious(r.date)) a.previous.den += 1;
      }
    }
    for (const m of members) {
      const a = get(m.id);
      const w = base * patchFactor(m.id, r.date);
      a.recW += w;
      a.sources.add(r.eventName ?? r.source.split(':')[0]);
      if (m.item) a.recSets.items.add(m.item, w);
      if (m.ability) a.recSets.abilities.add(m.ability, w);
      if (m.spread) a.recSets.spreads.add(m.spread, w);
      if (m.moves.length) for (const mv of m.moves) a.recSets.moves.add(mv, w);
      a.recSets.items.w += m.item ? w : 0;
      a.recSets.abilities.w += m.ability ? w : 0;
      a.recSets.spreads.w += m.spread ? w : 0;
      a.recSets.moves.w += m.moves.length ? w : 0;
      for (const other of ids) if (other !== m.id) a.recSets.mates.add(other, w);
      a.recSets.mates.w += w;
      if (games > 0) {
        a.wins += w * (r.wins ?? 0);
        a.games += w * games;
        a.rawWins += r.wins ?? 0;
        a.rawGames += games;
      }
      if (r.placing && (r.sourceKind === 'official' || r.sourceKind === 'online' || r.sourceKind === 'seed')) {
        a.topCutDen += w;
        if (r.placing <= topCutSize(r.players)) a.topCut += w;
      }
      if (r.regulation === input.regulation) {
        if (isRecent(r.date)) a.recent.num += 1;
        else if (isPrevious(r.date)) a.previous.num += 1;
      }
    }
    const sorted = [...ids].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        const p = pair.get(key) ?? { w: 0, wins: 0, games: 0, n: 0 };
        p.w += base;
        p.n += 1;
        if (games) {
          p.wins += base * (r.wins ?? 0);
          p.games += base * games;
        }
        pair.set(key, p);
        for (let l = j + 1; l < sorted.length; l++) {
          const tk = `${key}|${sorted[l]}`;
          const t = triple.get(tk) ?? { w: 0, wins: 0, games: 0, n: 0 };
          t.w += base;
          t.n += 1;
          if (games) {
            t.wins += base * (r.wins ?? 0);
            t.games += base * games;
          }
          triple.set(tk, t);
        }
      }
    }
  }

  let snapTotalW = 0;
  for (const s of input.snapshots) {
    const battleFactor = s.sourceKind === 'seed' ? 0.8 : Math.min(1, Math.max(0.1, s.battles / 3000));
    const base = decay(s.date, input.now, half) * regulationWeight(s.regulation, input.regulationOrder) * battleFactor;
    if (base <= 1e-6) continue;
    snapTotalW += base;
    // Uma espécie pode aparecer em várias entradas (ex.: Garchomp e Garchomp-Mega-Z):
    // somamos o uso e combinamos os sets ponderando pelo uso de cada forma.
    const present = new Map<string, string[]>();
    for (const name of Object.keys(s.pokemon)) {
      const sp = resolveSpecies(name);
      if (sp) present.set(sp.id, [...(present.get(sp.id) ?? []), name]);
    }
    for (const sid of eligibleSpecies(s.regulation)) {
      const w = base * patchFactor(sid, s.date);
      const a = get(sid);
      a.snapDen += w;
      const names = present.get(sid);
      if (!names) {
        if (s.regulation === input.regulation) {
          if (isRecent(s.date)) a.recent.den += 1;
          else if (isPrevious(s.date)) a.previous.den += 1;
        }
        continue;
      }
      let usage = 0;
      for (const name of names) {
        const e = s.pokemon[name];
        const megaItem = resolveSpecies(name)?.megaItem;
        usage += e.usage;
        const ws = w * e.usage;
        const addAll = (t: Tally, o: Record<string, number>, resolve: (k: string) => string | undefined) => {
          for (const [key, v] of Object.entries(o)) {
            const id = resolve(key);
            if (id) t.add(id, ws * v);
          }
          t.w += ws;
        };
        addAll(a.snapSets.moves, e.moves, key => (dexData.moves[toId(key)] ? toId(key) : undefined));
        // Smogon às vezes registra a Mega Stone só na forma Mega: garantimos o item.
        const items = megaItem && !Object.keys(e.items).some(k => toId(k) === toId(megaItem)) ? { ...e.items, [megaItem]: 1 } : e.items;
        addAll(a.snapSets.items, items, key => (dexData.items[toId(key)] ? toId(key) : undefined));
        // A entrada de uma Mega (Charizard-Mega-Y) traz a habilidade da Mega, não a da forma base.
        if (!megaItem) addAll(a.snapSets.abilities, e.abilities, key => (dexData.abilities[toId(key)] ? toId(key) : undefined));
        addAll(a.snapSets.spreads, e.spreads, key => (parseSpreadKey(key) ? key : undefined));
        addAll(a.snapSets.mates, e.teammates, key => resolveSpecies(key)?.id);
      }
      usage = Math.min(1, usage);
      a.snapW += w * usage;
      a.sources.add(s.label);
      if (s.regulation === input.regulation) {
        if (isRecent(s.date)) {
          a.recent.num += usage;
          a.recent.den += 1;
        } else if (isPrevious(s.date)) {
          a.previous.num += usage;
          a.previous.den += 1;
        }
      }
    }
  }

  // Peso de cada família: torneios chegam a peso 1 com ~200 times recentes; ladder com 1 snapshot recente completo.
  const famRec = Math.min(1, recTotalW / 200);
  const famSnap = Math.min(1, snapTotalW);

  /* ------------------------------ saída ------------------------------ */
  const pokemon: Record<string, MetaPokemon> = {};
  for (const [sid, a] of acc) {
    const sp = dexData.species[sid];
    if (!sp || !sp.legal[input.regulation]) continue;
    const usageRec = a.recDen > 0 ? a.recW / a.recDen : 0;
    const usageSnap = a.snapDen > 0 ? a.snapW / a.snapDen : 0;
    const fr = a.recDen > 0 ? famRec : 0;
    const fs = a.snapDen > 0 ? famSnap : 0;
    const usage = fr + fs > 0 ? (fr * usageRec + fs * usageSnap) / (fr + fs) : 0;
    if (usage <= 0) continue;
    const mix = (key: keyof SpeciesAcc['recSets']) =>
      mixTally(a.recSets[key], a.recSets[key].w, fr, a.snapSets[key], a.snapSets[key].w, fs);
    const moves = mix('moves');
    const items = mix('items');
    const abilities = mix('abilities');
    const spreads = mix('spreads');
    const mates = mix('mates');
    const spreadList: SpreadShare[] = [...spreads.tally.map]
      .map(([key, share]) => {
        const p = parseSpreadKey(key);
        return p ? { ...p, share } : null;
      })
      .filter((x): x is SpreadShare => !!x)
      .sort((x, y) => y.share - x.share)
      .slice(0, 8);
    const teammates = toShares(mates.tally, mates.total, dexData, 'species', 20).map(t => {
      const key = [sid, t.id].sort().join('|');
      const p = pair.get(key);
      return {
        ...t,
        games: p ? Math.round(p.games) : 0,
        winRate: p && p.games >= 5 ? shrinkWinRate(p.wins, p.games, k) : null,
      };
    });
    pokemon[sid] = {
      id: sid,
      name: sp.name,
      usage,
      rank: 0,
      winRate: a.games > 0 ? shrinkWinRate(a.wins, a.games, k) : null,
      rawWinRate: a.rawGames > 0 ? a.rawWins / a.rawGames : null,
      games: Math.round(a.rawGames),
      topCutRate: a.topCutDen > 0 ? a.topCut / a.topCutDen : null,
      moves: toShares(moves.tally, moves.total, dexData, 'moves', 20),
      items: toShares(items.tally, items.total, dexData, 'items', 10),
      abilities: toShares(abilities.tally, abilities.total, dexData, 'abilities', 4),
      spreads: spreadList,
      teammates,
      trend:
        a.recent.den || a.previous.den
          ? { recent: a.recent.den ? a.recent.num / a.recent.den : 0, previous: a.previous.den ? a.previous.num / a.previous.den : 0 }
          : null,
      sources: [...a.sources].slice(0, 12),
    };
  }
  // lift dos parceiros
  for (const p of Object.values(pokemon)) {
    for (const t of p.teammates) {
      const u = pokemon[t.id]?.usage;
      if (u) (t as { lift?: number }).lift = t.share / u;
    }
  }
  const ranked = Object.values(pokemon).sort((a, b) => b.usage - a.usage);
  ranked.forEach((p, i) => (p.rank = i + 1));

  /* ------------------------------- cores ------------------------------- */
  const cores: MetaCore[] = [];
  const legalNow = (id: string) => !!pokemon[id];
  // Fração dos times (das regulações em que todos os membros eram legais) que têm o core.
  const coreShare = (w: number, members: string[]) => {
    let den = 0;
    for (const [reg, total] of recTotalByReg) if (members.every(id => eligible(id, reg))) den += total;
    return den ? w / den : 0;
  };
  for (const [key, p] of pair) {
    const members = key.split('|');
    if (p.n < 3 || !members.every(legalNow)) continue;
    cores.push({ members, usage: coreShare(p.w, members), winRate: p.games >= 5 ? shrinkWinRate(p.wins, p.games, k) : null, games: Math.round(p.games) });
  }
  // completa com pares do ladder quando há pouco dado de torneio
  if (cores.length < 30) {
    const seen = new Set(cores.map(c => c.members.join('|')));
    for (const p of ranked.slice(0, 40)) {
      for (const t of p.teammates.slice(0, 6)) {
        const members = [p.id, t.id].sort();
        const key = members.join('|');
        if (seen.has(key) || !legalNow(t.id)) continue;
        seen.add(key);
        cores.push({ members, usage: p.usage * t.share, winRate: t.winRate ?? null, games: t.games ?? 0 });
      }
    }
  }
  for (const [key, t] of triple) {
    const members = key.split('|');
    if (t.n < 3 || !members.every(legalNow)) continue;
    cores.push({ members, usage: coreShare(t.w, members), winRate: t.games >= 5 ? shrinkWinRate(t.wins, t.games, k) : null, games: Math.round(t.games) });
  }
  cores.sort((a, b) => b.usage - a.usage);

  /* ------------------------------ eventos ------------------------------ */
  const eventsById = new Map<string, TournamentEvent>();
  for (const info of input.events ?? []) {
    eventsById.set(info.id, { id: info.id, name: info.name, date: info.date, regulation: info.regulation, game: info.game ?? 'Champions', tier: info.tier, players: info.players, url: info.url ?? null, teams: [] });
  }
  for (const r of input.records) {
    if (!r.eventId || r.sourceKind === 'ladder') continue;
    let ev = eventsById.get(r.eventId);
    if (!ev) {
      ev = { id: r.eventId, name: r.eventName ?? r.eventId, date: r.date, regulation: r.regulation, game: r.game ?? 'Champions', tier: r.sourceKind === 'online' ? 'online' : 'official', players: r.players ?? null, url: null, teams: [] };
      eventsById.set(r.eventId, ev);
    }
    ev.teams.push({
      player: r.player ?? '?',
      placing: r.placing ?? null,
      record: r.wins !== null && r.losses !== null ? { wins: r.wins, losses: r.losses, ties: r.ties ?? 0 } : null,
      pokemon: r.pokemon.map(m => {
        svContext = r.game === 'SV' || r.regulation.startsWith('SV') ? 1 : 0;
        const res = resolveMember(m);
        svContext = 0;
        return {
          species: res?.name ?? m.species,
          item: res?.item ? dexData.items[res.item]?.name ?? m.item ?? null : m.item ?? null,
          ability: res?.ability ? dexData.abilities[res.ability]?.name ?? null : m.ability ?? null,
          moves: res ? res.moves.map(id => dexData.moves[id].name) : m.moves,
          nature: m.nature ?? null,
          sp: m.sp ?? null,
        };
      }),
    });
  }
  // Mantém o meta.json leve: eventos oficiais com top 32 e online com top 8.
  const official = (e: TournamentEvent) => e.tier !== 'online';
  const sortedEvents = [...eventsById.values()]
    .filter(e => e.teams.length)
    .map(e => ({ ...e, teams: e.teams.sort((a, b) => (a.placing ?? 9999) - (b.placing ?? 9999)).slice(0, official(e) ? 32 : 8) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const events = [
    ...sortedEvents.filter(official).slice(0, input.maxOfficialEvents ?? 30),
    ...sortedEvents.filter(e => !official(e)).sort((a, b) => (b.players ?? 0) - (a.players ?? 0) || b.date.localeCompare(a.date)).slice(0, input.maxOnlineEvents ?? 25),
  ].sort((a, b) => b.date.localeCompare(a.date));

  /* ------------------------------ fontes ------------------------------ */
  const sources: MetaSource[] = [];
  for (const s of input.snapshots) {
    sources.push({
      id: s.source,
      kind: s.sourceKind === 'seed' ? 'seed' : 'usage',
      label: s.label,
      url: s.url,
      period: s.period,
      regulation: s.regulation,
      samples: s.battles,
      weight: decay(s.date, input.now, half) * regulationWeight(s.regulation, input.regulationOrder),
      fetchedAt: input.now,
    });
  }
  const groups = new Map<string, { n: number; r: TeamRecord }>();
  for (const r of input.records) {
    const key = r.sourceKind === 'ladder' ? `replays:${r.regulation}` : r.eventId ?? r.source;
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { n: 1, r });
  }
  for (const [key, { n, r }] of groups) {
    sources.push({
      id: key,
      kind: r.sourceKind === 'ladder' ? 'replays' : r.sourceKind === 'seed' ? 'seed' : 'tournament',
      label: r.sourceKind === 'ladder' ? `Replays do Showdown (${r.regulation})` : r.eventName ?? key,
      regulation: r.regulation,
      samples: n,
      weight: decay(r.date, input.now, half) * regulationWeight(r.regulation, input.regulationOrder) * KIND_WEIGHT[r.sourceKind],
      fetchedAt: input.now,
      period: r.date,
    });
  }
  sources.sort((a, b) => b.weight - a.weight);

  if (unknown.size) notes.push(`Nomes não reconhecidos (ignorados): ${[...unknown].slice(0, 30).join(', ')}`);
  if (unknownSV) notes.push(`${unknownSV} Pokémon de times da era Scarlet/Violet não existem no Champions e foram ignorados (os demais membros contam com peso baixo).`);
  if (!resolvedRecords.some(x => x.r.regulation === input.regulation && x.r.wins !== null)) {
    notes.push(`Ainda não há partidas com resultado da Reg ${input.regulation}; taxas de vitória usam regulações anteriores ou ficam vazias.`);
  }

  const format = dexData.formats.find(f => f.regulation === input.regulation);
  return {
    version: 1,
    generatedAt: new Date(`${input.now}T12:00:00Z`).toISOString(),
    regulation: input.regulation,
    formatId: format?.id ?? '',
    halfLifeDays: half,
    sources,
    pokemon,
    cores: cores.slice(0, 120),
    archetypes: input.archetypes ?? [],
    events,
    notes,
  };
}
