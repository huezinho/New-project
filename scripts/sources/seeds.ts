/**
 * Dados semente (data/seed/*.json): snapshot pesquisado do meta e times de
 * torneios oficiais. Garantem que o app funcione offline e antes da primeira
 * atualização automática.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { MetaArchetype, StatsTable } from '../../src/core/types.ts';
import { toId } from '../../src/core/id.ts';
import type { EventInfo } from '../lib/aggregate.ts';
import type { PatchEvent, TeamRecord, UsageEntry, UsageSnapshot } from '../lib/records.ts';

interface SeedShare { name?: string; species?: string; share: number | null }
interface SeedPokemon {
  species: string;
  usage: number | null;
  rawCount?: number | null;
  abilities?: SeedShare[];
  items?: SeedShare[];
  moves?: SeedShare[];
  spreads?: { nature: string; sp: Partial<StatsTable>; share: number | null }[];
  teammates?: SeedShare[];
}
interface SeedRegulation {
  source?: { label?: string; url?: string; period?: string; cutoff?: number | string; battles?: number | null };
  pokemon: SeedPokemon[];
}
interface SeedSnapshot {
  regulation: string;
  formatId?: string;
  period?: string;
  cutoff?: number;
  battles?: number;
  label?: string;
  url?: string;
  pokemon: SeedPokemon[];
}
export interface MetaSeed {
  snapshotDate: string;
  /** Formato antigo: uma entrada por regulação. */
  regulations?: Record<string, SeedRegulation>;
  /** Lista de snapshots resumidos (ex.: Bo1 e Bo3 da mesma regulação). */
  snapshots?: SeedSnapshot[];
  /** Snapshots completos no formato interno (gerados por npm run build:seeds). */
  usageSnapshots?: UsageSnapshot[];
  archetypes?: { regulation?: string; id?: string; name: string; namePt?: string; keyMembers?: string[]; description?: string; share?: number | null; winRate?: number | null; games?: number | null }[];
}

interface SeedTeamMember { species: string; item?: string | null; ability?: string | null; moves?: string[]; nature?: string | null; sp?: Partial<StatsTable> | null }
interface SeedEvent {
  id: string;
  name: string;
  date: string;
  location?: string;
  regulation: string;
  game?: string;
  tier?: string;
  players?: number | null;
  url?: string | null;
  teams: { player?: string; country?: string | null; placing?: number | null; record?: { wins: number; losses: number; ties?: number } | null; pokemon: SeedTeamMember[] }[];
}
export interface TournamentSeed {
  events: (SeedEvent | EventInfo)[];
  /** Times já normalizados (gerados por npm run build:seeds). */
  records?: TeamRecord[];
}

/** Lê `arquivo.json` ou, se não existir, `arquivo.json.gz`. */
const readJson = <T>(path: string): T | null => {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as T;
  if (existsSync(`${path}.gz`)) return JSON.parse(gunzipSync(readFileSync(`${path}.gz`)).toString('utf8')) as T;
  return null;
};

function periodDate(period: string | undefined, fallback: string): string {
  const m = /(\d{4})-(\d{2})/.exec(period ?? '');
  return m ? `${m[1]}-${m[2]}-15` : fallback;
}

const toMap = (list: SeedShare[] | undefined, key: 'name' | 'species' = 'name') => {
  const out: Record<string, number> = {};
  for (const s of list ?? []) {
    const k = s[key] ?? s.name ?? s.species;
    if (k && typeof s.share === 'number' && s.share > 0) out[k] = s.share;
  }
  return out;
};

export function loadMetaSeed(path: string): { snapshots: UsageSnapshot[]; archetypes: MetaArchetype[] } {
  const seed = readJson<MetaSeed>(path);
  if (!seed) return { snapshots: [], archetypes: [] };
  const entries: SeedSnapshot[] = [
    ...(seed.snapshots ?? []),
    ...Object.entries(seed.regulations ?? {}).map(([regulation, reg]) => ({
      regulation,
      period: reg.source?.period,
      cutoff: typeof reg.source?.cutoff === 'number' ? reg.source.cutoff : undefined,
      battles: reg.source?.battles ?? 0,
      label: reg.source?.label,
      url: reg.source?.url,
      pokemon: reg.pokemon,
    })),
  ];
  const snapshots: UsageSnapshot[] = (seed.usageSnapshots ?? []).map(s => ({ ...s, sourceKind: 'seed' as const }));
  for (const snap of entries) {
    const pokemon: Record<string, UsageEntry> = {};
    for (const p of snap.pokemon ?? []) {
      if (!p.species || typeof p.usage !== 'number' || p.usage <= 0) continue;
      const spreads: Record<string, number> = {};
      for (const s of p.spreads ?? []) {
        if (!s.nature || !s.sp || typeof s.share !== 'number') continue;
        const key = `${s.nature}:${['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => s.sp[k as keyof StatsTable] ?? 0).join('/')}`;
        spreads[key] = s.share;
      }
      pokemon[p.species] = {
        usage: p.usage,
        rawCount: p.rawCount ?? undefined,
        abilities: toMap(p.abilities),
        items: toMap(p.items),
        moves: toMap(p.moves),
        spreads,
        teammates: toMap(p.teammates, 'species'),
      };
    }
    if (!Object.keys(pokemon).length) continue;
    const id = snap.formatId ?? snap.regulation;
    snapshots.push({
      source: `seed:${id}:${snap.period ?? ''}`,
      sourceKind: 'seed',
      label: `${snap.label ?? `Uso ${id}`} — snapshot pesquisado`,
      url: snap.url,
      date: periodDate(snap.period, seed.snapshotDate),
      period: snap.period,
      regulation: snap.regulation,
      cutoff: snap.cutoff,
      battles: snap.battles ?? 0,
      dedupeKey: snap.formatId && snap.period ? `${snap.formatId}:${snap.period}` : undefined,
      pokemon,
    });
  }
  const archetypes: MetaArchetype[] = (seed.archetypes ?? []).map(a => ({
    id: a.id ?? toId(`${a.regulation ?? ''}-${a.name}`),
    regulation: a.regulation,
    winRate: a.winRate ?? null,
    games: a.games ?? null,
    name: a.name,
    namePt: a.namePt ?? a.name,
    keyMembers: a.keyMembers ?? [],
    share: a.share ?? null,
    description: a.description ?? '',
  }));
  return { snapshots, archetypes };
}

export function loadTournamentSeed(path: string): { records: TeamRecord[]; events: EventInfo[] } {
  const seed = readJson<TournamentSeed>(path);
  if (!seed) return { records: [], events: [] };
  const records: TeamRecord[] = (seed.records ?? []).map(r => ({ ...r, source: r.source.startsWith('seed:') ? r.source : `seed:${r.source}` }));
  const events: EventInfo[] = [];
  for (const raw of seed.events ?? []) {
    if (!('teams' in raw)) {
      events.push(raw as EventInfo);
      continue;
    }
    const ev = raw as SeedEvent;
    if (!ev.id || !ev.date || !ev.teams?.length) continue;
    const kind: TeamRecord['sourceKind'] = ev.tier === 'online' ? 'online' : 'official';
    events.push({ id: ev.id, name: ev.name, date: ev.date, tier: ev.tier ?? 'official', players: ev.players ?? null, url: ev.url ?? null, game: ev.game, regulation: ev.regulation });
    for (const t of ev.teams) {
      const pokemon = (t.pokemon ?? [])
        .filter(p => p.species)
        .map(p => ({ species: p.species, item: p.item ?? null, ability: p.ability ?? null, moves: p.moves ?? [], nature: p.nature ?? null, sp: p.sp ?? null }));
      if (pokemon.length < 4) continue;
      records.push({
        source: `seed:${ev.id}`,
        sourceKind: kind,
        eventId: ev.id,
        eventName: ev.name,
        date: ev.date.slice(0, 10),
        regulation: ev.regulation,
        game: ev.game,
        player: t.player,
        placing: t.placing ?? null,
        players: ev.players ?? null,
        wins: t.record?.wins ?? null,
        losses: t.record?.losses ?? null,
        ties: t.record?.ties ?? null,
        pokemon,
      });
    }
  }
  return { records, events };
}

interface PatchesFile { versions?: { version?: string; date?: string; changes?: { name?: string }[] }[] }

export function loadPatchEvents(path: string): PatchEvent[] {
  const file = readJson<PatchesFile>(path);
  return (file?.versions ?? [])
    .filter(v => v.date && /^\d{4}-\d{2}-\d{2}/.test(v.date))
    .map(v => ({ date: v.date!.slice(0, 10), version: v.version, affects: (v.changes ?? []).map(c => c.name ?? '').filter(Boolean) }))
    .filter(p => p.affects.length);
}
