/**
 * Carregamento dos arquivos de public/data. dex/meta/heuristics são
 * obrigatórios; patches e regulations são opcionais (404 ou campos
 * ausentes são tolerados).
 */
import type { Heuristics } from '../core/api.ts';
import type {
  Dex, Meta, MetaArchetype, MetaPokemon, MetaSource, Share, StatsTable, TournamentEvent, TournamentTeam, TournamentTeamMember,
} from '../core/types.ts';

export interface PatchChange {
  kind?: string;
  name?: string;
  id?: string;
  field?: string;
  from?: unknown;
  to?: unknown;
  direction?: 'buff' | 'nerf' | 'change' | string;
  notePt?: string;
  source?: string;
}

export interface PatchVersion {
  version?: string;
  date?: string;
  regulation?: string;
  sources?: (string | { label?: string; url?: string })[];
  changes?: PatchChange[];
  notesPt?: string | string[];
}

export interface SimulatorFix {
  commit?: string;
  date?: string;
  notePt?: string;
  source?: string;
}

export interface PatchesFile {
  meta: { generatedAt?: string; showdownCommit?: string; currentRegulation?: string; currentGameVersion?: string; ppFormula?: string; notePt?: string } | null;
  versions: PatchVersion[];
  championsVsSV: unknown[];
  unavailableButDataChanged: PatchChange[];
  simulatorFixes: SimulatorFix[];
  gaps: string[];
}

export interface RankedSeason {
  season?: string;
  start?: string | null;
  end?: string | null;
}

export interface RegulationInfo {
  id?: string;
  name?: string;
  start?: string;
  end?: string | null;
  notes?: string | string[];
  rankedSeasons?: RankedSeason[];
  events?: { event?: string; date?: string }[];
  showdownFormatId?: string;
  sources?: string[];
}

export interface SeasonEvent {
  event?: string;
  location?: string;
  date?: string;
  regulation?: string;
  status?: string;
  source?: string;
}

export interface ItemAvailability {
  item: string;
  available?: boolean;
  availableMB?: boolean;
  availableMA?: boolean;
}

export interface LegalityDiff {
  added?: string[];
  removed?: string[];
  addedMegas?: string[];
}

export interface RegulationsFile {
  currentRegulation?: string;
  generatedAt?: string;
  currentRegulationWindow: { start?: string; end?: string; source?: string } | null;
  nextRegulation: { id?: string | null; announced?: boolean; expectedStart?: string; sources?: string[] } | null;
  regulations: RegulationInfo[];
  season2027: SeasonEvent[];
  battleRules: Record<string, unknown> | null;
  itemsAvailability: ItemAvailability[];
  /** Diferenças de legalidade entre regulações, ex.: { "M-B→M-C": {...} }. */
  legalityDiffs: { from: string; to: string; diff: LegalityDiff }[];
  gameVersion?: string;
}

export interface AppData {
  dex: Dex;
  meta: Meta;
  heuristics: Heuristics;
  patches: PatchesFile | null;
  regulations: RegulationsFile | null;
}

export const REQUIRED_FILES = ['dex', 'meta', 'heuristics'] as const;
export const OPTIONAL_FILES = ['patches', 'regulations'] as const;

export class DataLoadError extends Error {
  readonly failed: { file: string; reason: string }[];
  constructor(failed: { file: string; reason: string }[]) {
    super(`Falha ao carregar: ${failed.map(f => f.file).join(', ')}`);
    this.failed = failed;
  }
}

const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}.json`;

async function fetchJson(file: string): Promise<unknown> {
  const res = await fetch(dataUrl(file), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('JSON inválido');
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

function checkDex(v: unknown): Dex {
  if (!isObj(v) || !isObj(v.species) || !isObj(v.moves) || !isObj(v.items) || !isObj(v.typechart)) throw new Error('formato inesperado');
  const dex = v as unknown as Dex;
  return { ...dex, formats: arr(dex.formats), changes: arr(dex.changes), natures: dex.natures ?? {}, abilities: dex.abilities ?? {} };
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strList = (v: unknown): string[] => arr(v).filter((s): s is string => typeof s === 'string' && !!s);

/** Lista de { id, name, share } sem entradas quebradas. */
function shares<T extends Share>(v: unknown): T[] {
  return arr<Record<string, unknown>>(v)
    .filter(s => isObj(s) && typeof s.id === 'string' && !!s.id)
    .map(s => ({ ...s, id: s.id as string, name: typeof s.name === 'string' && s.name ? s.name : (s.id as string), share: num(s.share) }) as unknown as T);
}

function checkMetaPokemon(key: string, v: unknown, index: number): MetaPokemon | null {
  if (!isObj(v)) return null;
  const id = str(v.id) ?? key;
  const trend = isObj(v.trend) && Number.isFinite(v.trend.recent) && Number.isFinite(v.trend.previous)
    ? { recent: v.trend.recent as number, previous: v.trend.previous as number }
    : null;
  return {
    ...(v as unknown as MetaPokemon),
    id,
    name: str(v.name) ?? id,
    usage: num(v.usage),
    rank: num(v.rank, index + 1),
    winRate: numOrNull(v.winRate),
    games: num(v.games),
    rawWinRate: numOrNull(v.rawWinRate),
    topCutRate: numOrNull(v.topCutRate),
    moves: shares(v.moves),
    items: shares(v.items),
    abilities: shares(v.abilities),
    spreads: arr<Record<string, unknown>>(v.spreads)
      .filter(s => isObj(s) && typeof s.nature === 'string' && isObj(s.sp))
      .map(s => ({ nature: s.nature as string, sp: s.sp as unknown as StatsTable, share: num(s.share) })),
    teammates: shares(v.teammates),
    trend,
    sources: strList(v.sources),
  };
}

function checkEvent(v: unknown): TournamentEvent | null {
  if (!isObj(v)) return null;
  const id = str(v.id) ?? str(v.name);
  if (!id) return null;
  const teams = arr<Record<string, unknown>>(v.teams)
    .filter(isObj)
    .map(t => ({
      ...(t as unknown as TournamentTeam),
      player: str(t.player) ?? '—',
      placing: numOrNull(t.placing),
      record: isObj(t.record) ? { wins: num(t.record.wins), losses: num(t.record.losses), ties: num(t.record.ties) } : null,
      pokemon: arr<Record<string, unknown>>(t.pokemon)
        .filter(p => isObj(p) && typeof p.species === 'string' && !!p.species)
        .map(p => ({ ...(p as unknown as TournamentTeamMember), moves: strList(p.moves) })),
    }));
  return {
    ...(v as unknown as TournamentEvent),
    id,
    name: str(v.name) ?? id,
    date: str(v.date) ?? '',
    regulation: str(v.regulation) ?? '',
    game: str(v.game) ?? 'Champions',
    tier: str(v.tier) ?? 'online',
    players: numOrNull(v.players),
    teams,
  };
}

/** Valida meta.json campo a campo (entradas quebradas são descartadas ou completadas). */
export function checkMeta(v: unknown): Meta {
  if (!isObj(v)) throw new Error('formato inesperado');
  const m = v as unknown as Partial<Meta>;
  const pokemon: Meta['pokemon'] = {};
  if (isObj(m.pokemon)) {
    Object.entries(m.pokemon).forEach(([key, p], i) => {
      const clean = checkMetaPokemon(key, p, i);
      if (clean) pokemon[key] = clean;
    });
  }
  return {
    version: num(m.version, 1),
    generatedAt: str(m.generatedAt) ?? '',
    regulation: str(m.regulation) ?? '',
    formatId: str(m.formatId) ?? '',
    halfLifeDays: num(m.halfLifeDays, 60),
    sources: arr<Record<string, unknown>>(m.sources)
      .filter(s => isObj(s) && typeof s.label === 'string')
      .map(s => ({ ...(s as unknown as MetaSource), id: str(s.id) ?? (s.label as string), kind: (str(s.kind) ?? 'usage') as MetaSource['kind'], regulation: str(s.regulation) ?? '', samples: num(s.samples), weight: num(s.weight), fetchedAt: str(s.fetchedAt) ?? '' })),
    pokemon,
    cores: arr<Record<string, unknown>>(m.cores)
      .filter(c => isObj(c) && strList(c.members).length > 0)
      .map(c => ({ members: strList(c.members), usage: num(c.usage), winRate: numOrNull(c.winRate), games: num(c.games) })),
    archetypes: arr<Record<string, unknown>>(m.archetypes)
      .filter(a => isObj(a) && (typeof a.id === 'string' || typeof a.name === 'string'))
      .map(a => ({
        ...(a as unknown as MetaArchetype),
        id: str(a.id) ?? (a.name as string),
        name: str(a.name) ?? (a.id as string),
        namePt: str(a.namePt) ?? str(a.name) ?? (a.id as string),
        keyMembers: strList(a.keyMembers),
        share: numOrNull(a.share),
        description: str(a.description) ?? '',
        winRate: numOrNull(a.winRate),
        games: numOrNull(a.games),
      })),
    events: arr(m.events).map(checkEvent).filter((e): e is TournamentEvent => !!e),
    notes: strList(m.notes),
  };
}

function checkHeuristics(v: unknown): Heuristics {
  if (!isObj(v)) throw new Error('formato inesperado');
  const h = v as unknown as Partial<Heuristics>;
  return {
    version: h.version ?? 1,
    roles: arr(h.roles),
    archetypes: arr(h.archetypes),
    abilityImmunities: arr(h.abilityImmunities),
    pairSynergies: arr(h.pairSynergies),
    moveHeuristics: arr(h.moveHeuristics),
    spreadPrinciples: arr(h.spreadPrinciples),
    itemHeuristics: arr(h.itemHeuristics),
  };
}

const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const textOrList = (v: unknown): string | string[] | undefined => (typeof v === 'string' ? v : Array.isArray(v) ? strList(v) : undefined);
const objList = (v: unknown): Record<string, unknown>[] => arr<Record<string, unknown>>(v).filter(isObj);

function checkChange(v: Record<string, unknown>): PatchChange {
  return {
    ...v,
    kind: str(v.kind), name: str(v.name), id: str(v.id), field: str(v.field), from: v.from, to: v.to,
    direction: str(v.direction), notePt: str(v.notePt), source: str(v.source),
  };
}

const sourceList = (v: unknown): PatchVersion['sources'] =>
  arr(v)
    .filter(s => typeof s === 'string' || isObj(s))
    .map(s => (typeof s === 'string' ? s : { label: str((s as Record<string, unknown>).label), url: str((s as Record<string, unknown>).url) }));

/** Valida patches.json (curado): campos com tipo errado viram ausentes em vez de quebrar a aba. */
export function checkPatches(v: unknown): PatchesFile | null {
  if (!isObj(v)) return null;
  const meta = isObj(v.meta) ? v.meta : null;
  return {
    meta: meta
      ? {
          generatedAt: str(meta.generatedAt), showdownCommit: str(meta.showdownCommit), currentRegulation: str(meta.currentRegulation),
          currentGameVersion: str(meta.currentGameVersion), ppFormula: str(meta.ppFormula), notePt: str(meta.notePt),
        }
      : null,
    versions: objList(v.versions).map(p => ({
      ...p,
      version: str(p.version) ?? (typeof p.version === 'number' ? String(p.version) : undefined),
      date: str(p.date),
      regulation: str(p.regulation),
      sources: sourceList(p.sources),
      changes: objList(p.changes).map(checkChange),
      notesPt: textOrList(p.notesPt),
    })),
    championsVsSV: objList(v.championsVsSV).filter(c => !!str(c.name) || !!str(c.notePt)).map(checkChange),
    unavailableButDataChanged: objList(v.unavailableButDataChanged).map(checkChange),
    simulatorFixes: objList(v.simulatorFixes).map(f => ({ commit: str(f.commit), date: str(f.date), notePt: str(f.notePt), source: str(f.source) })),
    gaps: strList(v.gaps),
  };
}

/** Valida regulations.json (curado) com a mesma tolerância. */
export function checkRegulations(v: unknown): RegulationsFile | null {
  if (!isObj(v)) return null;
  // legalityDiffMBtoMC, legalityDiffMAtoMB...
  const legalityDiffs: RegulationsFile['legalityDiffs'] = [];
  for (const [key, val] of Object.entries(v)) {
    const m = /^legalityDiff([A-Z]{1,2})([A-Z]{1,2})to([A-Z]{1,2})([A-Z]{1,2})$/.exec(key);
    if (m && isObj(val)) {
      legalityDiffs.push({
        from: `${m[1]}-${m[2]}`,
        to: `${m[3]}-${m[4]}`,
        diff: { added: strList(val.added), removed: strList(val.removed), addedMegas: strList(val.addedMegas) },
      });
    }
  }
  legalityDiffs.sort((a, b) => b.to.localeCompare(a.to));
  const game = isObj(v.game) ? v.game : null;
  const versions = game ? objList(game.gameVersions) : [];
  const win = isObj(v.currentRegulationWindow) ? v.currentRegulationWindow : null;
  const next = isObj(v.nextRegulation) ? v.nextRegulation : null;
  return {
    currentRegulation: str(v.currentRegulation),
    generatedAt: str(v.generatedAt),
    currentRegulationWindow: win ? { start: str(win.start), end: str(win.end), source: str(win.source) } : null,
    nextRegulation: next
      ? { id: str(next.id) ?? null, announced: bool(next.announced), expectedStart: str(next.expectedStart), sources: strList(next.sources) }
      : null,
    regulations: objList(v.regulations).map(r => ({
      ...r,
      id: str(r.id),
      name: str(r.name),
      start: str(r.start),
      end: str(r.end) ?? null,
      notes: textOrList(r.notes),
      rankedSeasons: objList(r.rankedSeasons).map(s => ({ season: str(s.season) ?? (typeof s.season === 'number' ? String(s.season) : undefined), start: str(s.start) ?? null, end: str(s.end) ?? null })),
      events: objList(r.events).map(e => ({ event: str(e.event), date: str(e.date) })),
      showdownFormatId: str(r.showdownFormatId),
      sources: strList(r.sources),
    })),
    season2027: objList(v.season2027).map(e => ({
      event: str(e.event), location: str(e.location), date: str(e.date), regulation: str(e.regulation), status: str(e.status), source: str(e.source),
    })),
    battleRules: isObj(v.battleRules)
      ? {
          ...v.battleRules,
          clauses: objList(v.battleRules.clauses).filter(c => !!str(c.clause)).map(c => ({ clause: str(c.clause), source: str(c.source) })),
          sources: strList(v.battleRules.sources),
        }
      : null,
    itemsAvailability: objList(v.itemsAvailability)
      .filter(i => typeof i.item === 'string' && !!i.item)
      .map(i => ({ item: i.item as string, available: bool(i.available), availableMB: bool(i.availableMB), availableMA: bool(i.availableMA) })),
    legalityDiffs,
    gameVersion: versions.length ? str(versions[versions.length - 1]?.version) : undefined,
  };
}

export async function loadAppData(): Promise<AppData> {
  const failed: { file: string; reason: string }[] = [];
  const required = async <T>(file: string, check: (v: unknown) => T): Promise<T | null> => {
    try {
      return check(await fetchJson(file));
    } catch (err) {
      failed.push({ file: `${file}.json`, reason: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };
  const optional = async <T>(file: string, check: (v: unknown) => T | null): Promise<T | null> => {
    try {
      return check(await fetchJson(file));
    } catch {
      return null;
    }
  };
  const [dex, meta, heuristics, patches, regulations] = await Promise.all([
    required('dex', checkDex),
    required('meta', checkMeta),
    required('heuristics', checkHeuristics),
    optional('patches', checkPatches),
    optional('regulations', checkRegulations),
  ]);
  if (!dex || !meta || !heuristics) throw new DataLoadError(failed);
  return { dex, meta, heuristics, patches, regulations };
}
