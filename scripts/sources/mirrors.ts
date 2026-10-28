/**
 * Espelhos públicos no GitHub, usados como fonte extra e como alternativa
 * quando os sites originais estão fora do ar:
 *
 *  - MunchStats (github.com/PizzaTimeJoshua/munchstats)
 *      main:            stats/tournaments/<id>/  -> team lists oficiais da RK9 (Regionais, Internacionais, Mundial)
 *                       stats/<mês>/<formato>/<corte>/ -> Smogon chaos dividido por Pokémon
 *      limitless-data:  app/teams/<REG>.json.gz  -> times + campanhas do Limitless (janela de 30 dias)
 *
 * Créditos: "Data from Limitless TCG", RK9 Labs e Smogon, via MunchStats.
 */
import { gunzipSync } from 'node:zlib';
import { fetchJson, fetchText } from '../lib/http.ts';
import type { EventInfo } from '../lib/aggregate.ts';
import type { RecordMember, TeamRecord, UsageSnapshot } from '../lib/records.ts';
import { chaosToSnapshot, type ChaosFile } from './smogon.ts';

const REPO = 'PizzaTimeJoshua/munchstats';
const RAW = `https://raw.githubusercontent.com/${REPO}`;

async function fetchBinary(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: { 'User-Agent': 'champions-vgc-builder' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ------------------------- RK9 (torneios oficiais) ------------------------- */

interface Rk9Metadata { id: string; name: string; date: string; type: string; total_players: number; format?: string }
interface Rk9Player {
  name: string;
  country?: string;
  placement?: number | null;
  record?: { wins: number; losses: number; ties?: number };
  team?: { pokemon: string; item?: string; ability?: string; nature?: string; moves?: string[] }[];
}

interface Rk9IndexEntry extends Rk9Metadata { day2_count?: number; day2_cutoff_standing?: number }

/** Regulação a partir do id de formato do Showdown (Champions ou Scarlet/Violet). */
export function regulationFromFormat(format: string | undefined, champions: Record<string, string>): { regulation: string; game: string } | null {
  if (!format) return null;
  if (champions[format]) return { regulation: champions[format], game: 'Champions' };
  const champ = /^gen9championsvgc\d{4}reg([a-z])([a-z])$/.exec(format);
  if (champ) return { regulation: `${champ[1].toUpperCase()}-${champ[2].toUpperCase()}`, game: 'Champions' };
  const sv = /^gen9vgc\d{4}reg([a-z])$/.exec(format);
  if (sv) return { regulation: `SV-${sv[1].toUpperCase()}`, game: 'SV' };
  return null;
}

export async function fetchRk9MirrorRecords(options: {
  formats: Record<string, string>; // formatId -> regulação
  since: string;
  /** Inclui eventos da era Scarlet/Violet (peso baixo; só jogadores do Dia 2). */
  includeSV?: boolean;
  log?: (msg: string) => void;
}): Promise<{ records: TeamRecord[]; events: EventInfo[] }> {
  const log = options.log ?? console.log;
  const records: TeamRecord[] = [];
  const events: EventInfo[] = [];
  const index = (await fetchJson<Rk9IndexEntry[]>(`${RAW}/main/stats/tournaments/tournaments_index.json`, { allow404: true })) ?? [];
  for (const md of index) {
    if (md.date < options.since) continue;
    const reg = regulationFromFormat(md.format, options.formats);
    if (!reg || (reg.game === 'SV' && options.includeSV === false)) continue;
    try {
      const raw = await fetchJson<Rk9Player[] | { players: Rk9Player[] }>(`${RAW}/main/stats/tournaments/${md.id}/players.json`, { timeoutMs: 120_000 });
      let players = Array.isArray(raw) ? raw : raw?.players ?? [];
      const day2 = md.day2_count ?? md.day2_cutoff_standing;
      if (reg.game === 'SV' && day2) players = players.filter(p => (p.placement ?? 9999) <= day2);
      const tier = md.type === 'Worlds' ? 'worlds' : /international/i.test(md.type) ? 'international' : /special/i.test(md.type) ? 'special' : 'regional';
      const eventId = `rk9-${md.id}`;
      const name = md.name.replace('Pokémon VGC ', '').replace('Championships', 'Championship');
      events.push({ id: eventId, name, date: md.date, tier, players: md.total_players, url: `https://rk9.gg/tournament/${md.id}`, game: reg.game, regulation: reg.regulation });
      let n = 0;
      for (const p of players) {
        const pokemon: RecordMember[] = (p.team ?? []).map(m => ({ species: m.pokemon, item: m.item || null, ability: m.ability || null, moves: m.moves ?? [], nature: m.nature || null }));
        if (pokemon.length < 4) continue;
        n++;
        records.push({
          source: `rk9:${md.id}`,
          sourceKind: 'official',
          eventId,
          eventName: name,
          date: md.date,
          regulation: reg.regulation,
          game: reg.game,
          player: p.name,
          placing: p.placement ?? null,
          players: md.total_players,
          wins: p.record?.wins ?? null,
          losses: p.record?.losses ?? null,
          ties: p.record?.ties ?? 0,
          pokemon,
        });
      }
      log(`[rk9] ${name} (${md.date}, ${reg.regulation}, ${md.total_players} jogadores): ${n} team lists`);
    } catch (err) {
      log(`[rk9] falha em ${md.id}: ${(err as Error).message}`);
    }
  }
  return { records, events };
}

/* ------------------------- Limitless (espelho) ------------------------- */

interface LimitlessTeamsFile {
  events: { id: string; name: string; date: string; players: number }[];
  sets: [string, string, string, string, string, string[]][];
  runs: [number, number | null, string, [number, number, number], number[], string][];
}

export async function fetchLimitlessMirrorRecords(regulation: string, options: { minPlayers?: number; log?: (msg: string) => void } = {}): Promise<TeamRecord[]> {
  const log = options.log ?? console.log;
  const buf = await fetchBinary(`${RAW}/limitless-data/app/teams/${regulation}.json.gz`);
  if (!buf) return [];
  const file = JSON.parse(gunzipSync(buf).toString('utf8')) as LimitlessTeamsFile;
  const records: TeamRecord[] = [];
  for (const [eventIdx, placing, player, rec, setIdx] of file.runs) {
    const ev = file.events[eventIdx];
    if (!ev || (ev.players ?? 0) < (options.minPlayers ?? 16)) continue;
    const pokemon: RecordMember[] = setIdx.map(i => {
      const [species, item, ability, , nature, moves] = file.sets[i];
      return { species, item: item || null, ability: ability || null, moves, nature: nature || null };
    });
    if (pokemon.length < 4) continue;
    records.push({
      source: `limitless-mirror:${ev.id}`,
      sourceKind: 'online',
      eventId: `limitless-${ev.id}`,
      eventName: ev.name,
      date: ev.date.slice(0, 10),
      regulation,
      player,
      placing,
      players: ev.players,
      wins: rec[0],
      losses: rec[1],
      ties: rec[2],
      pokemon,
    });
  }
  log(`[limitless-espelho] ${regulation}: ${records.length} times de ${file.events.length} torneios (30 dias)`);
  return records;
}

/* --------------------- Smogon stats (espelho dividido) --------------------- */

interface SplitIndex { info: ChaosFile['info']; pokemon: Record<string, { usage: number; raw: number }> }

export async function fetchSmogonMirrorSnapshots(
  formats: { id: string; regulation: string }[],
  options: { months?: number; minUsage?: number; now?: Date; log?: (msg: string) => void } = {},
): Promise<UsageSnapshot[]> {
  const log = options.log ?? console.log;
  // Meses recentes calculados a partir de hoje (dispensa a API do GitHub). Os stats de um
  // mês só saem depois que ele acaba, então a janela começa no mês anterior ao atual.
  const months: string[] = [];
  const now = options.now ?? new Date();
  for (let i = (options.months ?? 3); i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const out: UsageSnapshot[] = [];
  for (const month of months) {
    for (const f of formats) {
      for (const cutoff of [1760, 1630, 1500, 0]) {
        const base = `${RAW}/main/stats/${month}/${f.id}/${cutoff}`;
        try {
          const index = await fetchJson<SplitIndex>(`${base}/_index.json`, { allow404: true, retries: 1 });
          if (!index) continue;
          const chaos: ChaosFile = { info: index.info, data: {} };
          const names = Object.entries(index.pokemon).filter(([, v]) => v.usage >= (options.minUsage ?? 0.005)).map(([k]) => k);
          for (const name of names) {
            const text = await fetchText(`${base}/${encodeURIComponent(name)}.json`, { allow404: true, retries: 1, minIntervalMs: 100 });
            if (text) chaos.data[name] = { ...JSON.parse(text), usage: index.pokemon[name].usage };
          }
          const snap = chaosToSnapshot(chaos, { month, regulation: f.regulation, formatId: f.id, cutoff, url: `https://www.smogon.com/stats/${month}/chaos/${f.id}-${cutoff}.json` });
          snap.label += ' (espelho MunchStats)';
          log(`[smogon-espelho] ${month} ${f.id}-${cutoff}: ${snap.battles} batalhas, ${Object.keys(snap.pokemon).length} Pokémon`);
          out.push(snap);
        } catch (err) {
          // Falha num mês/formato não derruba os demais; um snapshot incompleto não é usado
          // (o seed do mesmo mês continua valendo).
          log(`[smogon-espelho] falha em ${month} ${f.id}-${cutoff}: ${(err as Error).message}`);
        }
        break;
      }
    }
  }
  return out;
}
