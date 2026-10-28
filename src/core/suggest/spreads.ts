/**
 * Sugestão de spreads (natureza + Stat Points): os mais usados no meta e
 * spreads gerados — benchmarks de Velocidade contra ameaças do meta, ofensivo
 * rápido, Trick Room (velocidade mínima), Tailwind e resistência máxima
 * (alocação gulosa que maximiza PS×Defesa e PS×Def. Esp.).
 */
import type { EngineContext, SpreadSuggestion } from '../api.ts';
import { STAT_PT } from '../i18n.ts';
import { calcStat, calcStats, emptySP, SP_MAX, SP_TOTAL, totalSP, validateSP } from '../stats.ts';
import { attackStat, metaThreats, natureOf, PROTECT_MOVES } from '../team.ts';
import { pctPt } from '../util.ts';
import type { NatureData, SpeciesData, StatId, StatsTable, Team } from '../types.ts';
import { archetypeById, memberFeatures, modeArchetypes, slotContext, type SlotContext } from './common.ts';

/** Golpes de setup: não contam como "suporte" para escolher o spread. */
const SETUP = new Set(['swordsdance', 'nastyplot', 'dragondance', 'calmmind', 'bulkup', 'quiverdance', 'shellsmash', 'bellydrum', 'agility', 'rockpolish', 'shiftgear', 'coil', 'irondefense', 'tidyup', 'noretreat', 'clangoroussoul', 'growth', 'curse']);

const NATURE_BY_PLUS_MINUS: Record<string, string> = {
  'atk-spa': 'Adamant', 'atk-spe': 'Brave', 'atk-def': 'Lonely', 'atk-spd': 'Naughty',
  'spa-atk': 'Modest', 'spa-spe': 'Quiet', 'spa-def': 'Mild', 'spa-spd': 'Rash',
  'spe-spa': 'Jolly', 'spe-atk': 'Timid', 'spe-def': 'Hasty', 'spe-spd': 'Naive',
  'def-spa': 'Impish', 'def-atk': 'Bold', 'def-spe': 'Relaxed', 'def-spd': 'Lax',
  'spd-spa': 'Careful', 'spd-atk': 'Calm', 'spd-spe': 'Sassy', 'spd-def': 'Gentle',
};

function natureName(plus: StatId, minus: StatId): string {
  return NATURE_BY_PLUS_MINUS[`${plus}-${minus}`] ?? 'Serious';
}

/** Alocação gulosa em PS/Defesa/Def. Esp. maximizando ln(PS·Def) + ln(PS·DefEsp). */
export function allocateBulk(form: SpeciesData, nature: NatureData | undefined, sp: StatsTable, budget: number): StatsTable {
  const out = { ...sp };
  let left = Math.min(budget, SP_TOTAL - totalSP(out));
  const value = (s: StatsTable) => {
    const st = calcStats(form, s, nature);
    return 2 * Math.log(st.hp) + Math.log(st.def) + Math.log(st.spd);
  };
  while (left > 0) {
    let best: StatId | null = null;
    let bestGain = -Infinity;
    const cur = value(out);
    for (const stat of ['hp', 'def', 'spd'] as StatId[]) {
      if (out[stat] >= SP_MAX) continue;
      out[stat]++;
      const gain = value(out) - cur;
      out[stat]--;
      if (gain > bestGain) {
        bestGain = gain;
        best = stat;
      }
    }
    if (!best) break;
    out[best]++;
    left--;
  }
  return out;
}

/** Menor SP de Velocidade para superar `target` (null se impossível). */
function minSpeedSP(base: number, target: number, nature: NatureData | undefined): number | null {
  for (let sp = 0; sp <= SP_MAX; sp++) if (calcStat(base, sp, 'spe', nature) > target) return sp;
  return null;
}

interface Draft {
  id: string;
  labelPt: string;
  nature: string;
  sp: StatsTable;
  usage?: number;
  reasonsPt: string[];
}

interface SpeedRef {
  name: string;
  speed: number;
  usage: number;
}

function speedRefs(ctx: EngineContext, selfName: string): SpeedRef[] {
  const seen = new Set<string>();
  const out: SpeedRef[] = [];
  for (const t of metaThreats(ctx, 30)) {
    const name = t.member.formName;
    if (!t.member.form || seen.has(name) || name === selfName) continue;
    seen.add(name);
    out.push({ name, speed: t.member.stats.spe, usage: t.meta.usage });
  }
  return out;
}

function speedSummary(speed: number, refs: SpeedRef[], trickRoom = false): string | null {
  if (!refs.length) return null;
  if (trickRoom) {
    const slower = refs.filter(r => r.speed > speed).length;
    return `Velocidade ${speed}: sob Trick Room age antes de ${slower} das ${refs.length} ameaças mais usadas.`;
  }
  const faster = refs.filter(r => r.speed < speed).length;
  return `Velocidade ${speed}: passa ${faster} das ${refs.length} ameaças mais usadas (spread mais comum de cada).`;
}

export function suggestSpreads(ctx: EngineContext, team: Team, slot: number): SpreadSuggestion[] {
  const sc = slotContext(ctx, team, slot);
  if (!sc) return [];
  const form = sc.member.form!;
  const f = memberFeatures(sc.member);
  const phys = attackStat(sc.member, 'Physical');
  const spec = attackStat(sc.member, 'Special');
  const main: StatId = f.physical && (!f.special || phys >= spec) ? 'atk' : 'spa';
  const unused: StatId = main === 'atk' ? 'spa' : 'atk';
  const attacker = f.attacker;
  const refs = speedRefs(ctx, form.name);
  const nat = (name: string) => natureOf(ctx, name);
  const speedOf = (sp: StatsTable, nature: string) => calcStat(form.baseStats.spe, sp.spe, 'spe', nat(nature));
  const drafts: Draft[] = [];
  const mainPt = STAT_PT[main];

  // 1) Mais usados no meta
  // Só da mesma forma em batalha (os spreads do Charizard-Mega-Y não servem ao Mega X).
  (sc.formMeta?.spreads ?? []).slice(0, 3).forEach((s, i) => {
    const sp = { ...emptySP(), ...s.sp };
    if (validateSP(sp).length || !nat(s.nature)) return;
    const reasons = [`Spread ${i === 0 ? 'mais usado' : `nº ${i + 1}`} no meta (${pctPt(s.share)} dos ${sc.member.name}).`];
    const summary = speedSummary(speedOf(sp, s.nature), refs);
    if (summary) reasons.push(summary);
    drafts.push({ id: `meta-${i + 1}`, labelPt: i === 0 ? 'Mais usado no meta' : `Meta nº ${i + 1}`, nature: s.nature, sp, usage: s.share, reasonsPt: reasons });
  });

  // 2) Ofensivo rápido
  const fastNature = natureName('spe', unused);
  const scarf = sc.member.itemId === 'choicescarf';
  {
    const sp = { ...emptySP(), spe: 32, [main]: 32, hp: 2 } as StatsTable;
    const reasons = [`Máximo de Velocidade e de ${mainPt}: pressiona desde o turno 1.`];
    if (scarf) reasons.push(`Com Choice Scarf chega a ${Math.floor(speedOf(sp, fastNature) * 1.5)} de Velocidade.`);
    const summary = speedSummary(speedOf(sp, fastNature), refs);
    if (summary) reasons.push(summary);
    drafts.push({ id: 'fast', labelPt: 'Ofensivo rápido', nature: fastNature, sp, reasonsPt: reasons });
  }

  // 3) Benchmarks de Velocidade contra ameaças do meta
  const powerNature = natureName(main, unused);
  const fill = (sp: StatsTable, nature: string): StatsTable => {
    const out = { ...sp };
    if (attacker) out[main] = Math.min(SP_MAX, SP_TOTAL - totalSP(out) + out[main], 32);
    return allocateBulk(form, nat(nature), out, SP_TOTAL - totalSP(out));
  };
  if (refs.length) {
    const neutralMin = calcStat(form.baseStats.spe, 0, 'spe', nat(powerNature));
    const neutralMax = calcStat(form.baseStats.spe, SP_MAX, 'spe', nat(powerNature));
    const plusMax = calcStat(form.baseStats.spe, SP_MAX, 'spe', nat(fastNature));
    const pick = (lo: number, hi: number) => {
      const inRange = refs.filter(r => r.speed >= lo && r.speed < hi);
      const relevant = inRange.filter(r => r.usage >= 0.03);
      return (relevant.length ? relevant : inRange).sort((a, b) => b.speed - a.speed)[0];
    };
    const neutralTarget = pick(neutralMin, neutralMax);
    if (neutralTarget) {
      const speSP = minSpeedSP(form.baseStats.spe, neutralTarget.speed, nat(powerNature));
      if (speSP !== null) {
        const sp = fill({ ...emptySP(), spe: speSP }, powerNature);
        const passed = refs.filter(r => r.speed < speedOf(sp, powerNature)).map(r => r.name);
        drafts.push({
          id: 'bench',
          labelPt: `Benchmark: passa ${neutralTarget.name}`,
          nature: powerNature,
          sp,
          reasonsPt: [
            `Velocidade ${speedOf(sp, powerNature)} com ${speSP} SP: passa ${neutralTarget.name} (${neutralTarget.speed}) sem natureza de Velocidade.`,
            `Passa ${passed.length} das ${refs.length} ameaças mais usadas; o resto vai para ${attacker ? `${mainPt} e ` : ''}resistência.`,
          ],
        });
      }
    }
    const plusTarget = pick(neutralMax, plusMax);
    if (plusTarget) {
      const speSP = minSpeedSP(form.baseStats.spe, plusTarget.speed, nat(fastNature));
      if (speSP !== null && speSP < SP_MAX) {
        const sp = fill({ ...emptySP(), spe: speSP }, fastNature);
        drafts.push({
          id: 'bench-plus',
          labelPt: `Benchmark: passa ${plusTarget.name} (+Vel.)`,
          nature: fastNature,
          sp,
          reasonsPt: [
            `Velocidade ${speedOf(sp, fastNature)} com natureza ${fastNature} e ${speSP} SP: passa ${plusTarget.name} (${plusTarget.speed}).`,
            `Economiza ${SP_MAX - speSP} SP em relação à Velocidade máxima.`,
          ],
        });
      }
    }
  }

  // 4) Tailwind: só a Velocidade necessária com o vento a favor
  const tailwind = sc.others.some(o => o.moveIds.has('tailwind')) || sc.member.moveIds.has('tailwind');
  if (tailwind && refs.length && form.baseStats.spe >= 50) {
    const top = [...refs].sort((a, b) => b.usage - a.usage).slice(0, 10);
    const fastest = Math.max(...top.map(r => r.speed));
    const speSP = minSpeedSP(form.baseStats.spe, Math.floor(fastest / 2), nat(powerNature));
    if (speSP !== null && speSP < SP_MAX) {
      const sp = fill({ ...emptySP(), spe: speSP }, powerNature);
      drafts.push({
        id: 'tailwind',
        labelPt: 'Tailwind (Velocidade econômica)',
        nature: powerNature,
        sp,
        reasonsPt: [
          `Sob Tailwind (×2) chega a ${speedOf(sp, powerNature) * 2} e passa todo o top 10 do meta (mais rápido: ${fastest}) com só ${speSP} SP.`,
          'Os SP economizados vão para dano e resistência.',
        ],
      });
    }
  }

  // 5) Trick Room (arquétipo da equipe inteira: o Trick Room do próprio membro conta)
  const trick = archetypeById(modeArchetypes(sc.state.archetypes), 'trickroom');
  // Choice Scarf e Velocidade mínima se anulam: sem spread de Trick Room para quem segura Scarf.
  const slowEnough = !scarf && (form.baseStats.spe <= 70 || (!!trick && form.baseStats.spe <= 90));
  if (slowEnough) {
    const trNature = attacker ? natureName(main, 'spe') : natureName(form.baseStats.def <= form.baseStats.spd ? 'def' : 'spd', 'spe');
    const base = { ...emptySP() };
    if (attacker) base[main] = 32;
    const sp = allocateBulk(form, nat(trNature), base, SP_TOTAL - totalSP(base));
    const reasons = ['0 SP e natureza −Velocidade: o mínimo possível (IVs são fixos no Champions).'];
    const summary = speedSummary(speedOf(sp, trNature), refs, true);
    if (summary) reasons.unshift(summary);
    if (trick) reasons.push(`Feito para o modo Trick Room da equipe (confiança ${pctPt(trick.confidence)}).`);
    drafts.push({ id: 'trickroom', labelPt: 'Trick Room (Velocidade mínima)', nature: trNature, sp, reasonsPt: reasons });
  }

  // 6) Resistência máxima e 7) ofensivo resistente
  const bulkPlus: StatId = form.baseStats.def <= form.baseStats.spd ? 'def' : 'spd';
  const bulkNature = natureName(bulkPlus, unused);
  {
    const sp = allocateBulk(form, nat(bulkNature), emptySP(), SP_TOTAL);
    const st = calcStats(form, sp, nat(bulkNature));
    drafts.push({
      id: 'bulk',
      labelPt: 'Resistência máxima',
      nature: bulkNature,
      sp,
      reasonsPt: [
        `Maximiza PS×Defesa e PS×Def. Esp. (PS ${st.hp}, Def ${st.def}, DefEsp ${st.spd}).`,
        'Ideal para suportes que precisam ficar em campo (Fake Out, redirecionamento, Trick Room).',
      ],
    });
  }
  if (attacker) {
    const base = { ...emptySP(), [main]: 32 } as StatsTable;
    const sp = allocateBulk(form, nat(powerNature), base, SP_TOTAL - 32);
    const st = calcStats(form, sp, nat(powerNature));
    drafts.push({
      id: 'bulkyoffense',
      labelPt: 'Ofensivo resistente',
      nature: powerNature,
      sp,
      reasonsPt: [`${mainPt} máximo (${st[main]}) com o restante em PS e defesas (PS ${st.hp}).`, 'Bom para atacantes lentos fora do Trick Room.'],
    });
  }

  // Suporte de fato (Fake Out, Parting Shot, Follow Me, Tailwind...): spreads de resistência são o padrão.
  const utility = f.status.filter(m => !PROTECT_MOVES.has(m.id) && !SETUP.has(m.id)).length + (sc.member.moveIds.has('fakeout') ? 1 : 0);
  const support = utility >= 2;
  // Spread do meta só vai na frente se fizer sentido para o perfil (dados de ladder às vezes trazem spreads estranhos).
  const top = drafts.find(d => d.id === 'meta-1');
  const topBulk = !!top && top.sp.hp + top.sp.def + top.sp.spd >= 40;
  const sensible = !!top && ((top.usage ?? 0) >= 0.08 || (attacker ? top.sp[main] >= 20 || (support && topBulk) : true));
  return orderDrafts(sc, drafts, attacker, !!trick && trick.confidence >= 0.5, sensible, support, scarf).map(d => ({
    ...d,
    stats: calcStats(form, d.sp, nat(d.nature)),
  }));
}

function orderDrafts(
  sc: SlotContext, drafts: Draft[], attacker: boolean, trickMode: boolean, metaFirst: boolean, support: boolean, scarf: boolean,
): Draft[] {
  const form = sc.member.form!;
  const spe = form.baseStats.spe;
  let order: string[];
  const metaSpe = drafts.find(d => d.id === 'meta-1')?.sp.spe ?? 99;
  const slowMeta = metaFirst && metaSpe <= 4;
  // Choice Scarf existe para ser rápido: nada de spread sem Velocidade.
  if (scarf) order = metaFirst && metaSpe >= 20 ? ['meta-1', 'fast', 'bench-plus', 'bench', 'meta-2'] : ['fast', 'bench-plus', 'bench', 'meta-1', 'meta-2', 'tailwind'];
  // Mesmo limite que gera o spread de Trick Room (até 90 de Velocidade base no modo TR).
  else if (trickMode && spe <= 90) order = slowMeta ? ['meta-1', 'trickroom', 'meta-2', 'bulkyoffense', 'bulk', 'meta-3'] : ['trickroom', 'meta-1', 'bulkyoffense', 'bulk', 'meta-2', 'meta-3'];
  else if (metaFirst) order = ['meta-1', 'meta-2', 'bench', 'tailwind', attacker && !support ? 'fast' : 'bulk', 'meta-3', 'bench-plus'];
  else if (support && spe < 80) order = ['bulk', 'bulkyoffense', 'meta-1', 'bench', 'trickroom', 'tailwind', 'fast'];
  else if (attacker && spe >= 80) order = ['fast', 'bench', 'tailwind', 'meta-1', 'bench-plus', 'bulkyoffense', 'bulk'];
  else if (attacker) order = ['bulkyoffense', 'bench', 'tailwind', 'meta-1', 'trickroom', 'fast', 'bulk'];
  else order = ['bulk', 'meta-1', 'bench', 'trickroom', 'tailwind', 'fast'];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  // Spreads iguais viram um só, juntando os motivos (ex.: o do meta já é o de Trick Room).
  const kept = new Map<string, Draft>();
  for (const d of [...drafts].sort((a, b) => rank(a.id) - rank(b.id))) {
    const key = `${d.nature}|${Object.values(d.sp).join('/')}`;
    const prev = kept.get(key);
    if (prev) prev.reasonsPt = [...new Set([...prev.reasonsPt, ...d.reasonsPt])].slice(0, 4);
    else kept.set(key, { ...d, reasonsPt: [...d.reasonsPt] });
  }
  return [...kept.values()];
}
