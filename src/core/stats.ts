/**
 * Cálculo de atributos do Pokémon Champions (nível 50, IVs fixos em 31 e
 * Stat Points: 66 no total, no máximo 32 por atributo).
 *
 * Fórmula (igual ao simulador oficial do Showdown):
 *   PS    = base + SP + 75
 *   Outros = floor((base + SP + 20) × natureza)
 * Cada SP vale +1 ponto no atributo (equivalente a 8 EVs em Scarlet/Violet).
 */
import type { NatureData, SpeciesData, StatId, StatsTable } from './types.ts';

export const STAT_IDS: StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const SP_TOTAL = 66;
export const SP_MAX = 32;

export const emptySP = (): StatsTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

export function natureMultiplier(nature: NatureData | undefined, stat: StatId): number {
  if (!nature || stat === 'hp') return 1;
  if (nature.plus === stat && nature.minus !== stat) return 1.1;
  if (nature.minus === stat && nature.plus !== stat) return 0.9;
  return 1;
}

export function calcStat(base: number, sp: number, stat: StatId, nature?: NatureData, speciesId?: string): number {
  if (stat === 'hp') {
    if (speciesId === 'shedinja') return 1;
    return base + sp + 75;
  }
  const raw = base + sp + 20;
  const mult = natureMultiplier(nature, stat);
  // Showdown: tr(tr(stat * 110, 16) / 100)
  if (mult === 1.1) return Math.floor((raw * 110) / 100);
  if (mult === 0.9) return Math.floor((raw * 90) / 100);
  return raw;
}

export function calcStats(species: SpeciesData, sp: StatsTable, nature?: NatureData): StatsTable {
  const out = emptySP();
  for (const s of STAT_IDS) out[s] = calcStat(species.baseStats[s], sp[s] ?? 0, s, nature, species.id);
  return out;
}

export function totalSP(sp: Partial<StatsTable>): number {
  return STAT_IDS.reduce((sum, s) => sum + (sp[s] ?? 0), 0);
}

export function validateSP(sp: Partial<StatsTable>): string[] {
  const problems: string[] = [];
  for (const s of STAT_IDS) {
    const v = sp[s] ?? 0;
    if (v < 0) problems.push(`${s.toUpperCase()} tem SP negativo.`);
    if (v > SP_MAX) problems.push(`${s.toUpperCase()} tem mais de ${SP_MAX} SP.`);
    if (!Number.isInteger(v)) problems.push(`${s.toUpperCase()} precisa ser inteiro.`);
  }
  const total = totalSP(sp);
  if (total > SP_TOTAL) problems.push(`Total de ${total} SP ultrapassa o limite de ${SP_TOTAL}.`);
  return problems;
}

/** Converte EVs (SV) para SP do Champions: 4 EVs dão o 1º ponto e cada 8 EVs seguintes +1. */
export function evsToSP(evs: Partial<StatsTable>): StatsTable {
  const out = emptySP();
  for (const s of STAT_IDS) {
    const ev = evs[s] ?? 0;
    out[s] = ev >= 4 ? Math.min(SP_MAX, Math.floor((ev - 4) / 8) + 1) : 0;
  }
  // Garante o total máximo, retirando do maior atributo se necessário.
  while (totalSP(out) > SP_TOTAL) {
    const max = STAT_IDS.reduce((a, b) => (out[a] >= out[b] ? a : b));
    out[max]--;
  }
  return out;
}

/** Aplica estágios de boost (-6..+6) a um atributo. */
export function applyBoost(stat: number, stage: number): number {
  const s = Math.max(-6, Math.min(6, stage));
  return s >= 0 ? Math.floor((stat * (2 + s)) / 2) : Math.floor((stat * 2) / (2 - s));
}

export interface SpeedContext {
  tailwind?: boolean;
  scarf?: boolean;
  paralyzed?: boolean;
  stage?: number;
  /** Habilidade que dobra a velocidade (Swift Swim na chuva, Chlorophyll no sol...). */
  abilityDouble?: boolean;
}

/** Velocidade efetiva em batalha (ordem de modificadores do Showdown simplificada). */
export function effectiveSpeed(speed: number, ctx: SpeedContext = {}): number {
  let s = applyBoost(speed, ctx.stage ?? 0);
  if (ctx.abilityDouble) s *= 2;
  if (ctx.scarf) s = Math.floor(s * 1.5);
  if (ctx.tailwind) s *= 2;
  if (ctx.paralyzed) s = Math.floor(s * 0.5);
  return s;
}
