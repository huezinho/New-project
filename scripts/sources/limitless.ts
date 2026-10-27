/**
 * Torneios online do Limitless (play.limitlesstcg.com), que publicam a lista
 * de times e a campanha (vitórias/derrotas) de cada jogador.
 * API pública: https://play.limitlesstcg.com/api (docs: docs.limitlesstcg.com)
 */
import { fetchJson } from '../lib/http.ts';
import type { RecordMember, TeamRecord } from '../lib/records.ts';

const API = 'https://play.limitlesstcg.com/api';

export interface LimitlessTournament {
  id: string;
  game: string;
  format: string | null;
  name: string;
  date: string;
  players: number;
}

interface LimitlessPokemon {
  id?: string;
  name?: string;
  item?: string;
  ability?: string;
  attacks?: string[];
  moves?: string[];
  nature?: string;
  tera?: string | null;
}

interface LimitlessStanding {
  player: string;
  name?: string;
  country?: string;
  placing?: number | null;
  record?: { wins: number; losses: number; ties: number };
  decklist?: LimitlessPokemon[] | { pokemon?: LimitlessPokemon[] } | null;
  drop?: number | null;
}

export interface LimitlessOptions {
  /** Só torneios a partir desta data (ISO). */
  since: string;
  /** Resolve a regulação de um torneio (por código de formato e data). */
  regulationOf: (t: LimitlessTournament) => string | null;
  minPlayers?: number;
  maxTournaments?: number;
  apiKey?: string;
  log?: (msg: string) => void;
}

function membersOf(decklist: LimitlessStanding['decklist']): RecordMember[] {
  const list = Array.isArray(decklist) ? decklist : decklist?.pokemon ?? [];
  return list
    .map(p => ({
      // o id do Limitless (ex.: "indeedee-f") é mais preciso que o nome ("Indeedee ♀")
      species: p.id ?? p.name ?? '',
      item: p.item ?? null,
      ability: p.ability ?? null,
      moves: (p.attacks ?? p.moves ?? []).filter(Boolean),
      nature: p.nature ?? null,
    }))
    .filter(m => m.species);
}

export async function fetchLimitlessTournaments(options: LimitlessOptions): Promise<LimitlessTournament[]> {
  const headers: Record<string, string> = options.apiKey ? { 'X-Access-Key': options.apiKey } : {};
  const out: LimitlessTournament[] = [];
  for (let page = 1; page <= 20; page++) {
    const list = await fetchJson<LimitlessTournament[]>(`${API}/tournaments?game=VGC&limit=50&page=${page}`, { headers, minIntervalMs: 700 });
    if (!list?.length) break;
    let older = false;
    for (const t of list) {
      if (t.date.slice(0, 10) < options.since) {
        older = true;
        continue;
      }
      if ((t.players ?? 0) >= (options.minPlayers ?? 16) && options.regulationOf(t)) out.push(t);
    }
    if (older) break;
  }
  out.sort((a, b) => b.players - a.players);
  return out.slice(0, options.maxTournaments ?? 60);
}

export async function fetchLimitlessRecords(options: LimitlessOptions): Promise<TeamRecord[]> {
  const log = options.log ?? console.log;
  const headers: Record<string, string> = options.apiKey ? { 'X-Access-Key': options.apiKey } : {};
  const tournaments = await fetchLimitlessTournaments(options);
  const records: TeamRecord[] = [];
  for (const t of tournaments) {
    const regulation = options.regulationOf(t)!;
    try {
      const standings = await fetchJson<LimitlessStanding[]>(`${API}/tournaments/${t.id}/standings`, { headers, minIntervalMs: 700 });
      let withTeams = 0;
      for (const s of standings ?? []) {
        const pokemon = membersOf(s.decklist);
        if (pokemon.length < 4) continue;
        withTeams++;
        records.push({
          source: `limitless:${t.id}`,
          sourceKind: 'online',
          eventId: `limitless-${t.id}`,
          eventName: t.name,
          date: t.date.slice(0, 10),
          regulation,
          player: s.name ?? s.player,
          placing: s.placing ?? null,
          players: t.players,
          wins: s.record?.wins ?? null,
          losses: s.record?.losses ?? null,
          ties: s.record?.ties ?? null,
          pokemon,
        });
      }
      log(`[limitless] ${t.name} (${t.date.slice(0, 10)}, ${t.players} jogadores): ${withTeams} times`);
    } catch (err) {
      log(`[limitless] falha em ${t.id}: ${(err as Error).message}`);
    }
  }
  return records;
}
