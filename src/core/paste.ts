/**
 * Importação/exportação no formato de texto do Pokémon Showdown.
 * No Champions o Showdown usa a linha "EVs:" para guardar Stat Points;
 * aceitamos também "SPs:"/"SP:". Se os valores parecerem EVs de SV
 * (algum > 32 ou total > 66), convertemos automaticamente para SP.
 */
import { evsToSP, emptySP, STAT_IDS, totalSP, SP_MAX, SP_TOTAL } from './stats.ts';
import type { PokemonSet, StatId, StatsTable, Team } from './types.ts';

const STAT_FROM_LABEL: Record<string, StatId> = {
  hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe',
  satk: 'spa', sdef: 'spd', spatk: 'spa', spdef: 'spd', speed: 'spe', attack: 'atk', defense: 'def',
};
const LABEL: Record<StatId, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

function parseStatLine(text: string): Partial<StatsTable> {
  const out: Partial<StatsTable> = {};
  for (const part of text.split('/')) {
    const m = /^\s*(\d+)\s+([A-Za-z. ]+?)\s*$/.exec(part);
    if (!m) continue;
    const stat = STAT_FROM_LABEL[m[2].toLowerCase().replace(/[^a-z]/g, '')];
    if (stat) out[stat] = Number(m[1]);
  }
  return out;
}

export function parseSet(block: string): PokemonSet | null {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const set: PokemonSet = { species: '', sp: emptySP(), moves: [] };
  let first = lines[0];
  const at = first.lastIndexOf(' @ ');
  if (at >= 0) {
    set.item = first.slice(at + 3).trim();
    first = first.slice(0, at);
  }
  const gender = /\s\((M|F)\)$/.exec(first);
  if (gender) {
    set.gender = gender[1] as 'M' | 'F';
    first = first.slice(0, gender.index);
  }
  const nick = /^(.*)\(([^()]+)\)\s*$/.exec(first);
  if (nick) {
    set.nickname = nick[1].trim();
    set.species = nick[2].trim();
  } else {
    set.species = first.trim();
  }
  let rawStats: Partial<StatsTable> | null = null;
  for (const line of lines.slice(1)) {
    if (line.startsWith('Ability:')) set.ability = line.slice(8).trim();
    else if (/^(EVs|SPs|SP|Stat Points):/i.test(line)) rawStats = parseStatLine(line.slice(line.indexOf(':') + 1));
    else if (/ Nature$/.test(line)) set.nature = line.replace(/ Nature$/, '').trim();
    else if (line.startsWith('Level:')) set.level = Number(line.slice(6).trim()) || undefined;
    else if (line.startsWith('Shiny:')) set.shiny = /yes/i.test(line);
    else if (line.startsWith('- ') || line.startsWith('~ ')) {
      const move = line.slice(2).replace(/\s*\[[^\]]*\]$/, '').trim();
      if (move && set.moves.length < 4) set.moves.push(move);
    }
    // IVs, Tera Type, Happiness etc. são ignorados (não existem no Champions).
  }
  if (rawStats) {
    const looksLikeEVs = STAT_IDS.some(s => (rawStats![s] ?? 0) > SP_MAX) || totalSP(rawStats) > SP_TOTAL;
    set.sp = looksLikeEVs ? evsToSP(rawStats) : { ...emptySP(), ...rawStats };
  }
  return set.species ? set : null;
}

export function parseTeam(text: string): Team {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map(parseSet)
    .filter((s): s is PokemonSet => !!s)
    .slice(0, 6);
}

export function exportSet(set: PokemonSet): string {
  const lines: string[] = [];
  let head = set.nickname && set.nickname !== set.species ? `${set.nickname} (${set.species})` : set.species;
  if (set.gender) head += ` (${set.gender})`;
  if (set.item) head += ` @ ${set.item}`;
  lines.push(head);
  if (set.ability) lines.push(`Ability: ${set.ability}`);
  lines.push('Level: 50');
  const sp = STAT_IDS.filter(s => set.sp[s]).map(s => `${set.sp[s]} ${LABEL[s]}`);
  if (sp.length) lines.push(`EVs: ${sp.join(' / ')}`);
  if (set.nature) lines.push(`${set.nature} Nature`);
  for (const m of set.moves.filter(Boolean)) lines.push(`- ${m}`);
  return lines.join('\n');
}

export function exportTeam(team: Team): string {
  return team.map(exportSet).join('\n\n') + '\n';
}
