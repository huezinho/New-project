/**
 * Atualiza public/data/meta.json combinando seeds, Smogon usage stats,
 * torneios do Limitless e (opcionalmente) replays do Showdown.
 *
 * Opções (argumentos ou variáveis de ambiente):
 *   --months=6         meses de Smogon stats (META_MONTHS)
 *   --since=AAAA-MM-DD torneios a partir desta data (META_SINCE; padrão: 365 dias)
 *   --half-life=60     meia-vida em dias do decaimento temporal (META_HALF_LIFE)
 *   --replays=200      baixa N replays do formato atual (META_REPLAYS; padrão 0)
 *   --offline          usa apenas os seeds locais
 *   LIMITLESS_API_KEY  chave opcional da API do Limitless
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate } from './lib/aggregate.ts';
import type { TeamRecord, UsageSnapshot } from './lib/records.ts';
import { loadMetaSeed, loadPatchEvents, loadTournamentSeed } from './sources/seeds.ts';
import { fetchSmogonSnapshots } from './sources/smogon.ts';
import { fetchLimitlessRecords, type LimitlessTournament } from './sources/limitless.ts';
import { fetchReplayRecords } from './sources/replays.ts';
import { fetchLimitlessMirrorRecords, fetchRk9MirrorRecords, fetchSmogonMirrorSnapshots } from './sources/mirrors.ts';
import type { EventInfo } from './lib/aggregate.ts';
import type { Dex } from '../src/core/types.ts';

const ROOT = process.cwd();
const arg = (name: string, env: string, fallback?: string) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : process.env[env] ?? fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

interface RegulationsFile {
  regulations?: { id: string; start?: string | null; end?: string | null; limitlessFormats?: string[] }[];
}

function regulationOrder(dex: Dex, extra: string[]): string[] {
  const regs = new Set<string>([...dex.formats.map(f => f.regulation), ...extra.filter(r => /^[A-Z]-[A-Z]$/.test(r))]);
  const current = dex.currentRegulation;
  return [current, ...[...regs].filter(r => r !== current).sort().reverse()];
}

async function main() {
  const dexPath = join(ROOT, 'public', 'data', 'dex.json');
  if (!existsSync(dexPath)) throw new Error('public/data/dex.json não existe — rode `npm run update:dex` primeiro.');
  const dex = JSON.parse(readFileSync(dexPath, 'utf8')) as Dex;
  const now = arg('now', 'META_NOW', new Date().toISOString().slice(0, 10))!;
  const offline = flag('offline') || process.env.META_OFFLINE === '1';
  const months = Number(arg('months', 'META_MONTHS', '6'));
  const since = arg('since', 'META_SINCE', new Date(Date.parse(now) - 365 * 86_400_000).toISOString().slice(0, 10))!;
  const halfLife = Number(arg('half-life', 'META_HALF_LIFE', '60'));
  const replays = Number(arg('replays', 'META_REPLAYS', '0'));
  const notes: string[] = [];

  const seedDir = join(ROOT, 'data', 'seed');
  const metaSeed = loadMetaSeed(join(seedDir, 'meta_seed.json'));
  const tournamentSeed = loadTournamentSeed(join(seedDir, 'tournaments_seed.json'));
  const patches = loadPatchEvents(join(ROOT, 'public', 'data', 'patches.json'));
  const regsFile = existsSync(join(ROOT, 'public', 'data', 'regulations.json'))
    ? (JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'regulations.json'), 'utf8')) as RegulationsFile)
    : {};

  const snapshots: UsageSnapshot[] = [...metaSeed.snapshots];
  const records: TeamRecord[] = [...tournamentSeed.records];
  const events: EventInfo[] = [...tournamentSeed.events];
  console.log(`[meta] seeds: ${metaSeed.snapshots.length} snapshots, ${tournamentSeed.records.length} times de torneio; ${patches.length} patches`);

  const formats = dex.formats.flatMap(f => [{ id: f.id, regulation: f.regulation }, ...(f.bo3Id ? [{ id: f.bo3Id, regulation: f.regulation }] : [])]);

  if (!offline) {
    let smogon: UsageSnapshot[] = [];
    try {
      smogon = await fetchSmogonSnapshots(formats, { months });
    } catch (err) {
      console.warn(`[meta] smogon.com indisponível: ${(err as Error).message}`);
    }
    if (!smogon.length) {
      console.warn('[meta] smogon.com sem dados; tentando o espelho no GitHub');
      try {
        smogon = await fetchSmogonMirrorSnapshots(formats, { months: Math.min(months, 3) });
      } catch (err) {
        console.warn(`[meta] espelho da Smogon falhou: ${(err as Error).message}`);
      }
    }
    snapshots.push(...smogon);
    if (!smogon.length) notes.push('Smogon stats indisponível (site e espelho): usando apenas os dados semente de uso do ladder.');

    try {
      const formatMap = Object.fromEntries(formats.map(f => [f.id, f.regulation]));
      const rk9 = await fetchRk9MirrorRecords({ formats: formatMap, since });
      records.push(...rk9.records);
      events.push(...rk9.events);
    } catch (err) {
      notes.push(`Team lists oficiais (RK9 via MunchStats) indisponíveis: ${(err as Error).message}`);
    }

    try {
      const regs = regsFile.regulations ?? [];
      const regulationOf = (t: LimitlessTournament): string | null => {
        const code = (t.format ?? '').toUpperCase();
        for (const r of regs) if (r.limitlessFormats?.some(f => f.toUpperCase() === code)) return r.id;
        const date = t.date.slice(0, 10);
        // Sem código conhecido: usa o intervalo de datas da regulação do Champions.
        for (const r of regs) {
          if (r.start && date >= r.start && (!r.end || date <= r.end) && /champ|^m/i.test(`${t.format ?? ''} ${t.name}`)) return r.id;
        }
        return null;
      };
      const lim = await fetchLimitlessRecords({ since, regulationOf, apiKey: process.env.LIMITLESS_API_KEY });
      records.push(...lim);
      if (!lim.length) notes.push('Limitless: nenhum torneio do Champions com times encontrado no período.');
    } catch (err) {
      notes.push(`API do Limitless indisponível: ${(err as Error).message}`);
      console.warn(`[meta] limitless falhou: ${(err as Error).message}`);
    }
    try {
      // Espelho com janela de 30 dias: completa eventos que a API não trouxe.
      const have = new Set(records.filter(r => !r.source.startsWith('seed:')).map(r => r.eventId));
      const mirror = await fetchLimitlessMirrorRecords(dex.currentRegulation);
      records.push(...mirror.filter(r => !have.has(r.eventId)));
    } catch (err) {
      notes.push(`Espelho do Limitless indisponível: ${(err as Error).message}`);
    }

    if (replays > 0) {
      const current = dex.formats.find(f => f.current)!;
      try {
        records.push(...(await fetchReplayRecords({ id: current.id, regulation: current.regulation }, { limit: replays })));
      } catch (err) {
        notes.push(`Replays do Showdown indisponíveis: ${(err as Error).message}`);
      }
    }
  } else {
    notes.push('Gerado em modo offline (apenas dados semente).');
  }

  // Dados ao vivo substituem os seeds equivalentes (mesmo mês/formato ou mesmo evento).
  const liveKeys = new Set(snapshots.filter(s => s.sourceKind !== 'seed' && s.dedupeKey).map(s => s.dedupeKey));
  const dedupedSnapshots = snapshots.filter(s => s.sourceKind !== 'seed' || !s.dedupeKey || !liveKeys.has(s.dedupeKey));
  const liveEvents = new Set(records.filter(r => !r.source.startsWith('seed:') && r.eventId).map(r => r.eventId));
  const dedupedRecords = records.filter(r => !r.source.startsWith('seed:') || !r.eventId || !liveEvents.has(r.eventId));
  if (dedupedSnapshots.length !== snapshots.length || dedupedRecords.length !== records.length) {
    console.log(`[meta] ${snapshots.length - dedupedSnapshots.length} snapshots e ${records.length - dedupedRecords.length} times dos seeds substituídos por dados ao vivo`);
  }
  snapshots.splice(0, snapshots.length, ...dedupedSnapshots);
  records.splice(0, records.length, ...dedupedRecords);

  const order = regulationOrder(dex, [...snapshots.map(s => s.regulation), ...records.map(r => r.regulation)]);
  const meta = aggregate({
    dex,
    regulation: dex.currentRegulation,
    regulationOrder: order,
    snapshots,
    records,
    patches,
    now,
    halfLifeDays: halfLife,
    archetypes: metaSeed.archetypes,
    events: [...new Map(events.map(e => [e.id, e])).values()],
    notes,
  });

  const out = join(ROOT, 'public', 'data', 'meta.json');
  mkdirSync(join(ROOT, 'public', 'data'), { recursive: true });
  writeFileSync(out, JSON.stringify(meta));
  const top = Object.values(meta.pokemon).sort((a, b) => a.rank - b.rank).slice(0, 10);
  console.log(`[meta] ${Object.keys(meta.pokemon).length} Pokémon, ${meta.cores.length} cores, ${meta.events.length} eventos, ${meta.sources.length} fontes -> ${out}`);
  console.log(`[meta] top 10: ${top.map(p => `${p.name} ${(p.usage * 100).toFixed(1)}%`).join(', ')}`);
  for (const n of meta.notes) console.log(`[meta] nota: ${n}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
