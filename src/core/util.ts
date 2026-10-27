/** Utilidades pequenas compartilhadas pelo motor. */
import type { EngineContext } from './api.ts';

export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

/** Número com vírgula decimal (pt-BR). */
export function num(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

/** Porcentagem com vírgula (0,153 -> "15,3%"). */
export function pctPt(value: number, digits = 0): string {
  return `${num(value * 100, digits)}%`;
}

/** "a", "a e b", "a, b e c". */
export function listPt(items: string[], max = 4): string {
  const list = items.slice(0, max);
  const extra = items.length - list.length;
  if (extra > 0) list.push(`mais ${extra}`);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`;
}

export function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

/* ------------------------------ cache ------------------------------ */

// Cache por (dex, meta, heurísticas, regulação): os objetos de dados são estáveis
// entre chamadas, mesmo quando a UI recria o EngineContext.
const caches = new WeakMap<object, WeakMap<object, WeakMap<object, Map<string, unknown>>>>();

export function memo<T>(ctx: EngineContext, key: string, fn: () => T): T {
  let a = caches.get(ctx.dex.data);
  if (!a) caches.set(ctx.dex.data, (a = new WeakMap()));
  let b = a.get(ctx.meta);
  if (!b) a.set(ctx.meta, (b = new WeakMap()));
  let c = b.get(ctx.heuristics);
  if (!c) b.set(ctx.heuristics, (c = new Map()));
  const k = `${ctx.dex.regulation}|${key}`;
  if (c.has(k)) return c.get(k) as T;
  const value = fn();
  c.set(k, value);
  return value;
}

/** Peso de uma regra de moveHeuristics (heuristics.json) com valor padrão. */
export function ruleWeight(ctx: EngineContext, id: string, fallback: number): number {
  const rules = memo(ctx, 'moveRules', () => new Map(ctx.heuristics.moveHeuristics?.map(r => [r.id, r.weight]) ?? []));
  const w = rules.get(id);
  return typeof w === 'number' && Number.isFinite(w) ? w : fallback;
}
