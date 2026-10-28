/**
 * Sugestão de Pokémon para a equipe. Cada candidato recebe componentes 0-1
 * (meta, vitória, sinergia, defesa, ataque, papéis, ameaças, arquétipo),
 * ponderados por DEFAULT_WEIGHTS + pesos do usuário, com motivos em português
 * e um set completo montado para a equipe.
 */
import type { EngineContext, MegaAlternative, PokemonSuggestion, RoleDef, ScoreComponent, SuggestionWeights } from '../api.ts';
import { coreRoles, type TeamState, teamState } from '../analysis.ts';
import { TYPE_PT } from '../i18n.ts';
import { toId } from '../id.ts';
import { matchTrait, roleById, setRoles, speciesPotential, type TraitSubject } from '../roles.ts';
import { emptySP } from '../stats.ts';
import {
  ABILITY_TERRAIN, ABILITY_WEATHER, attackTypesOf, baseAttack, defaultAbility, defaultSpread, defenseMult, hasMetaData, isDamaging,
  isMegaStone, likelySet, megaOptions, megaShareOf, metaForForm, metaOf, moveTypeFor, NON_COVERAGE, ownField, resolveMember, type Member,
} from '../team.ts';
import { attackEffectiveness, MOLD_BREAKERS, TYPES } from '../typechart.ts';
import { clamp01, listPt, memo, num, pctPt } from '../util.ts';
import { mergedWeights } from '../weights.ts';
import type { MetaPokemon, PokemonSet, SpeciesData, Team, TypeName } from '../types.ts';
import { buildSet } from './build.ts';
import { GENERIC_ARCHETYPES, modeArchetypes, rolePhrase, threatList } from './common.ts';

const LABELS: Record<keyof SuggestionWeights, string> = {
  meta: 'Uso no meta',
  winRate: 'Taxa de vitória',
  synergy: 'Sinergia com a equipe',
  defensive: 'Defesa (fraquezas da equipe)',
  offensive: 'Cobertura ofensiva',
  roles: 'Papéis que faltam',
  threats: 'Resposta às ameaças do meta',
  archetype: 'Encaixe no arquétipo',
};
const KEYS = Object.keys(LABELS) as (keyof SuggestionWeights)[];
const ATE: Record<string, TypeName> = { aerilate: 'Flying', pixilate: 'Fairy', refrigerate: 'Ice', galvanize: 'Electric', dragonize: 'Dragon' };
const WEATHER_ABILITY: Record<string, string> = { drought: 'sun', drizzle: 'rain', sandstream: 'sand', snowwarning: 'snow' };
const WEATHER_PT: Record<string, string> = { Sun: 'o sol', Rain: 'a chuva', Sand: 'a areia', Snow: 'a neve' };
const WEATHER_BY_PT: Record<string, string> = { Sun: 'pelo sol', Rain: 'pela chuva', Sand: 'pela areia', Snow: 'pela neve' };

/* ------------------------------ perfil ------------------------------ */

interface Profile {
  species: SpeciesData;
  member: Member;
  meta?: MetaPokemon;
  usesMega: boolean;
  /** Tipos de ataque prováveis com peso (STAB = 1). */
  attack: Map<TypeName, number>;
  speed: number;
  bst: number;
  learn: Set<string>;
  abilityIds: string[];
  /** Multiplicador recebido de cada tipo (habilidade e item incluídos). */
  defense: Record<TypeName, number>;
}

function defenseTable(ctx: EngineContext, m: Member): Record<TypeName, number> {
  const out = {} as Record<TypeName, number>;
  for (const t of TYPES) out[t] = defenseMult(ctx, m, t);
  return out;
}

function bestMegaItem(ctx: EngineContext, species: SpeciesData): string | undefined {
  const options = megaOptions(ctx, species);
  if (!options.length) return undefined;
  const score = (o: (typeof options)[number]) => (ctx.dex.ability(o.form.abilities['0'])?.rating ?? 3) + baseAttack(o.form) / 60;
  return options.reduce((a, b) => (score(b) > score(a) ? b : a)).item.name;
}

function profileOf(ctx: EngineContext, species: SpeciesData, allowMega: boolean): Profile {
  return memo(ctx, `profile:${species.id}:${allowMega ? 1 : 0}`, () => {
    // Sem vaga de Mega, só contam os dados da forma comum: o uso de Salamence
    // vem quase todo da Mega e não diz nada sobre o Salamence sem Mega Stone.
    const mp = allowMega || !megaOptions(ctx, species).length ? metaOf(ctx, species) : metaForForm(ctx, species, undefined);
    let set: PokemonSet;
    if (mp) {
      set = { ...likelySet(ctx, mp), moves: [...likelySet(ctx, mp).moves] };
      if (!allowMega && isMegaStone(ctx.dex.item(set.item))) {
        set.item = mp.items.find(i => !ctx.dex.item(i.id)?.megaStone && ctx.dex.item(i.id)?.legal[ctx.dex.regulation])?.name;
      }
    } else {
      set = { species: species.name, ability: defaultAbility(ctx, species), sp: emptySP(), moves: [] };
      if (allowMega) set.item = bestMegaItem(ctx, species);
      const def = defaultSpread(ctx.dex.battleForm(set) ?? species);
      set.nature = def.nature;
      set.sp = def.sp;
    }
    const member = resolveMember(ctx, set, -1);
    const field = ownField(member.ability);
    const attack = new Map<TypeName, number>();
    const bump = (t: TypeName, w: number) => attack.set(t, Math.max(attack.get(t) ?? 0, w));
    for (const t of member.types) bump(t, 1);
    if (ATE[member.ability]) bump(ATE[member.ability], 0.9);
    if (mp?.moves?.length) {
      for (const share of mp.moves) {
        const mv = ctx.dex.move(share.id);
        if (!mv || !isDamaging(mv) || NON_COVERAGE.has(mv.id) || share.share < 0.12 || (mv.basePower > 0 && mv.basePower < 50)) continue;
        bump(moveTypeFor(mv, member.ability, field).type, Math.min(1, share.share * 1.5));
      }
    } else if (member.form) {
      const physical = member.stats.atk >= member.stats.spa;
      for (const mv of ctx.dex.learnset(species)) {
        if (!isDamaging(mv) || NON_COVERAGE.has(mv.id) || mv.basePower < 70) continue;
        if ((mv.category === 'Physical') !== physical) continue;
        bump(moveTypeFor(mv, member.ability, field).type, 0.5);
      }
    }
    const form = member.form ?? species;
    const bst = Object.values(form.baseStats).reduce((s, v) => s + v, 0);
    return {
      species,
      member,
      meta: mp,
      usesMega: member.isMega,
      attack,
      speed: member.itemId === 'choicescarf' ? Math.floor(member.stats.spe * 1.5) : member.stats.spe,
      bst,
      learn: new Set(species.learnset),
      abilityIds: Object.values(species.abilities).map(toId),
      defense: defenseTable(ctx, member),
    };
  });
}

/** Força estimada sem dados de meta (atributos, ataque e papéis). */
function strengthOf(ctx: EngineContext, p: Profile): number {
  const form = p.member.form ?? p.species;
  const potential = speciesPotential(ctx, p.species);
  const roleSum = coreRoles(ctx).reduce((s, r) => s + r.weight * (potential.get(r.id)?.strength ?? 0), 0);
  return clamp01(0.55 * clamp01((p.bst - 420) / 200) + 0.25 * clamp01((baseAttack(form, p.member.ability) - 80) / 60) + 0.2 * clamp01(roleSum / 1.5));
}

/* ------------------------------ sinergia ------------------------------ */

interface PairInfo {
  lift?: number;
  winRate?: number | null;
  games?: number;
  share: number;
  /** Menor uso entre as duas espécies (confiança do lift). */
  minUsage?: number;
}

function pairInfo(ctx: EngineContext, a: string, b: string, candView?: MetaPokemon): PairInfo | null {
  const pa = ctx.meta.pokemon?.[a];
  const pb = candView ?? ctx.meta.pokemon?.[b];
  const minUsage = Math.min(pa?.usage ?? 0, pb?.usage ?? 0);
  if (candView?.formId) {
    // Visão de uma só forma: a lista de parceiros do membro mistura as formas do candidato.
    const own = candView.teammates?.find(t => t.id === a);
    return own ? { lift: own.lift, winRate: own.winRate, games: own.games, share: own.share, minUsage } : null;
  }
  const fromA = pa?.teammates?.find(t => t.id === b);
  if (fromA) return { lift: fromA.lift, winRate: fromA.winRate, games: fromA.games, share: fromA.share, minUsage };
  const fromB = pb?.teammates?.find(t => t.id === a);
  if (fromB) return { lift: fromB.lift, winRate: fromB.winRate, games: fromB.games, share: fromB.share, minUsage };
  return null;
}

/**
 * Lift encolhido para 1 quando a amostra é pequena (poucos jogos juntos ou
 * espécie pouco usada): evita "7× de lift" vindo de meia dúzia de times.
 */
function shrunkLift(info: PairInfo): number {
  const lift = Math.min(4, info.lift ?? 1);
  const byGames = info.games ? Math.min(1, info.games / 40) : 0;
  const byUsage = Math.min(1, (info.minUsage ?? 0) / 0.05);
  return 1 + (lift - 1) * Math.max(0.15, byGames, byUsage);
}

function typeSynergy(memberDefense: Record<TypeName, number>, p: Profile): { value: number; covers: boolean } {
  let net = 0;
  let covers = false;
  for (const t of TYPES) {
    const mw = memberDefense[t];
    const cw = p.defense[t];
    if (mw > 1 && cw < 1) {
      net += cw === 0 ? 1.2 : 1;
      covers = true;
    } else if (mw > 1 && cw > 1) net -= 1;
    else if (cw > 1 && mw < 1) net += 0.4;
  }
  return { value: clamp01(0.5 + net / 8), covers };
}

interface SideSubject {
  roles: Set<string>;
  moves: Set<string>;
  abilities: Set<string>;
  immune: (t: TypeName) => boolean;
}

function sideMatches(cond: string, s: SideSubject): boolean {
  const [kind, value] = cond.split(':');
  if (!value) return false;
  if (kind === 'role') return s.roles.has(value);
  if (kind === 'move') return s.moves.has(toId(value));
  if (kind === 'ability') return s.abilities.has(toId(value));
  if (kind === 'immune') return s.immune(value as TypeName);
  return false;
}

/* ------------------------------ avaliação ------------------------------ */

interface Reason {
  text: string;
  salience: number;
  /** Depende do set montado: papel cumprido ou habilidade em batalha. */
  needs?: { role?: string; ability?: string };
}

interface Scored {
  species: SpeciesData;
  profile: Profile;
  values: Record<keyof SuggestionWeights, number>;
  reasons: Reason[];
  factor: number;
  /** Mega Stone assumida na avaliação (o set montado precisa segurá-la). */
  megaItem?: string;
}

interface Env {
  ctx: EngineContext;
  state: TeamState;
  valid: Member[];
  weights: SuggestionWeights;
  active: Record<keyof SuggestionWeights, boolean>;
  hasMeta: boolean;
  maxUsage: number;
  megaCount: number;
  /** Avalia como se houvesse vaga de Mega (lista "se você liberar uma Mega"). */
  forceMega: boolean;
  missing: Set<string>;
  providerCount: Map<string, number>;
  uncovered: TypeName[];
  threats: ReturnType<typeof threatList>;
  modes: ReturnType<typeof modeArchetypes>;
  maxCore: number;
  /** Lado "membro" das sinergias de dupla (mesma ordem de `valid`). */
  subjects: SideSubject[];
  /** Golpes que conflitam com o modo da equipe. */
  antiMoves: Set<string>;
  /** Tabelas defensivas dos membros (mesma ordem de `valid`). */
  defenses: Record<TypeName, number>[];
}

function scoreCandidate(env: Env, species: SpeciesData): Scored {
  const { ctx, state, valid, weights } = env;
  // Sem meta, a 2ª Mega não é assumida: só uma Mega Evolui por batalha e o total base da Mega inflaria a nota.
  const allowMega = env.forceMega || (env.hasMeta ? env.megaCount < 2 : env.megaCount === 0);
  const p = profileOf(ctx, species, allowMega);
  const reasons: Reason[] = [];
  const say = (text: string, salience: number, needs?: Reason['needs']) => reasons.push({ text, salience, needs });
  const values = {} as Record<keyof SuggestionWeights, number>;
  const potential = speciesPotential(ctx, species);

  // Sem vaga de Mega: deixa claro que a nota é da forma comum.
  const megaShare = !allowMega ? megaShareOf(ctx, species) : 0;
  if (megaShare >= 0.5) {
    const plain = p.meta?.usage ?? 0;
    say(
      `Avaliado sem Mega (a equipe já tem ${env.megaCount} Megas): ${pctPt(megaShare)} dos ${species.name} no meta usam Mega; ` +
        `sem Mega o uso é de ${pctPt(plain, plain < 0.01 ? 2 : 1)}${p.meta?.winRate != null && (p.meta.games ?? 0) >= 50 ? ` e a vitória ${pctPt(p.meta.winRate)}` : ''}.`,
      0.6,
    );
  }

  // meta
  if (env.hasMeta) {
    const u = p.meta?.usage ?? 0;
    values.meta = p.meta ? clamp01(Math.sqrt(u / env.maxUsage)) : 0.12 * strengthOf(ctx, p);
    if (u >= 0.04) say(`Muito usado no meta: ${pctPt(u, 1)} das equipes (${p.meta!.rank}º mais usado).`, weights.meta * values.meta);
  } else {
    values.meta = strengthOf(ctx, p);
    if (values.meta >= 0.6) say(`Atributos fortes (total base ${p.bst}${p.usesMega ? ', como Mega' : ''}).`, weights.meta * values.meta * 0.6);
  }

  // winRate
  const wr = p.meta?.winRate;
  if (wr !== null && wr !== undefined && p.meta?.games) {
    const f = Math.min(1, p.meta.games / 50);
    values.winRate = clamp01(0.5 + (clamp01((wr - 0.4) / 0.2) - 0.5) * f);
    if (f >= 0.5 && wr >= 0.52) say(`Taxa de vitória ajustada de ${pctPt(wr, 1)} em ${p.meta.games} jogos.`, weights.winRate * (values.winRate - 0.5) * 2);
  } else {
    values.winRate = 0.5;
  }

  // synergy
  if (!valid.length) {
    const cores = (ctx.meta.cores ?? []).filter(c => c.members.includes(species.id));
    const best = cores.sort((a, b) => b.usage - a.usage)[0];
    values.synergy = best && env.maxCore > 0 ? clamp01(0.3 + 0.7 * (best.usage / env.maxCore)) : 0.3;
    if (best && best.usage / env.maxCore >= 0.25) {
      const names = best.members.map(id => ctx.dex.species(id)?.name ?? id);
      say(`Forma o core ${names.join(' + ')} (${pctPt(best.usage, 1)} das equipes${best.winRate ? `, ${pctPt(best.winRate)} de vitórias` : ''}).`, weights.synergy * values.synergy);
    }
  } else {
    let sum = 0;
    let bestPair: { m: Member; info: PairInfo; s: number } | null = null;
    const coversOf: string[] = [];
    for (const [i, m] of valid.entries()) {
      const info = pairInfo(ctx, m.species!.id, species.id, p.meta?.formId ? p.meta : undefined);
      const ts = typeSynergy(env.defenses[i], p);
      if (ts.covers) coversOf.push(m.formName);
      let s: number;
      if (info?.lift) {
        s = clamp01(0.5 + Math.log2(shrunkLift(info)) / 2.5);
        if (info.winRate != null && (info.games ?? 0) >= 20) s = clamp01(s + Math.max(-0.2, Math.min(0.2, (info.winRate - 0.5) * 2)));
        s = 0.75 * s + 0.25 * ts.value;
        if (!bestPair || s > bestPair.s) bestPair = { m, info, s };
      } else if (env.hasMeta && m.meta?.teammates?.length && p.meta) {
        s = 0.7 * 0.42 + 0.3 * ts.value; // não é parceiro comum
      } else if (env.hasMeta) {
        s = 0.6 * 0.42 + 0.4 * ts.value; // sem evidência de parceria no meta
      } else {
        s = ts.value;
      }
      sum += s;
    }
    // Sinergias de dupla da heurística (Fake Out + Trick Room, Earthquake + imune...)
    const cand: SideSubject = {
      roles: new Set([...potential.entries()].filter(([, h]) => h.strength >= 0.3).map(([id]) => id)),
      moves: p.meta?.moves?.length ? p.member.moveIds : p.learn,
      abilities: new Set([p.member.ability, ...(p.meta ? [] : p.abilityIds)]),
      immune: t => p.defense[t] === 0,
    };
    let bonus = 0;
    for (const syn of ctx.heuristics.pairSynergies ?? []) {
      const [left, right] = syn.condition.split('+');
      if (!left || !right) continue;
      // Ex.: "Fake Out dá tempo para o Tailwind" não vale numa equipe de Trick Room.
      if ([left, right].some(c => c.startsWith('move:') && env.antiMoves.has(toId(c.slice(5))))) continue;
      for (const [i, m] of valid.entries()) {
        const mem = env.subjects[i];
        if ((sideMatches(left, mem) && sideMatches(right, cand)) || (sideMatches(left, cand) && sideMatches(right, mem))) {
          bonus += syn.weight * 0.2;
          say(`${syn.descriptionPt} (com ${m.formName}).`, weights.synergy * syn.weight * 0.35);
          break;
        }
      }
    }
    values.synergy = clamp01(sum / valid.length + Math.min(env.hasMeta ? 0.15 : 0.25, bonus));
    if (bestPair?.info.lift && shrunkLift(bestPair.info) >= 1.25) {
      const w = bestPair.info.winRate;
      say(
        `Parceiro frequente de ${bestPair.m.formName} (lift ${num(bestPair.info.lift, 1)}×${w != null && (bestPair.info.games ?? 0) >= 20 ? `, ${pctPt(w)} de vitórias` : ''}).`,
        weights.synergy * (bestPair.s - 0.4) * 2,
      );
    } else if (coversOf.length >= 2 && !env.hasMeta) {
      say(`Cobre fraquezas de ${listPt(coversOf, 3)}.`, weights.synergy * (values.synergy - 0.5) * 2);
    }
  }

  // defensive
  const rows = state.analysis.defensive;
  if (!valid.length) {
    let net = 0;
    for (const t of TYPES) {
      const m = p.defense[t];
      if (m === 0) net += 1.2;
      else if (m < 1) net += 1;
      else if (m >= 4) net -= 1.5;
      else if (m > 1) net -= 1;
    }
    values.defensive = clamp01(0.5 + net / 12);
  } else {
    let raw = 0;
    let best: { type: TypeName; weak: number; mult: number; gain: number } | null = null;
    let worst: { type: TypeName; weak: number; loss: number } | null = null;
    for (const row of rows) {
      const need = row.status === 'bad' ? 1 : row.status === 'warn' ? 0.6 : row.weak === 1 ? 0.25 : 0.05;
      const m = p.defense[row.type];
      let gain = 0;
      if (m === 0) gain = 1.2;
      else if (m <= 0.25) gain = 1.1;
      else if (m < 1) gain = 1;
      else if (m >= 4) gain = -1.3;
      else if (m > 1) gain = -1;
      raw += need * gain;
      if (gain > 0 && row.weak >= 2 && (!best || need * gain > best.gain)) best = { type: row.type, weak: row.weak, mult: m, gain: need * gain };
      if (gain < 0 && row.weak >= 2 && (!worst || -need * gain > worst.loss)) worst = { type: row.type, weak: row.weak, loss: -need * gain };
    }
    values.defensive = clamp01(0.5 + raw / 3);
    if (best) {
      const via = p.member.form && defenseMult(ctx, { ...p.member, ability: '' }, best.type) !== best.mult ? ` (${p.member.abilityName})` : '';
      const verb = best.mult === 0 ? `Imune a ${TYPE_PT[best.type]}${via}` : `Resiste a ${TYPE_PT[best.type]}${via}`;
      say(`${verb}, fraqueza de ${best.weak} membros.`, weights.defensive * best.gain * 0.8, via ? { ability: p.member.ability } : undefined);
    }
    if (worst && worst.loss >= 0.6) say(`Atenção: também é fraco a ${TYPE_PT[worst.type]}, que já pesa sobre ${worst.weak} membros.`, weights.defensive * worst.loss * 0.3);
  }

  // offensive
  {
    const uncovered = env.uncovered;
    let fresh = 0;
    const hits: TypeName[] = [];
    for (const t of uncovered) {
      let best = 0;
      for (const [a, w] of p.attack) if (attackEffectiveness(ctx.dex.data.typechart, a, [t], undefined, p.member.ability) >= 2) best = Math.max(best, w);
      if (best > 0) {
        fresh += best;
        if (best >= 0.5) hits.push(t);
      }
    }
    const form = p.member.form ?? species;
    const power = clamp01((baseAttack(form, p.member.ability) - 80) / 60);
    const cov = uncovered.length ? clamp01(fresh / Math.min(4, uncovered.length)) : 0.3;
    values.offensive = clamp01(0.75 * cov + 0.25 * power);
    if (valid.length && hits.length) say(`Acerta super efetivo ${listPt(hits.map(t => TYPE_PT[t]), 4)}, que a equipe não cobre.`, weights.offensive * cov);
  }

  // roles
  {
    let raw = 0;
    let bestRole: { role: RoleDef; via: string[]; gain: number } | null = null;
    for (const role of coreRoles(ctx)) {
      const hit = potential.get(role.id);
      if (!hit) continue;
      const providers = env.providerCount.get(role.id) ?? 0;
      const need = !valid.length || env.missing.has(role.id) ? 1 : providers === 1 ? (role.id === 'speedcontrol' ? 0.5 : 0.3) : 0.1;
      const gain = need * role.weight * hit.strength;
      raw += gain;
      if (need === 1 && valid.length && (!bestRole || gain > bestRole.gain)) bestRole = { role, via: hit.via, gain };
    }
    values.roles = clamp01(raw / 1.2);
    if (bestRole && bestRole.gain >= 0.15) {
      say(roleText(bestRole.role, bestRole.via), weights.roles * bestRole.gain * 1.3, { role: bestRole.role.id });
    }
  }

  // threats
  if (env.threats.length) {
    let num_ = 0;
    let den = 0;
    const answered: string[] = [];
    for (const t of env.threats) {
      const tm = t.profile.member;
      if (!tm.form) continue;
      const moldBreaker = MOLD_BREAKERS.has(tm.ability);
      const maxIn = Math.max(0, ...t.profile.attackTypes.map(type => (moldBreaker ? defenseMult(ctx, p.member, type, tm.ability) : p.defense[type])));
      let hit = 0;
      for (const [a, w] of p.attack) hit = Math.max(hit, w * (attackEffectiveness(ctx.dex.data.typechart, a, tm.types, tm.ability, p.member.ability) >= 2 ? 1 : 0));
      const faster = p.speed > t.profile.speed;
      let ans = 0;
      if (maxIn <= 0.5) ans = 1;
      else if (hit >= 0.5 && faster) ans = 0.8;
      else if (hit >= 0.5 && maxIn <= 1) ans = 0.55;
      else if (maxIn <= 1) ans = 0.25;
      if (maxIn >= 2) ans -= 0.3;
      num_ += t.danger * ans;
      den += t.danger;
      if (ans >= 0.55) answered.push(t.name);
    }
    values.threats = den ? clamp01(num_ / den) : 0.5;
    if (answered.length && valid.length) say(`Responde bem a ${listPt(answered, 3)} (ameaças do meta para a equipe).`, weights.threats * values.threats);
  } else {
    values.threats = 0.5;
  }

  // archetype
  if (env.modes.length) {
    let acc = 0;
    let den = 0;
    // Com dados de meta, "abusa do modo" pelos golpes que a espécie realmente usa; sem dados, pelo learnset.
    const likelyMoves = p.meta?.moves?.length ? p.member.moveIds : p.learn;
    const subj: TraitSubject = { species: p.member.form ?? species, types: p.member.types, ability: p.member.ability, moves: likelyMoves };
    for (const a of env.modes) {
      let fit = 0;
      const isSetter = a.def.setters.moves.some(mv => p.learn.has(mv)) || a.def.setters.abilities.some(ab => p.abilityIds.includes(ab) || ab === p.member.ability);
      const positive = a.def.abusers.traits.filter(t => !t.startsWith('!'));
      const byProfile = a.def.abusers.abilities.includes(p.member.ability) || positive.some(t => !t.includes('move:') && matchTrait(t, subj));
      const byMove = !byProfile && positive.some(t => t.includes('move:') && matchTrait(t, subj));
      const abuser = byProfile || byMove;
      const anti = a.def.abusers.traits.filter(t => t.startsWith('!')).some(t => matchTrait(t, subj));
      if (isSetter && !GENERIC_ARCHETYPES.has(a.def.id)) fit += a.setters >= 1 ? 0.35 : 0.6;
      // Golpe só "possível" (learnset, sem dados de uso) conta pela metade.
      if (byProfile) fit += 0.6;
      else if (byMove) fit += p.meta?.moves?.length ? 0.6 : 0.3;
      if (anti) fit -= 0.6;
      const spe = (p.member.form ?? species).baseStats.spe;
      if (a.def.speedProfile === 'slow' && spe >= 100) fit -= 0.5;
      if (a.def.speedProfile === 'fast' && spe <= 50) fit -= 0.4;
      const ownWeather = WEATHER_ABILITY[p.member.ability];
      if (ownWeather && ['sun', 'rain', 'sand', 'snow'].includes(a.def.id) && ownWeather !== a.def.id) fit -= 0.7;
      fit = Math.max(-1, Math.min(1, fit));
      acc += a.confidence * fit;
      den += a.confidence;
      if (fit >= 0.5) say(isSetter && !abuser ? `Setter extra para o modo ${a.def.namePt} da equipe.` : `Aproveita o modo ${a.def.namePt} da equipe.`, weights.archetype * fit * a.confidence);
      // Aviso de conflito com piso de relevância: precisa aparecer entre os motivos.
      if (fit <= -0.4) say(`Atenção: conflita com o modo ${a.def.namePt} da equipe.`, 0.05 * a.confidence + weights.archetype * -fit * a.confidence * 0.5);
    }
    values.archetype = den ? clamp01(0.5 + 0.5 * (acc / den)) : 0.5;
  } else {
    values.archetype = 0.5;
  }

  // Segunda Mega: só uma Mega Evolução por batalha.
  let factor = 1;
  if (p.usesMega && env.megaCount === 1 && !env.forceMega) {
    factor = 0.94;
    say('Seria a segunda Mega da equipe: só uma Mega Evolui por batalha.', 0.02);
  }
  // Clima/terreno próprio que substitui o da equipe (Drizzle numa equipe de sol...).
  const teamField = state.field;
  const ownWeather = ABILITY_WEATHER[p.member.ability];
  if (valid.length && ownWeather && teamField.weather && ownWeather !== teamField.weather) {
    factor *= 0.75;
    say(`Atenção: ${p.member.abilityName} troca ${WEATHER_PT[teamField.weather]} da equipe ${WEATHER_BY_PT[ownWeather]}.`, 0.5);
  }
  const ownTerrain = ABILITY_TERRAIN[p.member.ability];
  if (valid.length && ownTerrain && teamField.terrain && ownTerrain !== teamField.terrain) {
    factor *= 0.85;
    say(`Atenção: ${p.member.abilityName} troca o ${teamField.terrain} Terrain da equipe pelo ${ownTerrain} Terrain.`, 0.4);
  }
  return { species, profile: p, values, reasons, factor, megaItem: p.usesMega ? p.member.item?.name : undefined };
}

/** "Traz Tailwind (controle de velocidade), que falta na equipe." */
function roleText(role: RoleDef, via: string[]): string {
  const quality = (v: string) => role.quality?.[toId(v)] ?? 1;
  const list = via.filter(v => v !== 'perfil').sort((a, b) => quality(b) - quality(a)).slice(0, 2);
  const phrase = rolePhrase(role);
  if (list.length === 1 && toId(list[0]) === toId(phrase)) return `Traz ${list[0]}, que falta na equipe.`;
  return list.length ? `Traz ${listPt(list)} (${phrase}), que falta na equipe.` : `Cumpre ${phrase}, que falta na equipe.`;
}

/** Sugestão sem o set montado (ranking completo, usado pela CLI e testes). */
export type RankedPokemon = Omit<PokemonSuggestion, 'set'>;

export function suggestPokemon(ctx: EngineContext, team: Team, limit = 12): PokemonSuggestion[] {
  const n = Math.max(1, Math.min(50, Math.floor(limit) || 12));
  const { list, toPublic } = rankCandidates(ctx, team ?? []);
  const taken = new Set((team ?? []).map(s => toId(s?.item)).filter(Boolean));
  return list.slice(0, n).map(entry => {
    // A Mega assumida na nota vai no set (os motivos falam dela), salvo Item Clause.
    const mega = entry.r.megaItem && !taken.has(toId(entry.r.megaItem)) ? entry.r.megaItem : undefined;
    const set = buildSet(ctx, team ?? [], entry.r.species.name, mega ? { item: mega } : {});
    return { ...toPublic(entry, set), set };
  });
}

/** Todos os candidatos (espécies escolhíveis fora da equipe) ordenados pela nota. */
export function rankPokemon(ctx: EngineContext, team: Team): RankedPokemon[] {
  const { list, toPublic } = rankCandidates(ctx, team ?? []);
  return list.map(entry => toPublic(entry));
}

interface RankEntry {
  r: Scored;
  score: number;
}

function rankCandidates(
  ctx: EngineContext,
  team: Team,
  opts: { forceMega?: boolean } = {},
): { list: RankEntry[]; toPublic: (e: RankEntry, set?: PokemonSet) => RankedPokemon; megaHolders: Member[] } {
  const state = teamState(ctx, team);
  const valid = state.valid;
  const weights = mergedWeights(ctx);
  const hasMeta = hasMetaData(ctx);
  const metaMons = Object.values(ctx.meta.pokemon ?? {});
  const active: Record<keyof SuggestionWeights, boolean> = {
    meta: true,
    winRate: metaMons.some(m => m.winRate != null && m.games > 0),
    synergy: valid.length > 0 || (ctx.meta.cores ?? []).length > 0,
    defensive: true,
    offensive: true,
    roles: true,
    threats: hasMeta,
    archetype: false,
  };
  const providerCount = new Map<string, number>();
  for (const c of state.analysis.roles) providerCount.set(c.role.id, c.providers.length);
  const modes = valid.length ? modeArchetypes(state.archetypes, 0.35) : [];
  active.archetype = modes.length > 0;
  const env: Env = {
    ctx,
    state,
    valid,
    weights,
    active,
    hasMeta,
    maxUsage: Math.max(1e-9, ...metaMons.map(m => m.usage)),
    megaCount: valid.filter(m => isMegaStone(m.item)).length,
    forceMega: !!opts.forceMega,
    missing: new Set(state.analysis.missingRoles.map(r => r.id)),
    providerCount,
    uncovered: valid.length ? state.analysis.offensive.filter(r => r.best < 2).map(r => r.type) : [...TYPES],
    threats: hasMeta ? threatList(ctx, state, 10) : [],
    modes,
    maxCore: Math.max(0, ...(ctx.meta.cores ?? []).map(c => c.usage)),
    subjects: valid.map(m => {
      const table = defenseTable(ctx, m);
      return { roles: new Set(state.roles[m.slot]?.keys() ?? []), moves: m.moveIds, abilities: new Set([m.ability]), immune: (t: TypeName) => table[t] === 0 };
    }),
    defenses: valid.map(m => defenseTable(ctx, m)),
    antiMoves: new Set(modes.filter(a => a.confidence >= 0.5).flatMap(a => a.def.antiSynergyMoves)),
  };
  const usedNums = new Set(state.members.filter(m => m.species).map(m => ctx.dex.baseOf(m.species!).num));
  const candidates = ctx.dex.selectableSpecies().filter(s => !usedNums.has(s.num));
  const totalWeight = KEYS.reduce((s, k) => s + (active[k] ? weights[k] : 0), 0) || 1;

  const scored = candidates.map(species => {
    const r = scoreCandidate(env, species);
    const score = (KEYS.reduce((s, k) => s + (active[k] ? weights[k] * r.values[k] : 0), 0) / totalWeight) * r.factor;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score || (b.r.profile.meta?.usage ?? 0) - (a.r.profile.meta?.usage ?? 0));

  const toPublic = ({ r, score }: RankEntry, set?: PokemonSet): RankedPokemon => {
    const components: ScoreComponent[] = KEYS.map(k => ({
      key: k,
      labelPt: k === 'meta' && !hasMeta ? 'Força estimada (sem dados de meta)' : LABELS[k],
      value: r.values[k],
      weight: active[k] ? weights[k] : 0,
    }));
    const battle = set ? ctx.dex.battleForm(set) : r.profile.member.form;
    const asMega = set ? !!battle?.isMega : r.profile.usesMega;
    return {
      species: r.species.name,
      score,
      components,
      reasonsPt: pickReasons(r, set ? reconcile(ctx, r.reasons, set) : r.reasons),
      meta: r.profile.meta,
      form: { name: (asMega ? battle?.name : r.species.name) ?? r.species.name, mega: asMega },
    };
  };
  return { list: scored, toPublic, megaHolders: valid.filter(m => isMegaStone(m.item)) };
}

/**
 * Com as vagas de Mega ocupadas (2 Megas), as sugestões avaliam a forma comum.
 * Esta lista mostra quem entraria entre as melhores opções se uma vaga de Mega
 * fosse liberada, e quais Megas atuais poderiam ceder a vaga.
 */
export function suggestMegaAlternatives(ctx: EngineContext, team: Team, limit = 3): MegaAlternative[] {
  const normal = rankCandidates(ctx, team ?? []);
  if (normal.megaHolders.length < 2) return [];
  const normalScore = new Map(normal.list.map(e => [e.r.species.id, e.score]));
  // Entraria no top 10 das sugestões e a Mega é o que faz a diferença (≥ 5% acima da forma comum).
  const cutoff = normal.list[Math.min(normal.list.length - 1, 9)]?.score ?? 0;
  const forced = rankCandidates(ctx, team ?? [], { forceMega: true });
  const holders = normal.megaHolders.map(m => m.formName);
  return forced.list
    .filter(e => e.r.profile.usesMega && e.r.megaItem && e.score > cutoff && e.score > (normalScore.get(e.r.species.id) ?? 0) * 1.05)
    .slice(0, Math.max(1, Math.floor(limit) || 3))
    .map(e => ({
      species: e.r.species.name,
      megaItem: e.r.megaItem!,
      megaForm: e.r.profile.member.form?.name ?? e.r.species.name,
      score: e.score,
      scoreWithoutMega: normalScore.get(e.r.species.id) ?? null,
      replaces: holders,
      reasonsPt: forced.toPublic(e).reasonsPt,
    }));
}

/**
 * Motivos coerentes com o set montado: "Traz Tailwind" só se o set tiver
 * Tailwind (senão o papel é reescrito com o que o set traz, ou some) e
 * imunidade por habilidade só se o set usar essa habilidade.
 */
function reconcile(ctx: EngineContext, reasons: Reason[], set: PokemonSet): Reason[] {
  let roles: ReturnType<typeof setRoles> | undefined;
  const out: Reason[] = [];
  for (const x of reasons) {
    if (x.needs?.ability && toId(ctx.dex.battleAbility(set) ?? set.ability) !== x.needs.ability) continue;
    if (x.needs?.role) {
      roles ??= setRoles(ctx, set);
      const hit = roles.get(x.needs.role);
      const role = roleById(ctx, x.needs.role);
      if (!hit || !role) continue;
      out.push({ ...x, text: roleText(role, hit.via) });
      continue;
    }
    out.push(x);
  }
  return out;
}

function pickReasons(r: Scored, reasons: Reason[]): string[] {
  const sorted = [...reasons].sort((a, b) => b.salience - a.salience);
  const out: string[] = [];
  for (const x of sorted) {
    if (out.length >= 5) break;
    if (x.salience <= 0 && out.length >= 2) break;
    if (!out.includes(x.text)) out.push(x.text);
  }
  const form = r.profile.member.form ?? r.species;
  if (out.length < 2) out.push(`${form.types.map(t => TYPE_PT[t]).join('/')}, Velocidade base ${form.baseStats.spe}${r.profile.usesMega ? ` (como ${form.name})` : ''}.`);
  if (out.length < 2) {
    const types = attackTypesOf(r.profile.member);
    if (types.length) out.push(`Ataca com ${listPt(types.map(t => TYPE_PT[t]), 4)}.`);
    else out.push(`Total de atributos base ${r.profile.bst}.`);
  }
  return out;
}
