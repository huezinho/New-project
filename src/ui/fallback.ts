/**
 * Análise simplificada calculada na própria interface, usada apenas quando o
 * motor não responde (matriz defensiva, cobertura ofensiva e velocidades).
 */
import type { CoverageRow, SpeedEntry, TypeMatchupRow } from '../core/api.ts';
import type { DexAccess } from '../core/dex.ts';
import { calcStats, emptySP } from '../core/stats.ts';
import { toId } from '../core/id.ts';
import { ABILITY_TYPE_MODIFIERS, effectivenessWithAbility, typeEffectiveness, TYPES } from '../core/typechart.ts';
import type { Meta, Team, TypeName } from '../core/types.ts';

export function simpleDefensive(dex: DexAccess, team: Team): TypeMatchupRow[] {
  const forms = team.map(set => ({ form: dex.battleForm(set), ability: dex.battleAbility(set), name: set.species }));
  return TYPES.map(type => {
    const multipliers = forms.map(f => (f.form ? effectivenessWithAbility(dex.data.typechart, type, f.form.types, f.ability) : 1));
    const weak = multipliers.filter(m => m > 1).length;
    const resist = multipliers.filter(m => m > 0 && m < 1).length;
    const immune = multipliers.filter(m => m === 0).length;
    const abilityNotes = forms
      .filter(f => (ABILITY_TYPE_MODIFIERS[toId(f.ability)] ?? []).some(mod => mod.type === type))
      .map(f => `${f.name} (${f.ability})`);
    const status: TypeMatchupRow['status'] = weak >= 3 && resist + immune < 2 ? 'bad' : weak > resist + immune ? 'warn' : 'ok';
    return { type, multipliers, weak, resist, immune, abilityNotes, status };
  });
}

export function simpleOffensive(dex: DexAccess, team: Team): CoverageRow[] {
  const attackers = team.map(set => ({
    name: set.species,
    types: set.moves
      .map(m => dex.move(m))
      .filter(m => m && m.category !== 'Status' && m.basePower > 0)
      .map(m => m!.type as TypeName),
  }));
  return TYPES.map(type => {
    let best = 0;
    const hitters: string[] = [];
    for (const a of attackers) {
      let mine = 0;
      for (const t of a.types) mine = Math.max(mine, typeEffectiveness(dex.data.typechart, t, [type]));
      best = Math.max(best, mine);
      if (mine > 1) hitters.push(a.name);
    }
    return { type, best, hitters };
  });
}

export function simpleSpeed(dex: DexAccess, team: Team, meta?: Meta, metaLimit = 24): SpeedEntry[] {
  const out: SpeedEntry[] = [];
  const nums = new Set<number>();
  team.forEach((set, slot) => {
    const form = dex.battleForm(set);
    if (!form) return;
    nums.add(form.num);
    const nature = set.nature ? dex.data.natures[toId(set.nature)] : undefined;
    const speed = calcStats(form, set.sp, nature).spe;
    out.push({ slot, species: form.name, speed, label: `${set.sp.spe} SP${nature ? ` · ${nature.name}` : ''}`, isMeta: false });
  });
  // Pokémon do meta com o spread mais comum (forma Mega se o item mais usado for a Mega Stone)
  const metaMons = Object.values(meta?.pokemon ?? {})
    .filter(p => p.spreads?.length)
    .sort((a, b) => b.usage - a.usage)
    .slice(0, metaLimit);
  for (const p of metaMons) {
    const base = dex.species(p.id);
    if (!base || nums.has(base.num)) continue;
    const topItem = p.items?.[0];
    const form = dex.battleForm({ species: base.name, item: topItem ? dex.item(topItem.id)?.name : undefined }) ?? base;
    const spread = p.spreads[0];
    const nature = dex.data.natures[toId(spread.nature)];
    const speed = calcStats(form, { ...emptySP(), ...spread.sp }, nature).spe;
    out.push({ species: form.name, speed, label: `${spread.sp.spe ?? 0} SP${nature ? ` · ${nature.name}` : ''}`, isMeta: true, usage: p.usage });
  }
  return out.sort((a, b) => b.speed - a.speed);
}
