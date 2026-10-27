/**
 * Replays públicos do Pokémon Showdown. Formatos VGC do Champions usam Open
 * Team Sheets, então o log traz `|showteam|` com os sets completos, além do
 * vencedor (`|win|`) — permitindo calcular taxa de vitória por Pokémon/set.
 */
import { fetchJson } from '../lib/http.ts';
import type { RecordMember, TeamRecord } from '../lib/records.ts';

const BASE = 'https://replay.pokemonshowdown.com';

interface ReplaySearchEntry {
  id: string;
  uploadtime: number;
  format?: string;
  players?: string[];
  rating?: number | null;
  private?: number;
}

interface ReplayData {
  id: string;
  log: string;
  uploadtime: number;
  rating?: number | null;
  players?: string[];
}

const unpackName = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1 $2').trim();

/** Lê um time empacotado do Showdown (formato de `|showteam|`). */
export function parsePackedTeam(packed: string): RecordMember[] {
  const out: RecordMember[] = [];
  for (const chunk of packed.split(']')) {
    if (!chunk) continue;
    const f = chunk.split('|');
    const species = f[1] || f[0];
    if (!species) continue;
    const evs = (f[6] ?? '').split(',');
    const statKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
    const sp: Record<string, number> = {};
    statKeys.forEach((k, i) => {
      if (evs[i]) sp[k] = Number(evs[i]) || 0;
    });
    out.push({
      species: unpackName(species),
      item: f[2] ? unpackName(f[2]) : null,
      // "" / "1" / "H" referem-se aos slots da espécie; resolvidos na agregação.
      ability: f[3] ?? null,
      moves: (f[4] ?? '').split(',').filter(Boolean).map(unpackName),
      nature: f[5] || null,
      sp: Object.keys(sp).length ? sp : null,
    });
  }
  return out;
}

export interface ParsedReplay {
  players: Record<'p1' | 'p2', string>;
  teams: Record<'p1' | 'p2', RecordMember[]>;
  winner: 'p1' | 'p2' | null;
  rating: number | null;
}

export function parseReplayLog(log: string): ParsedReplay {
  const players = { p1: '', p2: '' };
  const preview: Record<'p1' | 'p2', RecordMember[]> = { p1: [], p2: [] };
  const sheets: Record<'p1' | 'p2', RecordMember[]> = { p1: [], p2: [] };
  let winnerName: string | null = null;
  let rating: number | null = null;
  for (const line of log.split('\n')) {
    const parts = line.split('|');
    const kind = parts[1];
    if (kind === 'player' && (parts[2] === 'p1' || parts[2] === 'p2') && parts[3]) {
      players[parts[2]] = parts[3];
      const r = Number(parts[5]);
      if (r) rating = Math.max(rating ?? 0, r);
    } else if (kind === 'poke' && (parts[2] === 'p1' || parts[2] === 'p2')) {
      const species = (parts[3] ?? '').split(',')[0].replace(/-\*$/, '');
      if (species) preview[parts[2]].push({ species, moves: [] });
    } else if (kind === 'showteam' && (parts[2] === 'p1' || parts[2] === 'p2')) {
      sheets[parts[2]] = parsePackedTeam(parts.slice(3).join('|'));
    } else if (kind === 'win') {
      winnerName = parts[2] ?? null;
    }
  }
  const winner = winnerName === players.p1 ? 'p1' : winnerName === players.p2 ? 'p2' : null;
  return {
    players,
    teams: { p1: sheets.p1.length ? sheets.p1 : preview.p1, p2: sheets.p2.length ? sheets.p2 : preview.p2 },
    winner,
    rating,
  };
}

export async function fetchReplayRecords(
  format: { id: string; regulation: string },
  options: { limit?: number; minRating?: number; log?: (msg: string) => void } = {},
): Promise<TeamRecord[]> {
  const log = options.log ?? console.log;
  const limit = options.limit ?? 200;
  const minRating = options.minRating ?? 1300;
  const entries: ReplaySearchEntry[] = [];
  let before: number | undefined;
  for (let page = 0; page < 40 && entries.length < limit; page++) {
    const url = `${BASE}/search.json?format=${format.id}${before ? `&before=${before}` : ''}`;
    const list = await fetchJson<ReplaySearchEntry[]>(url, { minIntervalMs: 500 });
    if (!list?.length) break;
    for (const e of list.slice(0, 50)) {
      if (!e.private && (e.rating ?? 0) >= minRating) entries.push(e);
    }
    before = list[Math.min(list.length, 50) - 1].uploadtime;
    if (list.length < 51) break;
  }
  const records: TeamRecord[] = [];
  for (const e of entries.slice(0, limit)) {
    try {
      const data = await fetchJson<ReplayData>(`${BASE}/${e.id}.json`, { minIntervalMs: 500 });
      if (!data?.log) continue;
      const parsed = parseReplayLog(data.log);
      if (!parsed.winner) continue;
      const date = new Date((data.uploadtime ?? e.uploadtime) * 1000).toISOString().slice(0, 10);
      for (const side of ['p1', 'p2'] as const) {
        if (parsed.teams[side].length < 4) continue;
        const won = parsed.winner === side;
        records.push({
          source: `replay:${e.id}`,
          sourceKind: 'ladder',
          date,
          regulation: format.regulation,
          player: parsed.players[side],
          wins: won ? 1 : 0,
          losses: won ? 0 : 1,
          rating: parsed.rating ?? e.rating ?? null,
          pokemon: parsed.teams[side],
        });
      }
    } catch (err) {
      log(`[replays] falha em ${e.id}: ${(err as Error).message}`);
    }
  }
  log(`[replays] ${format.id}: ${records.length / 2} partidas com vencedor`);
  return records;
}
