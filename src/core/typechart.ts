/**
 * Tabela de tipos e efetividade, incluindo imunidades/resistências vindas de
 * habilidades (Levitate, Flash Fire, Storm Drain...).
 */
import { toId } from './id.ts';
import type { Dex, TypeName } from './types.ts';

export const TYPES: TypeName[] = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
];

/** Multiplicador de dano de `attack` contra um Pokémon com `defenderTypes`. */
export function typeEffectiveness(chart: Dex['typechart'], attack: TypeName, defenderTypes: readonly TypeName[]): number {
  let mult = 1;
  for (const t of defenderTypes) mult *= chart[t]?.[attack] ?? 1;
  return mult;
}

/**
 * Modificadores defensivos por habilidade. Valores multiplicam a efetividade
 * de tipo. "absorb" indica que o golpe ainda dá um bônus ao defensor.
 */
export const ABILITY_TYPE_MODIFIERS: Record<string, { type: TypeName; mult: number; absorb?: string }[]> = {
  levitate: [{ type: 'Ground', mult: 0 }],
  eartheater: [{ type: 'Ground', mult: 0, absorb: 'cura 25%' }],
  flashfire: [{ type: 'Fire', mult: 0, absorb: 'aumenta golpes de Fogo' }],
  wellbakedbody: [{ type: 'Fire', mult: 0, absorb: '+2 Defesa' }],
  waterabsorb: [{ type: 'Water', mult: 0, absorb: 'cura 25%' }],
  stormdrain: [{ type: 'Water', mult: 0, absorb: '+1 At. Esp. e redireciona' }],
  dryskin: [{ type: 'Water', mult: 0, absorb: 'cura 25%' }, { type: 'Fire', mult: 1.25 }],
  voltabsorb: [{ type: 'Electric', mult: 0, absorb: 'cura 25%' }],
  lightningrod: [{ type: 'Electric', mult: 0, absorb: '+1 At. Esp. e redireciona' }],
  motordrive: [{ type: 'Electric', mult: 0, absorb: '+1 Velocidade' }],
  sapsipper: [{ type: 'Grass', mult: 0, absorb: '+1 Ataque' }],
  thickfat: [{ type: 'Fire', mult: 0.5 }, { type: 'Ice', mult: 0.5 }],
  heatproof: [{ type: 'Fire', mult: 0.5 }],
  waterbubble: [{ type: 'Fire', mult: 0.5 }],
  purifyingsalt: [{ type: 'Ghost', mult: 0.5 }],
  fluffy: [{ type: 'Fire', mult: 2 }],
};

/** Habilidades que reduzem golpes super efetivos. */
export const SUPER_EFFECTIVE_REDUCERS = new Set(['filter', 'solidrock', 'prismarmor']);

export function effectivenessWithAbility(
  chart: Dex['typechart'],
  attack: TypeName,
  defenderTypes: readonly TypeName[],
  ability?: string,
): number {
  let mult = typeEffectiveness(chart, attack, defenderTypes);
  const abilityId = toId(ability);
  for (const mod of ABILITY_TYPE_MODIFIERS[abilityId] ?? []) if (mod.type === attack) mult *= mod.mult;
  if (mult > 1 && SUPER_EFFECTIVE_REDUCERS.has(abilityId)) mult *= 0.75;
  if (abilityId === 'wonderguard' && mult <= 1) mult = 0;
  return mult;
}

/** Perfil defensivo completo (multiplicador para cada tipo de ataque). */
export function defensiveProfile(chart: Dex['typechart'], types: readonly TypeName[], ability?: string): Record<TypeName, number> {
  const out = {} as Record<TypeName, number>;
  for (const atk of TYPES) out[atk] = effectivenessWithAbility(chart, atk, types, ability);
  return out;
}

/** Melhor multiplicador que um conjunto de tipos de ataque obtém contra o defensor. */
export function bestOffensiveMultiplier(chart: Dex['typechart'], attackTypes: Iterable<TypeName>, defenderTypes: readonly TypeName[]): number {
  let best = 0;
  for (const t of attackTypes) best = Math.max(best, typeEffectiveness(chart, t, defenderTypes));
  return best;
}
