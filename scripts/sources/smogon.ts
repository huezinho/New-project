/**
 * Smogon usage stats (ladder do Pokémon Showdown), publicados mensalmente em
 * https://www.smogon.com/stats/<AAAA-MM>/chaos/<formato>-<corte>.json
 */
import { fetchJson, fetchText } from '../lib/http.ts';
import type { UsageEntry, UsageSnapshot } from '../lib/records.ts';

const BASE = 'https://www.smogon.com/stats';
const CUTOFFS = [1760, 1630, 1500, 0];

interface ChaosEntry {
  'Raw count'?: number;
  usage?: number;
  Abilities?: Record<string, number>;
  Items?: Record<string, number>;
  Spreads?: Record<string, number>;
  Moves?: Record<string, number>;
  Teammates?: Record<string, number>;
}

export interface ChaosFile {
  info: { metagame?: string; cutoff?: number; 'number of battles'?: number };
  data: Record<string, ChaosEntry>;
}

/** Lista as pastas de mês disponíveis (ex.: "2026-09", "2026-09-H1"). */
export async function listMonths(): Promise<string[]> {
  const html = await fetchText(`${BASE}/`);
  if (!html) return [];
  const months = new Set<string>();
  for (const m of html.matchAll(/href="(\d{4}-\d{2}(?:-H[12])?)\/"/g)) months.add(m[1]);
  // Se existir o mês completo, ignora as quinzenas (H1/H2) do mesmo mês para não contar duas vezes.
  return [...months].filter(m => !/-H[12]$/.test(m) || !months.has(m.slice(0, 7))).sort();
}

async function listChaosFiles(month: string): Promise<string[]> {
  const html = await fetchText(`${BASE}/${month}/chaos/`, { allow404: true });
  if (!html) return [];
  return [...html.matchAll(/href="([^"]+\.json)"/g)].map(m => m[1]);
}

const sumValues = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

function normalize(o: Record<string, number> | undefined, total: number, drop: string[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  if (!o || total <= 0) return out;
  for (const [k, v] of Object.entries(o)) {
    if (!k || drop.includes(k) || v <= 0) continue;
    out[k] = v / total;
  }
  return out;
}

/** Converte um arquivo chaos em snapshot normalizado (frações 0-1). */
export function chaosToSnapshot(chaos: ChaosFile, meta: { month: string; regulation: string; formatId: string; cutoff: number; url?: string }): UsageSnapshot {
  const pokemon: Record<string, UsageEntry> = {};
  for (const [name, entry] of Object.entries(chaos.data)) {
    const count = sumValues(entry.Abilities) || sumValues(entry.Items) || 0;
    if (!count || !entry.usage) continue;
    pokemon[name] = {
      usage: entry.usage,
      rawCount: entry['Raw count'],
      abilities: normalize(entry.Abilities, count),
      items: normalize(entry.Items, count, ['nothing']),
      moves: normalize(entry.Moves, count),
      spreads: normalize(entry.Spreads, count),
      teammates: normalize(entry.Teammates, count, [name]),
    };
  }
  const [year, mon] = meta.month.split('-').map(Number);
  const mid = new Date(Date.UTC(year, mon - 1, meta.month.endsWith('H1') ? 8 : meta.month.endsWith('H2') ? 23 : 15));
  return {
    source: `smogon:${meta.formatId}:${meta.month}:${meta.cutoff}`,
    sourceKind: 'ladder',
    label: `Smogon ${meta.month} ${meta.formatId} (${meta.cutoff}+)`,
    url: meta.url,
    date: mid.toISOString().slice(0, 10),
    period: meta.month,
    regulation: meta.regulation,
    cutoff: meta.cutoff,
    battles: chaos.info['number of battles'] ?? 0,
    dedupeKey: `${meta.formatId}:${meta.month}`,
    pokemon,
  };
}

/**
 * Baixa os últimos `months` meses de cada formato pedido, usando o maior
 * corte de rating disponível.
 */
export async function fetchSmogonSnapshots(
  formats: { id: string; regulation: string }[],
  options: { months?: number; log?: (msg: string) => void } = {},
): Promise<UsageSnapshot[]> {
  const log = options.log ?? console.log;
  const months = (await listMonths()).slice(-(options.months ?? 6));
  const snapshots: UsageSnapshot[] = [];
  for (const month of months) {
    let files: string[] = [];
    try {
      files = await listChaosFiles(month);
    } catch (err) {
      log(`[smogon] falha ao listar ${month}: ${(err as Error).message}`);
      continue;
    }
    for (const f of formats) {
      const cutoff = CUTOFFS.find(c => files.includes(`${f.id}-${c}.json`));
      if (cutoff === undefined) continue;
      const url = `${BASE}/${month}/chaos/${f.id}-${cutoff}.json`;
      try {
        const chaos = await fetchJson<ChaosFile>(url, { timeoutMs: 120_000 });
        if (!chaos?.data) continue;
        const snap = chaosToSnapshot(chaos, { month, regulation: f.regulation, formatId: f.id, cutoff, url });
        log(`[smogon] ${month} ${f.id}-${cutoff}: ${snap.battles} batalhas, ${Object.keys(snap.pokemon).length} Pokémon`);
        snapshots.push(snap);
      } catch (err) {
        log(`[smogon] falha em ${url}: ${(err as Error).message}`);
      }
    }
  }
  return snapshots;
}
