/**
 * Carregamento dos arquivos de public/data. dex/meta/heuristics são
 * obrigatórios; patches e regulations são opcionais (404 ou campos
 * ausentes são tolerados).
 */
import type { Heuristics } from '../core/api.ts';
import type { Dex, Meta } from '../core/types.ts';

export interface PatchChange {
  kind?: string;
  name?: string;
  field?: string;
  from?: unknown;
  to?: unknown;
  direction?: 'buff' | 'nerf' | 'change' | string;
  notePt?: string;
}

export interface PatchVersion {
  version?: string;
  date?: string;
  regulation?: string;
  sources?: (string | { label?: string; url?: string })[];
  changes?: PatchChange[];
  notesPt?: string | string[];
}

export interface PatchesFile {
  versions: PatchVersion[];
  championsVsSV: unknown[];
}

export interface RegulationInfo {
  id?: string;
  name?: string;
  start?: string;
  end?: string | null;
  notes?: string | string[];
}

export interface SeasonEvent {
  event?: string;
  location?: string;
  date?: string;
  regulation?: string;
}

export interface RegulationsFile {
  currentRegulation?: string;
  regulations: RegulationInfo[];
  season2027: SeasonEvent[];
  battleRules: Record<string, unknown> | null;
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

function checkDex(v: unknown): Dex {
  if (!isObj(v) || !isObj(v.species) || !isObj(v.moves) || !isObj(v.items) || !isObj(v.typechart)) throw new Error('formato inesperado');
  const dex = v as unknown as Dex;
  return { ...dex, formats: arr(dex.formats), changes: arr(dex.changes), natures: dex.natures ?? {}, abilities: dex.abilities ?? {} };
}

function checkMeta(v: unknown): Meta {
  if (!isObj(v)) throw new Error('formato inesperado');
  const m = v as unknown as Partial<Meta>;
  return {
    version: m.version ?? 1,
    generatedAt: m.generatedAt ?? '',
    regulation: m.regulation ?? '',
    formatId: m.formatId ?? '',
    halfLifeDays: m.halfLifeDays ?? 60,
    sources: arr(m.sources),
    pokemon: isObj(m.pokemon) ? (m.pokemon as Meta['pokemon']) : {},
    cores: arr(m.cores),
    archetypes: arr(m.archetypes),
    events: arr<Meta['events'][number]>(m.events).map(e => ({ ...e, teams: arr(e.teams) })),
    notes: arr(m.notes),
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

function checkPatches(v: unknown): PatchesFile | null {
  if (!isObj(v)) return null;
  return { versions: arr(v.versions), championsVsSV: arr(v.championsVsSV) };
}

function checkRegulations(v: unknown): RegulationsFile | null {
  if (!isObj(v)) return null;
  return {
    currentRegulation: typeof v.currentRegulation === 'string' ? v.currentRegulation : undefined,
    regulations: arr(v.regulations),
    season2027: arr(v.season2027),
    battleRules: isObj(v.battleRules) ? v.battleRules : null,
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
