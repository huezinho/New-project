/**
 * Funções puras da interface (sem React): sprites, formatação, saneamento de
 * equipes vindas do localStorage/importação e checagens de cláusulas.
 */
import type { DexAccess } from '../core/dex.ts';
import { toId } from '../core/id.ts';
import { emptySP, SP_MAX, SP_TOTAL, STAT_IDS, totalSP } from '../core/stats.ts';
import { STAT_SHORT } from '../core/i18n.ts';
import type { ItemData, PokemonSet, SpeciesData, StatId, StatsTable, Team, TournamentTeamMember } from '../core/types.ts';

export const SPRITE_BASE = 'https://play.pokemonshowdown.com/sprites/gen5/';
export const MAX_TEAM = 6;

/** Id de sprite do Showdown: base + "-" + forma (ex.: charizard-megay, rotom-wash). */
export function spriteId(species: Pick<SpeciesData, 'name' | 'baseSpecies' | 'forme'>): string {
  const base = toId(species.baseSpecies ?? species.name);
  return species.forme ? `${base}-${toId(species.forme)}` : base;
}

export function spriteUrl(species: Pick<SpeciesData, 'name' | 'baseSpecies' | 'forme'>): string {
  return `${SPRITE_BASE}${spriteId(species)}.png`;
}

/** Iniciais para o avatar de reserva ("Iron Hands" -> "IH", "Incineroar" -> "In"). */
export function initials(name: string): string {
  const words = name.split(/[\s-]+/).filter(Boolean);
  if (words.length > 1 && !/^mega$/i.test(words[1])) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2);
}

/** Remove acentos e caixa para buscas. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const q = normalizeText(query.trim());
  if (!q) return true;
  const hay = normalizeText(fields.filter(Boolean).join(' '));
  return q.split(/\s+/).every(part => hay.includes(part));
}

/* ----------------------------- formatação ----------------------------- */

const MULT_LABEL: Record<string, string> = { '0': '0', '0.25': '¼', '0.5': '½', '1': '1', '2': '2', '4': '4' };

export function formatMult(m: number): string {
  const key = String(Math.round(m * 1000) / 1000);
  if (MULT_LABEL[key]) return MULT_LABEL[key];
  return (Math.round(m * 100) / 100).toString().replace('.', ',');
}

/** Classe CSS da célula de efetividade. */
export function multClass(m: number): string {
  if (m === 0) return 'm-imm';
  if (m <= 0.25) return 'm-q';
  if (m < 1) return 'm-h';
  if (m === 1) return 'm-n';
  if (m >= 4) return 'm-4x';
  return 'm-2x';
}

/** Pontuação do motor exibida de 0 a 100 (aceita 0-1 ou 0-100). */
export function displayScore(score: number | null | undefined): number {
  if (score === null || score === undefined || Number.isNaN(score)) return 0;
  return Math.round(score <= 1.0001 ? score * 100 : score);
}

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function spSummary(sp: Partial<StatsTable>): string {
  const parts = STAT_IDS.filter(s => (sp[s] ?? 0) > 0).map(s => `${sp[s]} ${STAT_SHORT[s]}`);
  return parts.length ? parts.join(' / ') : 'sem SP';
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Formata datas "soltas" dos JSON curados: "2026-09-18/20" -> "18–20/09/2026",
 * "2026-10-31/11-01" -> "31/10–01/11/2026"; outras datas ISO no texto viram dd/mm/aaaa.
 */
export function formatLooseDate(raw: string | undefined | null): string {
  if (!raw) return '—';
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})\/(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}–${m[5]}/${m[4]}/${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})\/(\d{2})$/.exec(s);
  if (m) return `${m[3]}–${m[4]}/${m[2]}/${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s)) return formatDate(s);
  return s
    .replace(/(\d{4})-(\d{2})-(\d{2})\/(\d{2})-(\d{2})/g, (_, y, mo, d, mo2, d2) => `${d}/${mo}–${d2}/${mo2}/${y}`)
    .replace(/(\d{4})-(\d{2})-(\d{2})\/(\d{2})(?![\d-])/g, (_, y, mo, d, d2) => `${d}–${d2}/${mo}/${y}`)
    .replace(/(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?/g, (_, y, mo, d) => `${d}/${mo}/${y}`);
}

/** Primeiro e último dia (UTC, ms) de uma data solta; null se não houver data ISO. */
export function looseDateRange(raw: string | undefined | null): { start: number; end: number } | null {
  if (!raw) return null;
  const m = /(\d{4})-(\d{2})-(\d{2})(?:\/(\d{2})(?:-(\d{2}))?)?/.exec(raw);
  if (!m) return null;
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  let end = start;
  if (m[4] && m[5]) end = Date.UTC(+m[1], +m[4] - 1, +m[5]);
  else if (m[4]) end = Date.UTC(+m[1], +m[2] - 1, +m[4]);
  return { start, end: Math.max(start, end) };
}

/** Idade em dias inteiros (para avisar dados antigos). */
export function ageInDays(iso: string | undefined | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

export function relativeAge(iso: string | undefined | null, now = Date.now()): string {
  const days = ageInDays(iso, now);
  if (days === null) return '';
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 31) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'há 1 mês' : `há ${months} meses`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR');
}

/* ------------------------------ Stat Points ---------------------------- */

/** Altera um atributo respeitando 0..32 e o total de 66 SP. */
export function setSPValue(sp: StatsTable, stat: StatId, value: number): StatsTable {
  const others = totalSP(sp) - (sp[stat] ?? 0);
  const max = Math.max(0, Math.min(SP_MAX, SP_TOTAL - others));
  const v = Math.max(0, Math.min(max, Math.round(Number.isFinite(value) ? value : 0)));
  return { ...sp, [stat]: v };
}

/* ------------------------------- saneamento ---------------------------- */

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function sanitizeSP(raw: unknown): StatsTable {
  const out = emptySP();
  if (!raw || typeof raw !== 'object') return out;
  for (const s of STAT_IDS) {
    const v = Number((raw as Record<string, unknown>)[s]);
    out[s] = Number.isFinite(v) ? Math.max(0, Math.min(SP_MAX, Math.round(v))) : 0;
  }
  // nunca passa de 66 no total
  while (totalSP(out) > SP_TOTAL) {
    const max = STAT_IDS.reduce((a, b) => (out[a] >= out[b] ? a : b));
    out[max]--;
  }
  return out;
}

/** Converte dados desconhecidos (localStorage, motor, importação) num set válido. */
export function sanitizeSet(raw: unknown): PokemonSet | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const species = str(r.species);
  if (!species) return null;
  const moves = Array.isArray(r.moves) ? r.moves.map(str).filter((m): m is string => !!m).slice(0, 4) : [];
  const set: PokemonSet = { species, sp: sanitizeSP(r.sp), moves };
  const item = str(r.item);
  const ability = str(r.ability);
  const nature = str(r.nature);
  const nickname = str(r.nickname);
  if (item) set.item = item;
  if (ability) set.ability = ability;
  if (nature) set.nature = nature;
  if (nickname) set.nickname = nickname;
  if (r.gender === 'M' || r.gender === 'F') set.gender = r.gender;
  if (r.shiny === true) set.shiny = true;
  return set;
}

export function sanitizeTeam(raw: unknown): Team {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeSet).filter((s): s is PokemonSet => !!s).slice(0, MAX_TEAM);
}

/**
 * Normaliza nomes para os do dex (caixa, Megas escritas como espécie etc.).
 * Devolve avisos em português para mostrar ao usuário.
 */
export function normalizeSet(dex: DexAccess, set: PokemonSet): { set: PokemonSet; warnings: string[] } {
  const warnings: string[] = [];
  const out: PokemonSet = { ...set, sp: sanitizeSP(set.sp), moves: [...set.moves] };
  let species = dex.species(set.species);
  if (species?.isMega) {
    // "Charizard-Mega-Y" vira Charizard segurando Charizardite Y
    const base = dex.baseOf(species);
    if (!out.item && species.requiredItem) out.item = species.requiredItem;
    species = base;
  }
  if (species) {
    out.species = species.name;
    if (!dex.isLegal(species)) warnings.push(`${species.name} não é legal na Reg ${dex.regulation}.`);
  } else {
    warnings.push(`Espécie desconhecida: ${set.species}.`);
  }
  if (out.item) {
    const item = dex.item(out.item);
    if (item) {
      out.item = item.name;
      if (!item.legal[dex.regulation]) warnings.push(`${item.name} não está disponível no Champions (Reg ${dex.regulation}).`);
    } else warnings.push(`Item desconhecido: ${out.item}.`);
  }
  if (out.ability) {
    const ability = dex.ability(out.ability);
    if (ability) out.ability = ability.name;
    else warnings.push(`Habilidade desconhecida: ${out.ability}.`);
  }
  if (out.nature) {
    const nature = dex.data.natures[toId(out.nature)];
    if (nature) out.nature = nature.name;
    else {
      warnings.push(`Natureza desconhecida: ${out.nature}.`);
      delete out.nature;
    }
  }
  out.moves = out.moves.map(m => {
    const move = dex.move(m);
    if (!move) {
      warnings.push(`Golpe desconhecido: ${m}.`);
      return m;
    }
    if (species && !dex.canLearn(species, move.id)) warnings.push(`${species.name} não aprende ${move.name} no Champions.`);
    return move.name;
  });
  return { set: out, warnings };
}

export function tournamentMemberToSet(member: TournamentTeamMember): PokemonSet {
  const set: PokemonSet = { species: member.species, sp: sanitizeSP(member.sp ?? {}), moves: (member.moves ?? []).filter(Boolean).slice(0, 4) };
  if (member.item) set.item = member.item;
  if (member.ability) set.ability = member.ability;
  if (member.nature) set.nature = member.nature;
  return set;
}

/* ------------------------------- cláusulas ----------------------------- */

/** Para cada slot, os outros slots que repetem o item (Item Clause). */
export function itemClauseConflicts(team: Team): Map<number, number[]> {
  const out = new Map<number, number[]>();
  team.forEach((set, i) => {
    if (!set.item) return;
    const others = team.map((s, j) => (j !== i && s.item && toId(s.item) === toId(set.item) ? j : -1)).filter(j => j >= 0);
    if (others.length) out.set(i, others);
  });
  return out;
}

/** Para cada slot, os outros slots com a mesma espécie (Species Clause, pelo número da Pokédex). */
export function speciesClauseConflicts(dex: DexAccess, team: Team): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const nums = team.map(s => dex.species(s.species)?.num ?? toId(s.species));
  nums.forEach((n, i) => {
    const others = nums.map((m, j) => (j !== i && m === n ? j : -1)).filter(j => j >= 0);
    if (others.length) out.set(i, others);
  });
  return out;
}

export function isMegaStone(item: ItemData | undefined): boolean {
  return !!item?.megaStone && Object.keys(item.megaStone).length > 0;
}

export function megaStoneCount(dex: DexAccess, team: Team): number {
  return team.filter(s => isMegaStone(dex.item(s.item))).length;
}

/** Itens legais para a espécie: Mega Stones dela primeiro; Mega Stones alheias ficam de fora. */
export function itemsForSpecies(dex: DexAccess, species: SpeciesData | undefined): { megas: ItemData[]; others: ItemData[] } {
  const megas: ItemData[] = [];
  const others: ItemData[] = [];
  for (const item of dex.legalItems()) {
    if (isMegaStone(item)) {
      if (species && item.megaStone![species.name]) megas.push(item);
    } else others.push(item);
  }
  others.sort((a, b) => a.name.localeCompare(b.name));
  return { megas, others };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/** Resolve um nome/id vindo do motor para o nome exibível do dex. */
export function displayName(dex: DexAccess, kind: 'species' | 'move' | 'item' | 'ability' | 'nature', value: string): string {
  if (!value) return value;
  const found =
    kind === 'species' ? dex.species(value)
    : kind === 'move' ? dex.move(value)
    : kind === 'item' ? dex.item(value)
    : kind === 'ability' ? dex.ability(value)
    : dex.data.natures[toId(value)];
  return found?.name ?? value;
}
