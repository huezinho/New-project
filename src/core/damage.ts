/**
 * Cálculo de dano com @smogon/calc (geração 0 = Pokémon Champions; os Stat
 * Points vão no campo "evs"). Erros do calc (espécie, item ou golpe que ele
 * não conhece) viram null.
 */
import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import type { DamageFieldOptions, DamageResult, EngineContext, MatchupEntry } from './api.ts';
import { emptySP } from './stats.ts';
import { defaultAbility, isDamaging, likelySet, metaThreats, NON_COVERAGE, resolveMember, type Member } from './team.ts';
import { num } from './util.ts';
import type { PokemonSet, StatsTable, Team } from './types.ts';

const GEN = Generations.get(0 as never);

type Boosts = Partial<StatsTable>;

/** Nomes que o @smogon/calc grafa diferente (Stance Change: lâmina ao atacar, escudo ao defender). */
const CALC_NAME: Record<string, { attacker: string; defender: string }> = {
  Aegislash: { attacker: 'Aegislash-Blade', defender: 'Aegislash-Shield' },
};

function toCalcPokemon(ctx: EngineContext, set: PokemonSet, role: 'attacker' | 'defender', boosts?: Boosts): Pokemon | null {
  if (!set || typeof set !== 'object') return null;
  const species = ctx.dex.species(set.species);
  if (!species) return null;
  const form = ctx.dex.battleForm(set) ?? species;
  // Sem habilidade no set: a mesma da análise (mais usada no meta ou a melhor), não a 1ª da lista do calc.
  const ability = ctx.dex.ability(ctx.dex.battleAbility(set) || defaultAbility(ctx, species))?.name;
  const item = ctx.dex.item(set.item)?.name;
  const sp = { ...emptySP(), ...(set.sp ?? {}) };
  try {
    return new Pokemon(GEN, CALC_NAME[form.name]?.[role] ?? form.name, {
      level: 50,
      ability,
      item,
      nature: set.nature || undefined,
      evs: sp,
      boosts: boosts as never,
    });
  } catch {
    return null;
  }
}

function koTextPt(chance: number, hits: number, maxPct: number): string {
  if (maxPct <= 0) return 'não causa dano';
  if (!hits) return `sem KO em até 4 golpes (${num(maxPct, 1)}% no máximo)`;
  const label = hits === 1 ? 'OHKO' : `${hits}HKO`;
  if (chance >= 0.999) return `${label} garantido`;
  return `${num(chance * 100, 1)}% de chance de ${label}`;
}

/** Dano de `move` do atacante contra o defensor (null se o calc não suportar). */
export function calcDamage(
  ctx: EngineContext,
  attackerSet: PokemonSet,
  defenderSet: PokemonSet,
  move: string,
  field: DamageFieldOptions = {},
): DamageResult | null {
  const mv = ctx.dex.move(move);
  if (!mv) return null;
  const attacker = toCalcPokemon(ctx, attackerSet, 'attacker', field.attackerBoosts);
  const defender = toCalcPokemon(ctx, defenderSet, 'defender', field.defenderBoosts);
  if (!attacker || !defender) return null;
  try {
    const calcField = new Field({
      gameType: 'Doubles',
      weather: field.weather,
      terrain: field.terrain,
      attackerSide: { isHelpingHand: !!field.helpingHand },
      defenderSide: {
        isReflect: !!field.reflect,
        isLightScreen: !!field.lightScreen,
        isAuroraVeil: !!field.auroraVeil,
        isFriendGuard: !!field.friendGuard,
      },
    });
    const result = calculate(GEN, attacker, defender, new Move(GEN, mv.name), calcField);
    const range = result.range();
    const min = Array.isArray(range) ? range[0] : Number(range) || 0;
    const max = Array.isArray(range) ? range[1] : Number(range) || 0;
    const hp = defender.maxHP();
    const minPct = hp ? (min / hp) * 100 : 0;
    const maxPct = hp ? (max / hp) * 100 : 0;
    let koChance = 0;
    let koHits = 0;
    let desc = '';
    if (max > 0) {
      try {
        const ko = result.kochance();
        koChance = ko.chance ?? 0;
        koHits = ko.n && ko.n <= 4 ? ko.n : 0;
        if (!koHits) koChance = 0;
      } catch {
        // kochance falha em alguns golpes de dano fixo; mantém sem KO.
      }
      try {
        desc = result.desc();
      } catch {
        desc = '';
      }
    }
    return {
      attacker: attacker.name,
      defender: defender.name,
      move: mv.name,
      min,
      max,
      minPct,
      maxPct,
      koChance,
      koHits,
      koTextPt: koTextPt(koChance, koHits, maxPct),
      desc,
    };
  } catch {
    return null;
  }
}

/** Golpes de dano do membro (do set ou, sem golpes, os prováveis do meta). */
function damagingMoves(member: Member): string[] {
  return member.moves.filter(m => isDamaging(m) && !NON_COVERAGE.has(m.id)).map(m => m.name);
}

function bestDamage(ctx: EngineContext, attacker: PokemonSet, moves: string[], defender: PokemonSet): DamageResult | null {
  let best: DamageResult | null = null;
  for (const move of moves) {
    const r = calcDamage(ctx, attacker, defender, move);
    if (r && (!best || r.maxPct > best.maxPct)) best = r;
  }
  return best;
}

/**
 * Confrontos rápidos de cada membro contra as ameaças mais usadas do meta:
 * melhor golpe do membro e melhor golpe do set comum da ameaça.
 */
export function quickMatchups(ctx: EngineContext, team: Team, limit = 6): MatchupEntry[] {
  if (!Array.isArray(team)) return [];
  const threats = metaThreats(ctx, Math.max(1, Math.floor(limit) || 6));
  const out: MatchupEntry[] = [];
  team.forEach((set, slot) => {
    if (!set || typeof set.species !== 'string') return;
    const member = resolveMember(ctx, set, slot);
    if (!member.form) return;
    const fullSet: PokemonSet = { ...set, ability: set.ability || member.abilityName, moves: member.moves.map(m => m.name) };
    const myMoves = damagingMoves(member);
    const mySpeed = member.itemId === 'choicescarf' ? Math.floor(member.stats.spe * 1.5) : member.stats.spe;
    for (const t of threats) {
      if (!t.member.form) continue;
      const threatSet = likelySet(ctx, t.meta);
      out.push({
        slot,
        species: member.formName,
        threat: t.member.formName,
        threatUsage: t.meta.usage,
        offense: myMoves.length ? bestDamage(ctx, fullSet, myMoves, threatSet) : null,
        defense: bestDamage(ctx, threatSet, damagingMoves(t.member), fullSet),
        outspeeds: mySpeed === t.speed ? null : mySpeed > t.speed,
      });
    }
  });
  return out;
}
