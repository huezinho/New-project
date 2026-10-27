/**
 * Análise de equipe: fraquezas/resistências, cobertura ofensiva, papéis,
 * arquétipo, tiers de velocidade, ameaças do meta, problemas de regra e nota.
 */
import type {
  ArchetypeDef, CoverageRow, EngineContext, RoleCoverage, RoleDef, SpeedEntry, TeamAnalysis, TeamIssue, ThreatEntry, TypeMatchupRow,
} from './api.ts';
import { TYPE_PT } from './i18n.ts';
import { toId } from './id.ts';
import { allRoles, matchTrait, memberRoles, type RoleMap, type TraitSubject } from './roles.ts';
import { SP_TOTAL, totalSP, validateSP } from './stats.ts';
import {
  bestHit, defenseMult, hasMetaData, isDamaging, isMegaStone, maxSpeed, metaThreats, moveTypeFor, PROTECT_MOVES,
  resolveTeam, type FieldState, type Member, type Terrain, type ThreatProfile, type Weather,
} from './team.ts';
import { effectivenessWithAbility, TYPES, typeEffectiveness } from './typechart.ts';
import { clamp01, listPt, memo, pctPt } from './util.ts';
import type { Team, TypeName } from './types.ts';

export const ARCHETYPE_WEATHER: Record<string, Weather> = { sun: 'Sun', rain: 'Rain', sand: 'Sand', snow: 'Snow' };
export const ARCHETYPE_TERRAIN: Record<string, Terrain> = { psychicterrain: 'Psychic', grassyterrain: 'Grassy', electricterrain: 'Electric' };
const GENERIC_ARCHETYPES = new Set(['balance', 'hyperoffense']);
/** Habilidades que dobram a velocidade em um clima. */
const WEATHER_SPEED: Record<string, Weather> = { chlorophyll: 'Sun', swiftswim: 'Rain', sandrush: 'Sand', slushrush: 'Snow' };

export interface ArchetypeHit {
  def: ArchetypeDef;
  confidence: number;
  via: string[];
  setters: number;
  abusers: number;
}

export interface TeamState {
  ctx: EngineContext;
  team: Team;
  members: Member[];
  /** Membros com espécie reconhecida. */
  valid: Member[];
  /** Papéis por membro (mesma ordem de `members`). */
  roles: RoleMap[];
  archetypes: ArchetypeHit[];
  field: FieldState;
  threats: ThreatEntry[];
  analysis: TeamAnalysis;
}

const traitSubject = (m: Member): TraitSubject => ({ species: m.form!, types: m.types, ability: m.ability, moves: m.moveIds });

/* ---------------------------- arquétipos ---------------------------- */

export function detectArchetypes(ctx: EngineContext, members: Member[]): ArchetypeHit[] {
  const valid = members.filter(m => m.form);
  const out: ArchetypeHit[] = [];
  for (const def of ctx.heuristics.archetypes ?? []) {
    const setterMoves = new Set(def.setters.moves.map(toId));
    const setterAbilities = new Set(def.setters.abilities.map(toId));
    const abuserAbilities = new Set(def.abusers.abilities.map(toId));
    const positive = def.abusers.traits.filter(t => !t.startsWith('!'));
    const negative = def.abusers.traits.filter(t => t.startsWith('!'));
    const via: string[] = [];
    let setters = 0;
    let abusers = 0;
    let antis = 0;
    for (const m of valid) {
      const what = [
        ...(setterAbilities.has(m.ability) ? [m.abilityName] : []),
        ...m.moves.filter(x => setterMoves.has(x.id)).map(x => x.name),
      ];
      if (what.length) {
        setters++;
        via.push(`${m.formName}: ${what.join(', ')}`);
      }
      const subj = traitSubject(m);
      if (abuserAbilities.has(m.ability) || positive.some(t => matchTrait(t, subj))) {
        abusers++;
        if (!what.length) via.push(abuserAbilities.has(m.ability) ? `${m.formName}: ${m.abilityName}` : m.formName);
      } else if (negative.some(t => matchTrait(t, subj))) {
        antis++;
      }
    }
    let confidence: number;
    if (GENERIC_ARCHETYPES.has(def.id)) {
      confidence = (setters ? 0.2 : 0) + 0.6 * Math.min(1, abusers / 4);
    } else {
      confidence = setters ? 0.45 + (setters > 1 ? 0.1 : 0) : 0;
      confidence += 0.45 * Math.min(1, abusers / 3);
      if (!setters) confidence = Math.min(confidence, 0.2);
    }
    confidence -= 0.08 * antis;
    if (def.requires) {
      const reqMoves = new Set(def.requires.moves.map(toId));
      const reqAbilities = new Set(def.requires.abilities.map(toId));
      const ok = valid.some(m => reqAbilities.has(m.ability) || m.moves.some(x => reqMoves.has(x.id)));
      if (!ok) confidence *= 0.4;
    }
    out.push({ def, confidence: clamp01(confidence), via, setters, abusers });
  }
  // "Balanceada" é o rótulo de reserva: perde força quando há um modo claro.
  const strongest = Math.max(0, ...out.filter(a => a.def.id !== 'balance').map(a => a.confidence));
  for (const a of out) {
    if (a.def.id !== 'balance') continue;
    a.confidence = Math.min(0.6, a.confidence) * (strongest >= 0.6 ? 0.5 : 1);
  }
  // Dois climas (ou terrenos) com setter competem entre si.
  for (const group of [ARCHETYPE_WEATHER, ARCHETYPE_TERRAIN]) {
    const active = out.filter(a => group[a.def.id] && a.setters > 0);
    if (active.length > 1) for (const a of active) a.confidence = clamp01(a.confidence - 0.2);
  }
  return out.filter(a => a.confidence >= 0.25).sort((a, b) => b.confidence - a.confidence);
}

export function fieldOf(archetypes: ArchetypeHit[]): FieldState {
  const weather = archetypes.find(a => ARCHETYPE_WEATHER[a.def.id] && a.setters > 0);
  const terrain = archetypes.find(a => ARCHETYPE_TERRAIN[a.def.id] && a.setters > 0);
  return {
    weather: weather ? ARCHETYPE_WEATHER[weather.def.id] : undefined,
    terrain: terrain ? ARCHETYPE_TERRAIN[terrain.def.id] : undefined,
  };
}

/* ----------------------------- defesa ------------------------------ */

export function defensiveRows(ctx: EngineContext, members: Member[]): TypeMatchupRow[] {
  const chart = ctx.dex.data.typechart;
  return TYPES.map(type => {
    const row: TypeMatchupRow = { type, multipliers: [], weak: 0, resist: 0, immune: 0, abilityNotes: [], status: 'ok' };
    for (const m of members) {
      const mult = defenseMult(ctx, m, type);
      row.multipliers.push(mult);
      if (!m.form) continue;
      if (mult > 1) row.weak++;
      else if (mult === 0) row.immune++;
      else if (mult < 1) row.resist++;
      const base = typeEffectiveness(chart, type, m.types);
      const byAbility = effectivenessWithAbility(chart, type, m.types, m.ability);
      if (byAbility !== base) {
        const effect = byAbility === 0 ? 'imune' : byAbility < base ? 'reduz o dano' : 'aumenta o dano';
        row.abilityNotes.push(`${m.formName}: ${m.abilityName} (${effect})`);
      } else if (mult !== base && type === 'Ground' && m.itemId === 'airballoon') {
        row.abilityNotes.push(`${m.formName}: Air Balloon (imune até estourar)`);
      }
    }
    const answers = row.resist + row.immune;
    if (row.weak >= 3 || (row.weak >= 2 && answers === 0)) row.status = 'bad';
    else if (row.weak >= 2 && row.weak > answers) row.status = 'warn';
    return row;
  });
}

/* ----------------------------- ataque ------------------------------ */

export function coverageRows(ctx: EngineContext, members: Member[], field: FieldState = {}): CoverageRow[] {
  const valid = members.filter(m => m.form);
  return TYPES.map(type => {
    let best = 0;
    const hitters: string[] = [];
    for (const m of valid) {
      const mult = bestHit(ctx, m, [type], undefined, field);
      best = Math.max(best, mult);
      if (mult >= 2) hitters.push(m.formName);
    }
    return { type, best, hitters };
  });
}

/* ------------------------------ papéis ------------------------------ */

/** Papéis que contam para "papéis faltando" (escopo de equipe e peso relevante). */
export function coreRoles(ctx: EngineContext): RoleDef[] {
  return allRoles(ctx).filter(r => r.scope !== 'member' && r.weight >= 0.25);
}

export function roleCoverage(ctx: EngineContext, members: Member[], roles: RoleMap[]): { coverage: RoleCoverage[]; missing: RoleDef[] } {
  const coverage: RoleCoverage[] = allRoles(ctx).map(role => ({
    role,
    providers: members.flatMap((m, i) => {
      const hit = roles[i]?.get(role.id);
      return hit && m.form ? [{ slot: m.slot, species: m.formName, via: hit.via }] : [];
    }),
  }));
  const hasMembers = members.some(m => m.form);
  const missing = hasMembers
    ? coreRoles(ctx)
        .filter(r => !coverage.find(c => c.role.id === r.id)?.providers.length)
        .sort((a, b) => b.weight - a.weight)
    : [];
  return { coverage, missing };
}

/* ---------------------------- velocidade ---------------------------- */

function natureTag(m: Member): string {
  if (!m.nature) return 'neutra';
  if (m.nature.plus === 'spe' && m.nature.minus !== 'spe') return `${m.nature.name} +Spe`;
  if (m.nature.minus === 'spe' && m.nature.plus !== 'spe') return `${m.nature.name} −Spe`;
  return m.nature.name;
}

export function speedTiers(ctx: EngineContext, members: Member[], field: FieldState): SpeedEntry[] {
  const out: SpeedEntry[] = [];
  const valid = members.filter(m => m.form);
  const tailwind = valid.some(m => m.moveIds.has('tailwind'));
  for (const m of valid) {
    const scarf = m.itemId === 'choicescarf';
    const speed = scarf ? Math.floor(m.stats.spe * 1.5) : m.stats.spe;
    const base = `${m.set.sp?.spe ?? 0} SP, ${natureTag(m)}`;
    out.push({ slot: m.slot, species: m.formName, speed, label: scarf ? `${base} · Choice Scarf (×1,5)` : base, isMeta: false });
    const doubler = WEATHER_SPEED[m.ability];
    if (doubler && field.weather === doubler) {
      out.push({ slot: m.slot, species: m.formName, speed: speed * 2, label: `${m.abilityName} no clima (×2)`, isMeta: false });
    }
    if (tailwind) out.push({ slot: m.slot, species: m.formName, speed: speed * 2, label: 'sob Tailwind (×2)', isMeta: false });
  }
  for (const t of metaThreats(ctx, 30)) {
    const form = t.member.form;
    if (!form) continue;
    if (t.hasSpreadData) {
      const label = `spread mais comum: ${t.set.nature ?? 'neutra'}, ${t.set.sp.spe} SP${t.scarf ? ' · Choice Scarf' : ''}`;
      out.push({ species: form.name, speed: t.speed, label, isMeta: true, usage: t.meta.usage });
    } else {
      const top = t.scarf ? Math.floor(maxSpeed(form) * 1.5) : maxSpeed(form);
      out.push({ species: form.name, speed: top, label: `máx. estimado: 32 SP, +Spe${t.scarf ? ' · Choice Scarf' : ''} (sem dados de spread)`, isMeta: true, usage: t.meta.usage });
    }
  }
  return out.sort((a, b) => b.speed - a.speed || Number(a.isMeta) - Number(b.isMeta));
}

/* ----------------------------- ameaças ------------------------------ */

function memberSpeed(m: Member): number {
  return m.itemId === 'choicescarf' ? Math.floor(m.stats.spe * 1.5) : m.stats.spe;
}

export function threatEntries(ctx: EngineContext, members: Member[], field: FieldState, limit = 20): ThreatEntry[] {
  const valid = members.filter(m => m.form);
  if (!valid.length) return [];
  const threats = metaThreats(ctx, limit);
  const maxUsage = Math.max(1e-9, ...threats.map(t => t.meta.usage));
  const n = valid.length;
  const out: ThreatEntry[] = [];
  for (const t of threats) {
    if (!t.member.form) continue;
    const victims: string[] = [];
    const answers: string[] = [];
    let victimScore = 0;
    let faster = 0;
    for (const m of valid) {
      const maxIn = Math.max(0, ...t.attackTypes.map(type => defenseMult(ctx, m, type, t.member.ability)));
      const stabIn = Math.max(0, ...t.member.types.map(type => defenseMult(ctx, m, type, t.member.ability)));
      const hits = bestHit(ctx, m, t.member.types, t.member.ability, field);
      const tFaster = t.speed > memberSpeed(m);
      if (maxIn >= 2) {
        victims.push(m.formName);
        victimScore += maxIn >= 4 ? 1.3 : 1;
        if (tFaster) {
          victimScore += 0.35;
          faster++;
        }
      } else if (stabIn <= 0.5 || hits >= 2) {
        answers.push(m.formName);
      }
    }
    const pressure = clamp01(0.1 + (0.9 * victimScore) / (n * 1.1) - (0.35 * answers.length) / n);
    const danger = clamp01(pressure * (0.55 + 0.45 * Math.sqrt(t.meta.usage / maxUsage)));
    out.push({
      species: t.member.formName,
      usage: t.meta.usage,
      danger,
      answers,
      victims,
      reasonPt: threatReason(t, victims, answers, faster),
    });
  }
  return out.sort((a, b) => b.danger - a.danger).slice(0, 10);
}

function threatReason(t: ThreatProfile, victims: string[], answers: string[], faster: number): string {
  const types = listPt(t.attackTypes.map(x => TYPE_PT[x]), 4);
  const parts: string[] = [];
  if (victims.length) {
    parts.push(`Acerta super efetivo ${victims.length} membro${victims.length > 1 ? 's' : ''} (${listPt(victims)}) com ${types}`);
    if (faster) parts.push(`é mais rápido que ${faster} deles`);
  } else {
    parts.push(`Nenhum membro é fraco aos golpes comuns (${types})`);
  }
  const tail = answers.length ? `; respostas: ${listPt(answers)}` : '; nenhuma resposta clara na equipe';
  return `${parts.join(' e ')}${tail}.`;
}

/* ----------------------------- problemas ----------------------------- */

const STATUS_OK_WITH_CHOICE = new Set(['trick', 'switcheroo']);

export function teamIssues(ctx: EngineContext, members: Member[], roles: RoleMap[], archetypes: ArchetypeHit[]): TeamIssue[] {
  const issues: TeamIssue[] = [];
  const reg = ctx.dex.regulation;
  const push = (severity: TeamIssue['severity'], messagePt: string, slot?: number) => issues.push({ severity, messagePt, slot });

  if (members.length > 6) push('error', `A equipe tem ${members.length} membros; o máximo é 6.`);
  for (const m of members) {
    const label = m.name || `Membro ${m.slot + 1}`;
    if (!m.species) {
      push('error', `${m.set.species || '(sem espécie)'}: espécie desconhecida no Champions.`, m.slot);
      continue;
    }
    if (m.species.isMega || m.species.battleOnly) {
      push('error', `${label}: formas de batalha não podem ser escolhidas; use a forma base com a Mega Stone.`, m.slot);
    }
    if (!ctx.dex.isLegal(m.species)) push('error', `${label} não é permitido na Reg ${reg}.`, m.slot);
    if (m.set.item) {
      if (!m.item) push('error', `${label}: item desconhecido (${m.set.item}).`, m.slot);
      else if (!m.item.legal[reg]) push('error', `${label}: ${m.item.name} não está disponível no Champions (Reg ${reg}).`, m.slot);
      else if (m.item.megaStone && !m.isMega) push('warn', `${label}: ${m.item.name} não faz este Pokémon Mega Evoluir.`, m.slot);
    }
    if (m.set.ability && !Object.values(m.species.abilities).some(a => toId(a) === toId(m.set.ability))) {
      push('error', `${label} não pode ter a habilidade ${m.set.ability}.`, m.slot);
    }
    const rawMoves = (m.set.moves ?? []).filter(Boolean);
    const seen = new Set<string>();
    for (const raw of rawMoves) {
      const mv = ctx.dex.move(raw);
      if (!mv) {
        push('error', `${label}: golpe desconhecido (${raw}).`, m.slot);
        continue;
      }
      if (!ctx.dex.canLearn(m.species, mv.id)) push('error', `${label} não aprende ${mv.name} no Champions.`, m.slot);
      if (seen.has(mv.id)) push('error', `${label} repete o golpe ${mv.name}.`, m.slot);
      seen.add(mv.id);
    }
    if (rawMoves.length > 4) push('error', `${label} tem mais de 4 golpes.`, m.slot);
    else if (rawMoves.length < 4) {
      push('info', rawMoves.length ? `${label} tem só ${rawMoves.length} golpe${rawMoves.length > 1 ? 's' : ''}; complete os 4.` : `${label} ainda não tem golpes.`, m.slot);
    }
    for (const p of validateSP(m.set.sp ?? {})) push('error', `${label}: ${p}`, m.slot);
    const total = totalSP(m.set.sp ?? {});
    if (total === 0) push('info', `${label}: Stat Points ainda não distribuídos (${SP_TOTAL} disponíveis).`, m.slot);
    else if (total < SP_TOTAL) push('info', `${label}: ${SP_TOTAL - total} SP sem uso.`, m.slot);
    if (m.set.nature && !m.nature) push('warn', `${label}: natureza desconhecida (${m.set.nature}).`, m.slot);
    if (m.set.level && m.set.level !== 50) push('info', `${label}: o Champions usa nível 50 (ajustado automaticamente).`, m.slot);
    if (m.itemId === 'choicescarf') {
      const status = m.moves.filter(mv => !isDamaging(mv) && !STATUS_OK_WITH_CHOICE.has(mv.id));
      if (status.length) push('warn', `${label} com Choice Scarf fica preso no golpe escolhido: ${listPt(status.map(s => s.name))} perde${status.length > 1 ? 'm' : ''} valor.`, m.slot);
    }
  }

  // Item Clause
  const byItem = new Map<string, Member[]>();
  for (const m of members) if (m.itemId) byItem.set(m.itemId, [...(byItem.get(m.itemId) ?? []), m]);
  for (const [, list] of byItem) {
    if (list.length < 2) continue;
    push('error', `Item Clause: ${list[0].item?.name ?? list[0].set.item} aparece em ${listPt(list.map(x => x.name))}; cada item só pode ser usado uma vez.`, list[1].slot);
  }
  // Species Clause (número da Pokédex)
  const byNum = new Map<number, Member[]>();
  for (const m of members) if (m.species) byNum.set(m.species.num, [...(byNum.get(m.species.num) ?? []), m]);
  for (const [, list] of byNum) {
    if (list.length < 2) continue;
    push('error', `Species Clause: ${listPt(list.map(x => x.name))} são a mesma espécie (mesmo número da Pokédex).`, list[1].slot);
  }
  // Megas
  const stones = members.filter(m => isMegaStone(m.item));
  if (stones.length > 2) {
    push('warn', `${stones.length} Mega Stones: só um Pokémon pode Mega Evoluir por batalha, e mais de 2 costuma desperdiçar espaço de item.`);
  } else if (stones.length === 2) {
    push('info', 'Duas Mega Stones: apenas uma Mega Evolução por batalha — decida no preview qual levar.');
  }

  const valid = members.filter(m => m.form);
  if (valid.length && valid.length < 6) push('info', `A equipe tem ${valid.length} de 6 membros (leve 6 e escolha 4 no preview).`);
  // Protect
  const withMoves = valid.filter(m => (m.set.moves ?? []).filter(Boolean).length >= 3 && m.itemId !== 'choicescarf');
  const noProtect = withMoves.filter(m => !m.moves.some(mv => PROTECT_MOVES.has(mv.id)));
  if (withMoves.length >= 3 && noProtect.length >= 3) {
    push('warn', `${noProtect.length} membros sem Protect (${listPt(noProtect.map(m => m.name))}): em VGC quase todos devem ter Protect/Detect.`);
  }
  const has = (roleId: string) => roles.some((r, i) => members[i]?.form && r.has(roleId));
  if (valid.length >= 3 && !has('speedcontrol')) {
    push('warn', 'Sem controle de velocidade (Tailwind, Trick Room, Icy Wind, Electroweb, Thunder Wave...): a equipe depende só da velocidade natural.');
  }
  if (valid.length >= 3 && !has('fakeout') && !has('redirection') && !has('intimidate')) {
    push('warn', 'Sem Fake Out, redirecionamento nem Intimidate: pouca ferramenta para proteger o parceiro e controlar o campo.');
  }
  // Conflitos com o arquétipo principal
  const main = archetypes.find(a => a.confidence >= 0.5 && a.def.antiSynergyMoves.length);
  if (main) {
    const anti = new Set(main.def.antiSynergyMoves.map(toId));
    for (const m of valid) {
      const bad = m.moves.filter(mv => anti.has(mv.id));
      if (bad.length) push('info', `${m.name}: ${listPt(bad.map(b => b.name))} conflita com o modo ${main.def.namePt} da equipe.`, m.slot);
    }
  }
  // Golpes em área que acertam o parceiro
  for (const m of valid) {
    const partners = valid.filter(p => p !== m);
    if (!partners.length) continue;
    for (const mv of m.moves) {
      if (!isDamaging(mv) || mv.target !== 'allAdjacent') continue;
      const type = moveTypeFor(mv, m.ability).type;
      const safe = partners.filter(p => defenseMult(ctx, p, type, m.ability) === 0 || p.ability === 'telepathy');
      if (!safe.length) push('info', `${m.name}: ${mv.name} também acerta o parceiro e nenhum membro é imune a ${TYPE_PT[type]}.`, m.slot);
    }
  }
  return issues;
}

/* ------------------------------ nota ------------------------------ */

function computeScore(
  ctx: EngineContext,
  valid: Member[],
  defensive: TypeMatchupRow[],
  offensive: CoverageRow[],
  missing: RoleDef[],
  archetypes: ArchetypeHit[],
  threats: ThreatEntry[],
  issues: TeamIssue[],
  hasSpeedControl: boolean,
): number {
  if (!valid.length) return 0;
  const bad = defensive.filter(r => r.status === 'bad').length;
  const warn = defensive.filter(r => r.status === 'warn').length;
  const defense = Math.max(0, 30 - 7 * bad - 2.5 * warn);
  const offense = (15 * offensive.filter(r => r.best >= 2).length) / TYPES.length;
  const core = coreRoles(ctx);
  const totalW = core.reduce((s, r) => s + r.weight, 0) || 1;
  const missingW = missing.reduce((s, r) => s + r.weight, 0);
  const roles = 25 * (1 - missingW / totalW);
  const mode = (hasSpeedControl ? 5 : 0) + 5 * (archetypes[0]?.confidence ?? 0);
  const top = threats.slice(0, 5);
  const threat = top.length ? 10 * (1 - top.reduce((s, t) => s + t.danger, 0) / top.length) : 7;
  const errors = issues.filter(i => i.severity === 'error').length;
  const warns = issues.filter(i => i.severity === 'warn').length;
  const rules = Math.max(0, 10 - 4 * errors - 1.5 * warns);
  const raw = defense + offense + roles + mode + threat + rules;
  const size = Math.sqrt(Math.min(6, valid.length) / 6);
  return Math.round(Math.max(0, Math.min(100, raw * size)));
}

function summarize(
  ctx: EngineContext,
  valid: Member[],
  defensive: TypeMatchupRow[],
  offensive: CoverageRow[],
  missing: RoleDef[],
  archetypes: ArchetypeHit[],
  threats: ThreatEntry[],
  issues: TeamIssue[],
): string[] {
  if (!valid.length) return ['Equipe vazia: adicione Pokémon ou use "completar equipe" para começar pelos destaques do meta.'];
  const out: string[] = [];
  const main = archetypes[0];
  if (main && main.confidence >= 0.4) {
    const others = archetypes.slice(1).filter(a => a.confidence >= 0.4).map(a => a.def.namePt);
    out.push(`Arquétipo: ${main.def.namePt} (confiança ${pctPt(main.confidence)})${others.length ? `, com elementos de ${listPt(others)}` : ''}.`);
  } else {
    out.push('Sem arquétipo definido: considere um modo de controle de velocidade (Tailwind ou Trick Room) ou um clima.');
  }
  const weak = defensive.filter(r => r.status !== 'ok').sort((a, b) => b.weak - a.weak);
  if (weak.length) {
    out.push(`Fraquezas compartilhadas: ${listPt(weak.slice(0, 4).map(r => `${TYPE_PT[r.type]} (${r.weak} fracos, ${r.resist + r.immune} resistem/imunes)`))}.`);
  } else {
    out.push('Defensivamente equilibrada: nenhuma fraqueza compartilhada grave.');
  }
  if (missing.length) out.push(`Papéis faltando: ${listPt(missing.slice(0, 4).map(r => r.namePt.toLowerCase()))}.`);
  const uncovered = offensive.filter(r => r.best < 2).map(r => TYPE_PT[r.type]);
  if (uncovered.length) out.push(`Sem golpe super efetivo contra: ${listPt(uncovered, 6)}.`);
  if (threats.length) {
    const t = threats[0];
    out.push(`Maior ameaça do meta: ${t.species} (uso ${pctPt(t.usage, 1)}) — ${t.victims.length ? `pressiona ${listPt(t.victims)}` : 'pouca pressão direta'}.`);
  } else if (!hasMetaData(ctx)) {
    out.push('Sem dados de meta carregados: ameaças, uso e taxas de vitória ficam indisponíveis (rode o atualizador).');
  }
  const errors = issues.filter(i => i.severity === 'error').length;
  if (errors) out.push(`${errors} problema${errors > 1 ? 's' : ''} de regra/legalidade para corrigir.`);
  return out;
}

/* ------------------------------ entrada ----------------------------- */

const STATE_CACHE_MAX = 96;

/** Estado completo da equipe, com cache LRU por conteúdo (as sugestões reanalisam rascunhos parecidos). */
export function teamState(ctx: EngineContext, team: Team): TeamState {
  const lru = memo(ctx, 'teamStateLRU', () => new Map<string, TeamState>());
  const key = JSON.stringify(team);
  const hit = lru.get(key);
  if (hit) {
    lru.delete(key);
    lru.set(key, hit);
    return hit;
  }
  const state = computeTeamState(ctx, team);
  lru.set(key, state);
  if (lru.size > STATE_CACHE_MAX) {
    const oldest = lru.keys().next().value;
    if (oldest !== undefined) lru.delete(oldest);
  }
  return state;
}

function computeTeamState(ctx: EngineContext, team: Team): TeamState {
  const members = resolveTeam(ctx, team);
  const valid = members.filter(m => m.form);
  const roles = members.map(m => memberRoles(ctx, m));
  const archetypes = detectArchetypes(ctx, members);
  const field = fieldOf(archetypes);
  const defensive = defensiveRows(ctx, members);
  const offensive = coverageRows(ctx, members, field);
  const { coverage, missing } = roleCoverage(ctx, members, roles);
  const threats = threatEntries(ctx, members, field);
  const issues = teamIssues(ctx, members, roles, archetypes);
  const hasSpeedControl = roles.some((r, i) => members[i].form && r.has('speedcontrol'));
  const analysis: TeamAnalysis = {
    defensive,
    offensive,
    roles: coverage,
    missingRoles: missing,
    archetypes: archetypes.map(a => ({ def: a.def, confidence: a.confidence, via: a.via })),
    speedTiers: speedTiers(ctx, members, field),
    threats,
    issues,
    score: computeScore(ctx, valid, defensive, offensive, missing, archetypes, threats, issues, hasSpeedControl),
    summaryPt: summarize(ctx, valid, defensive, offensive, missing, archetypes, threats, issues),
  };
  return { ctx, team, members, valid, roles, archetypes, field, threats, analysis };
}

export function analyzeTeam(ctx: EngineContext, team: Team): TeamAnalysis {
  return teamState(ctx, team).analysis;
}

/** Tipos que a equipe (opcionalmente sem um membro) não acerta super efetivo. */
export function uncoveredTypes(ctx: EngineContext, members: Member[], field: FieldState = {}): TypeName[] {
  return coverageRows(ctx, members, field).filter(r => r.best < 2).map(r => r.type);
}

