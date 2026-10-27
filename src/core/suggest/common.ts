/**
 * Contexto compartilhado pelas sugestões de golpes, itens, habilidades e
 * spreads: o membro do slot, os parceiros, papéis que faltam sem os golpes do
 * membro (eles estão sendo escolhidos) e o arquétipo da equipe.
 */
import type { EngineContext, RoleDef } from '../api.ts';
import { coreRoles, detectArchetypes, fieldOf, teamState, type ArchetypeHit, type TeamState } from '../analysis.ts';
import { memberRoles, type RoleMap } from '../roles.ts';
import {
  attackStat, baseAttack, baseBulk, isDamaging, isMegaStone, metaOf, metaThreats, type FieldState, type Member, type ThreatProfile,
} from '../team.ts';
import { lowerFirst } from '../util.ts';
import type { MetaPokemon, MoveData, Team } from '../types.ts';

/** Arquétipos genéricos (não definem modo de jogo específico). */
export const GENERIC_ARCHETYPES = new Set(['balance', 'hyperoffense']);

export interface SlotContext {
  state: TeamState;
  slot: number;
  member: Member;
  /** O mesmo membro sem golpes (habilidade, item e perfil mantidos). */
  bare: Member;
  /** Parceiros válidos (sem o slot). */
  others: Member[];
  /** Quantos parceiros (mais habilidade/item do próprio membro) cumprem cada papel. */
  providers: Map<string, number>;
  /** Papéis importantes que ninguém cumpre sem os golpes do membro. */
  missing: RoleDef[];
  /** Arquétipos detectados sem os golpes do membro. */
  archetypes: ArchetypeHit[];
  field: FieldState;
  meta?: MetaPokemon;
  hasMeta: boolean;
  /** Mega Stones dos parceiros. */
  otherMegas: Member[];
  otherItems: Map<string, Member>;
}

export function slotContext(ctx: EngineContext, team: Team, slot: number): SlotContext | null {
  const state = teamState(ctx, team);
  const member = state.members[slot];
  if (!member?.form || !member.species) return null;
  const others = state.valid.filter(m => m.slot !== slot);
  const bare: Member = { ...member, moves: [], moveIds: new Set(), assumedMoves: false };
  const providers = new Map<string, number>();
  const count = (map: RoleMap | undefined) => {
    for (const id of map?.keys() ?? []) providers.set(id, (providers.get(id) ?? 0) + 1);
  };
  for (const m of others) count(state.roles[m.slot]);
  count(memberRoles(ctx, bare));
  const missing = coreRoles(ctx)
    .filter(r => !providers.get(r.id))
    .sort((a, b) => b.weight - a.weight);
  const archetypes = detectArchetypes(ctx, [...others, bare]);
  const meta = metaOf(ctx, member.species);
  const otherItems = new Map<string, Member>();
  for (const m of others) if (m.itemId && !otherItems.has(m.itemId)) otherItems.set(m.itemId, m);
  return {
    state,
    slot,
    member,
    bare,
    others,
    providers,
    missing,
    archetypes,
    field: fieldOf(archetypes),
    meta,
    hasMeta: !!meta,
    otherMegas: others.filter(m => isMegaStone(m.item)),
    otherItems,
  };
}

/** Arquétipos que definem o modo da equipe (com confiança mínima). */
export function modeArchetypes(archetypes: ArchetypeHit[], min = 0.35): ArchetypeHit[] {
  return archetypes.filter(a => a.confidence >= min && (!GENERIC_ARCHETYPES.has(a.def.id) || a.confidence >= 0.5));
}

export function archetypeById(archetypes: ArchetypeHit[], id: string): ArchetypeHit | undefined {
  return archetypes.find(a => a.def.id === id);
}

/* ------------------------- perfil do membro ------------------------- */

export interface MemberFeatures {
  physical: boolean;
  special: boolean;
  /** Atacante com pressão ofensiva relevante. */
  attacker: boolean;
  support: boolean;
  frail: boolean;
  bulky: boolean;
  baseSpe: number;
  damaging: MoveData[];
  status: MoveData[];
}

export function memberFeatures(member: Member): MemberFeatures {
  const form = member.form!;
  const damaging = member.moves.filter(isDamaging);
  const status = member.moves.filter(m => !isDamaging(m));
  const phys = attackStat(member, 'Physical');
  const spec = attackStat(member, 'Special');
  let physical: boolean;
  let special: boolean;
  if (damaging.length) {
    const p = damaging.filter(m => m.category === 'Physical' && m.id !== 'bodypress' && m.id !== 'foulplay').length;
    const s = damaging.filter(m => m.category === 'Special').length;
    physical = p >= s;
    special = s > p || (s > 0 && s === p);
  } else {
    physical = phys >= spec * 0.95;
    special = spec >= phys * 0.95;
  }
  const best = baseAttack(form, member.ability);
  const bulk = baseBulk(form);
  const support = status.length >= 2 || best < 90;
  return {
    physical,
    special,
    attacker: best >= 95 && (!member.moves.length || damaging.length >= 2),
    support,
    frail: bulk < 150,
    bulky: bulk >= 175,
    baseSpe: form.baseStats.spe,
    damaging,
    status,
  };
}

/* ------------------------------ textos ------------------------------ */

const ROLE_PHRASE: Record<string, string> = {
  speedcontrol: 'controle de velocidade',
  fakeout: 'Fake Out',
  intimidate: 'Intimidate ou redução de ataque',
  redirection: 'redirecionamento',
  spread: 'ataques em área',
  disruption: 'disrupção (Taunt, Encore, status...)',
  support: 'suporte (Helping Hand, Ally Switch...)',
  pivot: 'pivô (U-turn, Parting Shot...)',
  priority: 'golpes de prioridade',
  teamprotect: 'Wide Guard/Quick Guard',
  screens: 'telas',
  setup: 'setup',
  antiintimidate: 'resposta a Intimidate',
  weather: 'clima',
  terrain: 'terreno',
  trapping: 'quem prenda o oponente',
  trickroomattacker: 'atacante de Trick Room',
  protect: 'Protect',
};

/** Nome do papel para usar no meio de uma frase ("sua equipe não tem ..."). */
export function rolePhrase(role: RoleDef): string {
  return ROLE_PHRASE[role.id] ?? lowerFirst(role.namePt);
}

/** Ameaças do meta com perigo para a equipe (ou por uso, se a equipe está vazia). */
export function threatList(ctx: EngineContext, state: TeamState, limit = 10): { profile: ThreatProfile; danger: number; name: string }[] {
  const profiles = metaThreats(ctx, 30);
  const byName = new Map(profiles.map(p => [p.member.formName, p]));
  if (state.threats.length) {
    return state.threats
      .slice(0, limit)
      .map(t => ({ profile: byName.get(t.species)!, danger: t.danger, name: t.species }))
      .filter(t => !!t.profile);
  }
  const maxUsage = Math.max(1e-9, ...profiles.map(p => p.meta.usage));
  return profiles.slice(0, limit).map(p => ({ profile: p, danger: 0.3 + 0.5 * (p.meta.usage / maxUsage), name: p.member.formName }));
}

/** Converte uma soma livre (≥ 0) numa nota 0-1 com retorno decrescente. */
export function squash(raw: number, scale = 0.8): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return 1 - Math.exp(-raw / scale);
}
