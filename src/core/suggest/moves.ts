/**
 * Sugestão de golpes no contexto da equipe. Parte do uso no meta e ajusta por
 * papéis que faltam, cobertura de tipos e ameaças, poder com STAB e atributo
 * certo, valor de golpes em área, dano no parceiro, conflitos de arquétipo,
 * Protect e redundância. Os 4 recomendados são escolhidos de forma gulosa.
 */
import type { EngineContext, MoveSetSuggestion, MoveSuggestion } from '../api.ts';
import { coverageRows } from '../analysis.ts';
import { TYPE_PT } from '../i18n.ts';
import { rolesOfMove, type RoleIndexEntry } from '../roles.ts';
import {
  attackStat, baseAttack, baseBulk, defenseMult, isDamaging, moveEffectiveness, moveTypeFor, NON_COVERAGE, PROTECT_MOVES,
  type FieldState, type Member,
} from '../team.ts';
import { TYPES } from '../typechart.ts';
import { clamp01, listPt, memo, pctPt, ruleWeight } from '../util.ts';
import type { MoveData, Team, TypeName } from '../types.ts';
import { modeArchetypes, rolePhrase, slotContext, squash, threatList, type SlotContext } from './common.ts';

/* --------------------------- poder efetivo --------------------------- */

/** Golpes de dano fixo/condicional: valor intrínseco direto (0-1). */
const FIXED_VALUE: Record<string, number> = {
  seismictoss: 0.42, nightshade: 0.42, superfang: 0.42, endeavor: 0.18, finalgambit: 0.15, counter: 0.28, mirrorcoat: 0.28,
  metalburst: 0.25, comeuppance: 0.3, beatup: 0.2, spitup: 0.05, fling: 0.12, fissure: 0.12, guillotine: 0.12, horndrill: 0.12, sheercold: 0.12,
};
const SELF_KO = new Set(['explosion', 'selfdestruct', 'mistyexplosion']);
const PROTECT_QUALITY: Record<string, number> = { protect: 1, detect: 1, spikyshield: 1.05, banefulbunker: 1.03, kingsshield: 1.04 };
const CHOICE_OK = new Set(['trick', 'switcheroo']);
const SUPPORT_MOVES = new Set(['helpinghand', 'followme', 'ragepowder', 'allyswitch', 'coaching', 'pollenpuff', 'lifedew', 'healpulse', 'decorate', 'afteryou']);

export const isSpreadMove = (move: MoveData): boolean =>
  !!move.effects?.isSpread || move.target === 'allAdjacentFoes' || move.target === 'allAdjacent';

function effectiveBasePower(move: MoveData, member: Member): number {
  const form = member.form!;
  switch (move.id) {
    case 'lowkick':
    case 'grassknot':
      return 80;
    case 'heavyslam':
    case 'heatcrash':
      return form.weightkg >= 200 ? 100 : form.weightkg >= 100 ? 80 : 60;
    case 'gyroball':
      return form.baseStats.spe <= 50 ? 120 : form.baseStats.spe <= 75 ? 90 : 50;
    case 'electroball':
      return form.baseStats.spe >= 110 ? 120 : form.baseStats.spe >= 85 ? 80 : 60;
    case 'flail':
    case 'reversal':
      return 60;
    case 'hardpress':
      return 70;
    case 'eruption':
    case 'waterspout':
      return 125; // cai com o PS
    case 'knockoff':
      return 97; // ×1,5 contra quem segura item
    case 'lastrespects':
    case 'ragefist':
      return 100;
    case 'acrobatics':
      return 70;
    case 'populationbomb':
      return move.basePower * 6;
    case 'tripleaxel':
      return 100;
  }
  let bp = move.basePower;
  const hits = move.effects?.multihit;
  if (typeof hits === 'number') bp *= hits;
  else if (Array.isArray(hits)) bp *= member.ability === 'skilllink' ? hits[1] : 3.1;
  return bp;
}

function abilityPowerMult(member: Member, move: MoveData, type: TypeName, field: FieldState, sunLike: boolean): number {
  const f = move.flags;
  switch (member.ability) {
    case 'technician': return move.basePower > 0 && move.basePower <= 60 ? 1.5 : 1;
    case 'toughclaws': return f.includes('contact') ? 1.3 : 1;
    case 'ironfist': return f.includes('punch') ? 1.2 : 1;
    case 'strongjaw': return f.includes('bite') ? 1.5 : 1;
    case 'megalauncher': return f.includes('pulse') ? 1.5 : 1;
    case 'sharpness': return f.includes('slicing') ? 1.5 : 1;
    case 'punkrock': return f.includes('sound') ? 1.3 : 1;
    case 'reckless': return move.effects?.recoil ? 1.2 : 1;
    case 'sheerforce': return (move.effects?.secondaryChance ?? 0) > 0 ? 1.3 : 1;
    case 'sandforce': return field.weather === 'Sand' && (type === 'Rock' || type === 'Ground' || type === 'Steel') ? 1.3 : 1;
    case 'solarpower': return move.category === 'Special' && sunLike ? 1.5 : 1;
    case 'waterbubble': return type === 'Water' ? 2 : 1;
    case 'steelworker':
    case 'steelyspirit': return type === 'Steel' ? 1.5 : 1;
    case 'transistor': return type === 'Electric' ? 1.3 : 1;
    case 'dragonsmaw': return type === 'Dragon' ? 1.5 : 1;
    case 'rockypayload': return type === 'Rock' ? 1.5 : 1;
    case 'fairyaura': return type === 'Fairy' ? 1.33 : 1;
    case 'darkaura': return type === 'Dark' ? 1.33 : 1;
    case 'hustle': return move.category === 'Physical' ? 1.1 : 1;
    case 'supremeoverlord': return 1.1;
    default: return 1;
  }
}

export interface DamageInfo {
  /** 0-1 */
  value: number;
  power: number;
  type: TypeName;
  stab: boolean;
  spread: boolean;
  /** Fator de categoria (< 1 quando o atributo usado é o pior dos dois). */
  categoryFit: number;
  notes: string[];
}

/** Valor teórico de um golpe de dano para o membro (STAB, atributo, clima, terreno, área...). */
export function damageInfo(member: Member, move: MoveData, field: FieldState, spreadValue = 1.2): DamageInfo {
  const { type, mult } = moveTypeFor(move, member.ability, field);
  const fixed = FIXED_VALUE[move.id];
  const spread = isSpreadMove(move) || (move.id === 'expandingforce' && field.terrain === 'Psychic');
  if (fixed !== undefined) return { value: fixed, power: 0, type, stab: false, spread, categoryFit: 1, notes: [] };
  const notes: string[] = [];
  const sunLike = field.weather === 'Sun' || member.ability === 'megasol';
  const rain = field.weather === 'Rain' && member.ability !== 'megasol';
  let bp = effectiveBasePower(move, member) * mult;
  if (move.id === 'expandingforce' && field.terrain === 'Psychic') bp *= 1.5;
  if (move.id === 'risingvoltage' && field.terrain === 'Electric') bp *= 2;
  const stab = member.types.includes(type);
  const stabMult = stab ? (member.ability === 'adaptability' ? 2 : 1.5) : 1;
  const phys = attackStat(member, 'Physical');
  const spec = attackStat(member, 'Special');
  const stat = move.id === 'bodypress' ? member.stats.def : move.id === 'foulplay' ? 130 : move.category === 'Special' ? spec : phys;
  const best = Math.max(phys, spec, move.id === 'bodypress' ? member.stats.def : 0, 1);
  const categoryFit = Math.sqrt(Math.min(1, stat / best));
  const statFactor = (stat / 140) * categoryFit;
  let weatherMult = 1;
  if (type === 'Fire') weatherMult = sunLike ? 1.5 : rain ? 0.5 : 1;
  if (type === 'Water' && move.id !== 'hydrosteam') weatherMult = rain ? 1.5 : sunLike ? 0.5 : 1;
  if (weatherMult > 1) notes.push(sunLike ? 'fortalecido pelo sol' : 'fortalecido pela chuva');
  if (weatherMult < 1) notes.push(sunLike ? 'enfraquecido pelo sol' : 'enfraquecido pela chuva');
  let terrainMult = 1;
  const grounded = !member.types.includes('Flying') && member.ability !== 'levitate';
  if (field.terrain && grounded) {
    if ((field.terrain === 'Grassy' && type === 'Grass') || (field.terrain === 'Electric' && type === 'Electric') || (field.terrain === 'Psychic' && type === 'Psychic')) {
      terrainMult = 1.3;
      notes.push('fortalecido pelo terreno');
    }
  }
  if (field.terrain === 'Grassy' && (move.id === 'earthquake' || move.id === 'bulldoze')) terrainMult = 0.5;
  if (field.terrain === 'Misty' && type === 'Dragon') terrainMult = 0.5;
  let acc = move.accuracy === true ? 1 : move.accuracy / 100;
  if ((move.id === 'thunder' || move.id === 'hurricane') && (rain || sunLike)) acc = rain ? 1 : 0.5;
  if (move.id === 'blizzard' && field.weather === 'Snow') acc = 1;
  if (member.ability === 'compoundeyes') acc = Math.min(1, acc * 1.3);
  if (member.ability === 'noguard') acc = 1;
  let drawback = 1;
  const recoil = move.effects?.recoil;
  if (recoil && member.ability !== 'rockhead' && member.ability !== 'magicguard') drawback *= 1 - (recoil[0] / recoil[1]) * 0.5;
  const drops = Object.values(move.effects?.selfBoosts ?? {}).reduce<number>((s, v) => s + Math.min(0, v ?? 0), 0);
  if (drops < 0) drawback *= member.ability === 'contrary' ? 1 - 0.06 * drops : 1 + 0.05 * drops;
  if (move.flags.includes('charge')) {
    if (move.id === 'solarbeam' || move.id === 'solarblade') drawback *= sunLike ? 1 : 0.35;
    else if (move.id === 'electroshot') drawback *= rain ? 1 : 0.6;
    else drawback *= move.id === 'meteorbeam' ? 0.6 : 0.45;
  }
  if (move.flags.includes('recharge')) drawback *= 0.45;
  if (move.flags.includes('cantusetwice')) drawback *= 0.85;
  if (SELF_KO.has(move.id)) drawback *= 0.35;
  const spreadMult = spread ? spreadValue : 1;
  const power = bp * stabMult * abilityPowerMult(member, move, type, field, sunLike) * weatherMult * terrainMult * acc * drawback * spreadMult * statFactor;
  return { value: clamp01((power - 25) / 155), power, type, stab, spread, categoryFit, notes };
}

/* -------------------------- valor de papel -------------------------- */

function roleValue(member: Member, move: MoveData, entries: RoleIndexEntry[], damaging: boolean): number {
  let best = 0;
  for (const e of entries) {
    if (e.role.scope === 'member') continue;
    if (damaging && e.role.id === 'spread') continue;
    let q = e.quality;
    if (e.role.id === 'setup') q *= setupFit(member, move);
    best = Math.max(best, 0.25 + 0.55 * q * Math.min(1, e.role.weight + 0.3));
  }
  return best;
}

function setupFit(member: Member, move: MoveData): number {
  const boosts = move.effects?.selfBoosts ?? {};
  const phys = attackStat(member, 'Physical');
  const spec = attackStat(member, 'Special');
  const offense = clamp01(baseAttack(member.form!, member.ability) / 110);
  if (boosts.atk && boosts.spa) return offense;
  if (boosts.atk) return (phys >= spec * 0.9 ? 1 : 0.25) * offense;
  if (boosts.spa) return (spec >= phys * 0.9 ? 1 : 0.25) * offense;
  return 0.6;
}

/* ----------------------------- avaliação ----------------------------- */

type PartKey =
  | 'usage' | 'intrinsic' | 'protect' | 'rolefill' | 'coverage' | 'threat' | 'allyhit' | 'conflict' | 'setter'
  | 'choice' | 'prankster' | 'wideguard' | 'support' | 'redundancy' | 'balance';

interface Part {
  key: PartKey;
  value: number;
  /** Texto para a lista de motivos. */
  textPt: string;
  /** Versão curta para "Troque X por Y: ...". */
  diffPt?: string;
}

interface Candidate {
  move: MoveData;
  usage: number;
  damaging: boolean;
  isProtect: boolean;
  dmg: DamageInfo | null;
  roles: RoleIndexEntry[];
  /** Tipos (puros) que acerta super efetivo. */
  seTypes: TypeName[];
  /** Ameaças do meta que acerta super efetivo. */
  threatHits: { name: string; danger: number }[];
  base: number;
  parts: Part[];
  tags: string[];
}

interface RankEnv {
  ctx: EngineContext;
  sc: SlotContext;
  member: Member;
  speciesName: string;
  hasMoveMeta: boolean;
  /** Tipos que os parceiros não acertam super efetivo. */
  uncovered: Set<TypeName>;
  threats: { name: string; danger: number; types: TypeName[]; ability: string }[];
  teamAvgSpe: number;
  attackerProfile: boolean;
  supportProfile: boolean;
}

/** Pressão de golpes em área no meta (0-1), para valorizar Wide Guard. */
function spreadPressure(ctx: EngineContext): number {
  return memo(ctx, 'spreadPressure', () => {
    const mons = Object.values(ctx.meta.pokemon ?? {}).sort((a, b) => b.usage - a.usage).slice(0, 20);
    if (!mons.length) return 0.35;
    let num = 0;
    let den = 0;
    for (const p of mons) {
      let best = 0;
      for (const m of p.moves ?? []) {
        const mv = ctx.dex.move(m.id);
        if (mv && isDamaging(mv) && isSpreadMove(mv) && mv.basePower >= 60) best = Math.max(best, m.share);
      }
      num += p.usage * Math.min(1, best * 1.3);
      den += p.usage;
    }
    return den ? clamp01(num / den) : 0.35;
  });
}

function speedFit(env: RankEnv, moveId: string): number {
  if (moveId === 'trickroom') {
    const avg = env.teamAvgSpe;
    return avg <= 70 ? 1 : avg >= 100 ? 0.35 : 1 - ((avg - 70) / 30) * 0.65;
  }
  if (moveId === 'tailwind') return env.teamAvgSpe >= 60 ? 1 : 0.6;
  return 1;
}

function evaluate(env: RankEnv, move: MoveData): Candidate {
  const { ctx, sc, member } = env;
  const damaging = isDamaging(move);
  const usage = sc.meta?.moves?.find(m => m.id === move.id)?.share ?? 0;
  const roles = rolesOfMove(ctx, move).filter(e => e.role.scope !== 'member');
  const isProtect = PROTECT_MOVES.has(move.id);
  const parts: Part[] = [];
  const tags: string[] = [];
  const add = (key: PartKey, value: number, textPt: string, diffPt?: string) => {
    if (Math.abs(value) > 1e-6) parts.push({ key, value, textPt, diffPt });
  };

  // Uso no meta
  if (env.hasMoveMeta) {
    const v = ruleWeight(ctx, 'usage', 0.8) * Math.min(1, usage / 0.6);
    add('usage', v, `Usado em ${pctPt(usage)} dos sets de ${env.speciesName} no meta.`);
  }

  // Valor intrínseco
  let dmg: DamageInfo | null = null;
  let intrinsic = 0;
  let intrinsicText = '';
  const coverageMove = damaging && !NON_COVERAGE.has(move.id);
  if (damaging) {
    dmg = damageInfo(member, move, sc.field, ruleWeight(ctx, 'spread-doubles', 1.2));
    const r = roleValue(member, move, roles, true);
    intrinsic = Math.max(dmg.value, r) + 0.25 * Math.min(dmg.value, r);
    if (dmg.power > 0) {
      const desc = [dmg.stab ? `STAB de ${TYPE_PT[dmg.type]}` : `golpe de ${TYPE_PT[dmg.type]}`];
      if (dmg.spread) desc.push('em área (×0,75, mas acerta os dois oponentes)');
      desc.push(...dmg.notes);
      intrinsicText = `${capitalize(desc.join(', '))}; poder efetivo ≈ ${Math.round(dmg.power)}.`;
      if (dmg.categoryFit < 0.8) intrinsicText += ` Usa o atributo mais fraco (${move.category === 'Physical' ? 'Ataque' : 'At. Esp.'}).`;
    }
    if (dmg.stab) tags.push('stab');
    if (dmg.spread) tags.push('spread');
  } else if (!isProtect) {
    intrinsic = roleValue(member, move, roles, false);
    if (!intrinsic) {
      intrinsic = move.effects?.heal ? 0.25 + 0.15 * clamp01((baseBulk(member.form!) - 120) / 80) : 0.12;
    }
  }
  if (!isProtect) {
    add('intrinsic', (env.hasMoveMeta ? ruleWeight(ctx, 'intrinsic', 0.5) : 1) * intrinsic, intrinsicText || 'Valor teórico do golpe para este Pokémon.');
  }

  // Protect
  if (isProtect) {
    tags.push('protect');
    if (member.itemId !== 'choicescarf') {
      add('protect', ruleWeight(ctx, 'protect-baseline', 0.55) * (PROTECT_QUALITY[move.id] ?? 1), 'Protect é básico em VGC: scouting, bloquear Fake Out e ataques focados.', `${move.name} é básico em VGC`);
    }
  }

  // Choice Scarf
  if (member.itemId === 'choicescarf' && !damaging && !CHOICE_OK.has(move.id)) {
    add('choice', -ruleWeight(ctx, 'choice-status', 0.8), 'Com Choice Scarf o Pokémon fica preso no golpe: status quase nunca vale a pena.', `${move.name} não combina com Choice Scarf`);
  }
  if (!damaging && member.ability === 'prankster') {
    add('prankster', ruleWeight(ctx, 'prankster-status', 0.15), 'Ganha prioridade com Prankster.', 'ganha prioridade com Prankster');
  }
  if (move.id === 'wideguard') {
    const p = spreadPressure(ctx);
    add('wideguard', ruleWeight(ctx, 'wideguard-meta', 0.35) * p, `Bloqueia ataques em área, muito usados no meta (pressão ${pctPt(p)}).`, 'bloqueia os ataques em área comuns no meta');
  }
  if (SUPPORT_MOVES.has(move.id) && env.supportProfile) {
    add('support', ruleWeight(ctx, 'support-bias', 0.15), `Combina com o perfil de suporte de ${env.speciesName}.`, `combina com o perfil de suporte de ${env.speciesName}`);
  }

  // Golpe em área que acerta o parceiro
  if (damaging && move.target === 'allAdjacent' && dmg) {
    const partners = sc.others;
    const immune = partners.filter(p => defenseMult(ctx, p, dmg!.type, member.ability) === 0 || p.ability === 'telepathy');
    const fraction = !partners.length ? 0.5 : immune.length ? 0.35 : 1;
    const text = !partners.length
      ? `${move.name} também acerta o parceiro.`
      : immune.length
        ? `${move.name} também acerta o parceiro; só ${listPt(immune.map(p => p.formName))} ${immune.length > 1 ? 'são imunes' : 'é imune'}.`
        : `${move.name} também acerta o parceiro e nenhum membro é imune a ${TYPE_PT[dmg.type]}.`;
    add('allyhit', -ruleWeight(ctx, 'ally-hit', 0.4) * fraction, text, immune.length ? undefined : `${move.name} acerta o parceiro e ninguém da equipe é imune`);
    tags.push('acerta-aliado');
  }

  // Arquétipo
  for (const a of modeArchetypes(sc.archetypes)) {
    if (a.def.antiSynergyMoves.includes(move.id)) {
      add('conflict', -ruleWeight(ctx, 'archetype-conflict', 0.9) * a.confidence, `Conflita com o modo ${a.def.namePt} da equipe.`, `${move.name} conflita com o ${a.def.namePt} da equipe`);
      tags.push('conflito');
    } else if (a.def.setters.moves.includes(move.id) || a.def.abusers.traits.some(t => t === `move:${move.id}`)) {
      add('setter', ruleWeight(ctx, 'archetype-setter', 0.25) * a.confidence, `Reforça o modo ${a.def.namePt} da equipe.`, `reforça o ${a.def.namePt} da equipe`);
    }
  }

  // Cobertura e ameaças (estáticos: tipos e alvos)
  const seTypes: TypeName[] = [];
  const threatHits: { name: string; danger: number }[] = [];
  if (coverageMove && dmg && dmg.value > 0.05) {
    for (const t of TYPES) if (moveEffectiveness(ctx, move, member.ability, [t], undefined, sc.field) >= 2) seTypes.push(t);
    for (const t of env.threats) {
      if (moveEffectiveness(ctx, move, member.ability, t.types, t.ability, sc.field) >= 2) threatHits.push({ name: t.name, danger: t.danger });
    }
  }
  for (const e of roles) tags.push(e.role.id);
  if (move.priority > 0) tags.push('prioridade');
  const base = parts.reduce((s, p) => s + p.value, 0);
  return { move, usage, damaging, isProtect, dmg, roles, seTypes, threatHits, base, parts, tags: [...new Set(tags)] };
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Partes que dependem dos golpes já escolhidos (papéis, cobertura, redundância). */
function dynamicParts(env: RankEnv, c: Candidate, picked: Candidate[], slotIndex: number): Part[] {
  const { ctx, sc } = env;
  const out: Part[] = [];
  const add = (key: PartKey, value: number, textPt: string, diffPt?: string) => {
    if (Math.abs(value) > 1e-6) out.push({ key, value, textPt, diffPt });
  };
  // Papéis
  for (const e of c.roles) {
    const q = e.quality * (e.role.id === 'speedcontrol' ? speedFit(env, c.move.id) : 1);
    const inPicked = picked.some(p => p.roles.some(r => r.role.id === e.role.id));
    const provided = sc.providers.get(e.role.id) ?? 0;
    if (inPicked) {
      const soft = e.role.id === 'spread' || e.role.id === 'priority' ? 0.3 : 1;
      add('redundancy', -ruleWeight(ctx, 'redundancy-role', 0.5) * e.role.weight * e.quality * soft, `Repete o papel de ${rolePhrase(e.role)} de outro golpe escolhido.`);
    } else if (!provided) {
      const isCore = e.role.weight >= 0.25;
      add(
        'rolefill',
        ruleWeight(ctx, 'role-fill', 0.8) * e.role.weight * q,
        isCore ? `Cumpre ${rolePhrase(e.role)}, que falta na equipe.` : `Traz ${rolePhrase(e.role)} para a equipe.`,
        `sua equipe não tem ${rolePhrase(e.role)}`,
      );
    } else if (provided === 1) {
      add('rolefill', 0.15 * e.role.weight * q, `Segunda fonte de ${rolePhrase(e.role)} na equipe.`);
    }
  }
  // Cobertura de tipos
  if (c.seTypes.length && c.dmg) {
    const coveredByPicked = new Set(picked.flatMap(p => p.seTypes));
    const fresh = c.seTypes.filter(t => env.uncovered.has(t) && !coveredByPicked.has(t));
    if (fresh.length) {
      const names = listPt(fresh.map(t => TYPE_PT[t]));
      add(
        'coverage',
        ruleWeight(ctx, 'coverage', 0.12) * Math.min(3, fresh.length) * Math.min(1, c.dmg.value * 1.5),
        `Cobre ${names}, que a equipe não acerta super efetivo.`,
        `cobre ${names}, que a equipe não acerta super efetivo`,
      );
    }
  }
  // Ameaças do meta
  if (c.threatHits.length && c.dmg) {
    const hitByPicked = new Set(picked.flatMap(p => p.threatHits.map(h => h.name)));
    const danger = c.threatHits.reduce((s, h) => s + h.danger * (hitByPicked.has(h.name) ? 0.3 : 1), 0);
    if (danger > 0.05) {
      const names = listPt(c.threatHits.slice().sort((a, b) => b.danger - a.danger).map(h => h.name), 3);
      add(
        'threat',
        ruleWeight(ctx, 'threat-coverage', 0.25) * Math.min(1, danger / 1.2) * Math.min(1, c.dmg.value * 1.5),
        `Super efetivo contra ${names} (ameaças do meta para a equipe).`,
        `acerta super efetivo ${names}, ameaças do meta`,
      );
    }
  }
  // Redundância de tipo
  if (c.damaging && c.dmg) {
    const same = picked.find(p => p.damaging && p.dmg && p.dmg.type === c.dmg!.type);
    if (same) {
      const soft = same.dmg!.spread !== c.dmg.spread || same.move.priority !== c.move.priority ? 0.5 : 1;
      add('redundancy', -ruleWeight(ctx, 'redundancy-type', 0.3) * soft, `Mesmo tipo (${TYPE_PT[c.dmg.type]}) de ${same.move.name}.`);
    }
  }
  if (c.isProtect && picked.some(p => p.isProtect)) add('redundancy', -1.5, 'Já há um golpe de proteção no set.');
  // Equilíbrio entre ataque e status
  const statusPicked = picked.filter(p => !p.damaging).length;
  const damagingPicked = picked.length - statusPicked;
  if (!c.damaging && statusPicked >= 2) {
    add('balance', -0.2 * (statusPicked - 1) * (env.attackerProfile ? 1.2 : 0.6), 'Set já tem muitos golpes de status.');
  }
  if (c.damaging && slotIndex === 3 && damagingPicked === 0) add('balance', 0.4, 'Garante ao menos um golpe de dano.');
  if (c.damaging && slotIndex === 3 && damagingPicked === 1 && env.attackerProfile) add('balance', 0.15, 'Atacante precisa de mais de um golpe de dano.');
  return out;
}

function reasonsOf(parts: Part[]): string[] {
  const sorted = [...parts].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return sorted.slice(0, 4).map(p => p.textPt);
}

/* ------------------------------ entrada ------------------------------ */

const EMPTY: MoveSetSuggestion = { recommended: [], mostUsed: [], ranked: [], diffPt: [] };

export function suggestMoves(ctx: EngineContext, team: Team, slot: number): MoveSetSuggestion {
  const sc = slotContext(ctx, team, slot);
  if (!sc) return { ...EMPTY };
  const member = sc.bare;
  const species = sc.member.species!;
  const learnset = ctx.dex.learnset(species);
  if (!learnset.length) return { ...EMPTY };
  const form = member.form!;
  const members = [...sc.others, member];
  const teamAvgSpe = members.reduce((s, m) => s + (m.form?.baseStats.spe ?? 0), 0) / members.length;
  const threats = threatList(ctx, sc.state, 10).map(t => ({ name: t.name, danger: t.danger, types: t.profile.member.types, ability: t.profile.member.ability }));
  const uncovered = new Set(coverageRows(ctx, sc.others, sc.field).filter(r => r.best < 2).map(r => r.type));
  const env: RankEnv = {
    ctx,
    sc,
    member,
    speciesName: species.name,
    hasMoveMeta: !!sc.meta?.moves?.length,
    uncovered: sc.others.length ? uncovered : new Set(TYPES),
    threats,
    teamAvgSpe,
    attackerProfile: baseAttack(form, member.ability) >= 100,
    supportProfile: baseAttack(form, member.ability) < 95 || baseBulk(form) >= 170,
  };

  const candidates = learnset.map(m => evaluate(env, m));

  // Escolha gulosa dos 4 golpes
  const picked: Candidate[] = [];
  const pickedParts = new Map<string, Part[]>();
  const pickedScore = new Map<string, number>();
  for (let k = 0; k < Math.min(4, candidates.length); k++) {
    let best: Candidate | null = null;
    let bestScore = -Infinity;
    let bestDyn: Part[] = [];
    for (const c of candidates) {
      if (picked.includes(c)) continue;
      const dyn = dynamicParts(env, c, picked, k);
      const score = c.base + dyn.reduce((s, p) => s + p.value, 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
        bestDyn = dyn;
      }
    }
    if (!best) break;
    picked.push(best);
    pickedParts.set(best.move.id, [...best.parts, ...bestDyn]);
    pickedScore.set(best.move.id, bestScore);
  }

  // Lista completa (avaliada como se fosse o primeiro golpe, exceto os escolhidos)
  const ranked: (MoveSuggestion & { raw: number; parts: Part[] })[] = candidates.map(c => {
    const parts = pickedParts.get(c.move.id) ?? [...c.parts, ...dynamicParts(env, c, picked.filter(p => p !== c), 0)];
    const raw = pickedScore.get(c.move.id) ?? parts.reduce((s, p) => s + p.value, 0);
    return { move: c.move.name, score: squash(raw), usage: c.usage, reasonsPt: reasonsOf(parts), tags: c.tags, raw, parts };
  });
  ranked.sort((a, b) => b.raw - a.raw);

  const recommended = picked.map(c => c.move.name);
  const mostUsed = (sc.meta?.moves ?? [])
    .filter(m => ctx.dex.canLearn(species, m.id))
    .slice(0, 4)
    .map(m => ctx.dex.move(m.id)?.name ?? m.name);
  const byName = new Map(ranked.map(r => [r.move, r]));
  const diffPt = explainDiff(ctx, sc, recommended, mostUsed, byName);
  return {
    recommended,
    mostUsed,
    ranked: ranked.map(r => ({ move: r.move, score: r.score, usage: r.usage, reasonsPt: r.reasonsPt, tags: r.tags })),
    diffPt,
  };
}

type RankedEntry = MoveSuggestion & { raw: number; parts: Part[] };

const CONTEXT_KEYS: PartKey[] = ['rolefill', 'coverage', 'threat', 'setter', 'wideguard', 'protect', 'prankster', 'support'];
const NEGATIVE_KEYS: PartKey[] = ['conflict', 'allyhit', 'choice'];

function bestContext(entry: RankedEntry | undefined): string | undefined {
  if (!entry) return undefined;
  const part = entry.parts.filter(p => p.value > 0 && CONTEXT_KEYS.includes(p.key) && p.diffPt).sort((a, b) => b.value - a.value)[0];
  return part?.diffPt;
}

function worstContext(entry: RankedEntry | undefined): string | undefined {
  if (!entry) return undefined;
  const part = entry.parts.filter(p => p.value < 0 && NEGATIVE_KEYS.includes(p.key) && p.diffPt).sort((a, b) => a.value - b.value)[0];
  return part?.diffPt;
}

function whyPt(added: string, removed: string | undefined, byName: Map<string, RankedEntry>): string {
  const a = byName.get(added);
  const r = removed ? byName.get(removed) : undefined;
  const reasons = [bestContext(a), worstContext(r)].filter((x): x is string => !!x);
  if (reasons.length) return reasons.join('; ');
  if (a && r) return `rende mais nesta equipe (nota ${Math.round(a.score * 100)} × ${Math.round(r.score * 100)})`;
  return 'rende mais nesta equipe';
}

function explainDiff(ctx: EngineContext, sc: SlotContext, recommended: string[], mostUsed: string[], byName: Map<string, RankedEntry>): string[] {
  const out: string[] = [];
  const reference = mostUsed.length ? mostUsed : (sc.member.set.moves ?? []).filter(Boolean).map(m => ctx.dex.move(m)?.name ?? m);
  if (!reference.length) {
    return sc.meta?.moves?.length
      ? []
      : ['Sem dados de uso no meta para esta espécie: recomendação baseada em STAB, cobertura e papéis que faltam na equipe.'];
  }
  const refIds = new Set(reference);
  const recIds = new Set(recommended);
  const added = recommended.filter(m => !refIds.has(m));
  const removed = reference.filter(m => !recIds.has(m)).sort((x, y) => (byName.get(x)?.raw ?? 0) - (byName.get(y)?.raw ?? 0));
  const label = mostUsed.length ? 'mais usados no meta' : 'do seu set atual';
  if (!added.length && !removed.length) return [`A recomendação coincide com os golpes ${label}.`];
  added.forEach((m, i) => {
    const r = removed[i];
    out.push(r ? `Troque ${r} por ${m}: ${whyPt(m, r, byName)}.` : `Inclua ${m}: ${whyPt(m, undefined, byName)}.`);
  });
  for (const r of removed.slice(added.length)) out.push(`${r} fica de fora: ${worstContext(byName.get(r)) ?? 'os outros golpes rendem mais nesta equipe'}.`);
  if (!mostUsed.length) out.push('Sem dados de uso no meta para esta espécie: comparação feita com o set atual.');
  return out;
}

/** Golpes recomendados (atalho usado pelo buildSet). */
export function recommendedMoves(ctx: EngineContext, team: Team, slot: number): string[] {
  return suggestMoves(ctx, team, slot).recommended;
}
