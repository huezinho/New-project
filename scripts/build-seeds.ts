/**
 * Regenera os dados semente (data/seed/) a partir dos espelhos públicos no
 * GitHub, que não dependem de smogon.com / limitlesstcg.com estarem no ar:
 *
 *   data/seed/meta_seed.json            snapshots de uso (Smogon) + arquétipos
 *   data/seed/tournaments_seed.json.gz  times com resultado (RK9 oficiais + Limitless)
 *
 * Uso: npm run build:seeds [-- --since=2025-09-01 --months=3]
 * Os arquétipos (descrições em pt-BR) são mantidos do meta_seed.json atual.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fetchLimitlessMirrorRecords, fetchRk9MirrorRecords, fetchSmogonMirrorSnapshots } from './sources/mirrors.ts';
import type { MetaSeed } from './sources/seeds.ts';
import type { UsageEntry, UsageSnapshot } from './lib/records.ts';
import type { Dex } from '../src/core/types.ts';

const ROOT = process.cwd();

/** Mantém só o topo de cada distribuição para o seed ficar pequeno. */
function top(o: Record<string, number>, n: number, min = 0): Record<string, number> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]).slice(0, n));
}
function trim(s: UsageSnapshot): UsageSnapshot {
  const pokemon: Record<string, UsageEntry> = {};
  for (const [name, e] of Object.entries(s.pokemon)) {
    pokemon[name] = {
      usage: e.usage,
      rawCount: e.rawCount,
      moves: top(e.moves, 20, 0.005),
      items: top(e.items, 12, 0.005),
      abilities: top(e.abilities, 4, 0.002),
      spreads: top(e.spreads, 25, 0.004),
      teammates: top(e.teammates, 25, 0.01),
    };
  }
  return { ...s, pokemon };
}
const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

async function main() {
  const dex = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'dex.json'), 'utf8')) as Dex;
  const since = arg('since', '2025-09-01');
  const months = Number(arg('months', '3'));
  const dir = join(ROOT, 'data', 'seed');
  mkdirSync(dir, { recursive: true });

  const formats = dex.formats.flatMap(f => [{ id: f.id, regulation: f.regulation }, ...(f.bo3Id ? [{ id: f.bo3Id, regulation: f.regulation }] : [])]);
  const formatMap = Object.fromEntries(formats.map(f => [f.id, f.regulation]));

  const snapshots = await fetchSmogonMirrorSnapshots(formats, { months, minUsage: 0.003 });
  const rk9 = await fetchRk9MirrorRecords({ formats: formatMap, since, includeSV: true });
  const limitless = await fetchLimitlessMirrorRecords(dex.currentRegulation, { minPlayers: 32 });

  const metaPath = join(dir, 'meta_seed.json');
  const previous = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, 'utf8')) as MetaSeed)
    : existsSync(`${metaPath}.gz`) ? (JSON.parse(gunzipSync(readFileSync(`${metaPath}.gz`)).toString('utf8')) as MetaSeed) : null;
  const today = new Date().toISOString().slice(0, 10);
  const metaSeed: MetaSeed = {
    snapshotDate: today,
    usageSnapshots: snapshots.map(s => trim({ ...s, sourceKind: 'seed' as const, source: `seed:${s.source}` })),
    archetypes: previous?.archetypes ?? [],
  };
  writeFileSync(`${metaPath}.gz`, gzipSync(JSON.stringify(metaSeed), { level: 9 }));
  if (existsSync(metaPath)) rmSync(metaPath);

  const events = [...new Map(rk9.events.map(e => [e.id, e])).values()];
  const limitlessEvents = new Map<string, (typeof events)[number]>();
  for (const r of limitless) {
    if (!r.eventId || limitlessEvents.has(r.eventId)) continue;
    limitlessEvents.set(r.eventId, {
      id: r.eventId, name: r.eventName ?? r.eventId, date: r.date, tier: 'online', players: r.players ?? null,
      url: `https://play.limitlesstcg.com/tournament/${r.eventId.replace('limitless-', '')}/standings`, game: 'Champions', regulation: r.regulation,
    });
  }
  const records = [...rk9.records, ...limitless].map(r => ({ ...r, source: `seed:${r.source}` }));
  const tournaments = { generatedAt: today, events: [...events, ...limitlessEvents.values()], records };
  writeFileSync(join(dir, 'tournaments_seed.json.gz'), gzipSync(JSON.stringify(tournaments), { level: 9 }));

  console.log(`[seeds] ${snapshots.length} snapshots de uso, ${events.length} eventos oficiais (${rk9.records.length} times), ` +
    `${limitlessEvents.size} torneios online (${limitless.length} times) -> ${dir}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
