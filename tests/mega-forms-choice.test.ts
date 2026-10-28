import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregate } from '../scripts/lib/aggregate.ts';
import type { TeamRecord } from '../scripts/lib/records.ts';
import { createEngineContext, rankPokemon, suggestPokemon } from '../src/core/engine.ts';
import type { Heuristics } from '../src/core/api.ts';
import { toId } from '../src/core/id.ts';
import { speciesPotential } from '../src/core/roles.ts';
import type { Dex, PokemonSet } from '../src/core/types.ts';

const dex = JSON.parse(readFileSync('public/data/dex.json', 'utf8')) as Dex;
const heuristics = JSON.parse(readFileSync('public/data/heuristics.json', 'utf8')) as Heuristics;
const isStone = (item: string | undefined) => !!dex.items[toId(item)]?.megaStone;

const member = (species: string, item: string, moves: string[]) => ({ species, item, ability: null, moves });
const rec = (pokemon: ReturnType<typeof member>[], wins: number, losses: number, i: number): TeamRecord => ({
  source: 'teste', sourceKind: 'online', eventId: `ev${i % 7}`, eventName: 'Teste', date: '2026-10-20', regulation: 'M-C',
  wins, losses, pokemon,
});

// Como no meta real: o Garchomp comum anda com Charizard-Y e vence; o Mega-Z anda com outros e perde.
// Garchompite Z é o item mais usado (os itens do comum se dividem), então o set provável é o Mega-Z.
const records: TeamRecord[] = [];
for (let i = 0; i < 40; i++) {
  records.push(rec([
    member('Garchomp', ['Choice Scarf', 'Life Orb', 'Sitrus Berry', 'Focus Sash'][i % 4], ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Stomping Tantrum']),
    member('Charizard', 'Charizardite Y', ['Heat Wave', 'Weather Ball', 'Solar Beam', 'Protect']),
    member('Venusaur', 'Focus Sash', ['Sludge Bomb', 'Leaf Storm', 'Sleep Powder', 'Protect']),
    member('Incineroar', 'Sitrus Berry', ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Throat Chop']),
  ], 6, 2, i));
}
for (let i = 0; i < 30; i++) {
  records.push(rec([
    member('Garchomp', 'Garchompite Z', ['Power Gem', 'Earth Power', 'Dragon Pulse', 'Protect']),
    member('Rillaboom', 'Miracle Seed', ['Fake Out', 'Grassy Glide', 'Wood Hammer', 'U-turn']),
    member('Sneasler', 'White Herb', ['Close Combat', 'Dire Claw', 'Fake Out', 'Protect']),
    member('Kingambit', 'Black Glasses', ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Protect']),
  ], 2, 6, 100 + i));
}
// Mawile só aparece como Mega, sempre com Farigiraf (Trick Room).
for (let i = 0; i < 20; i++) {
  records.push(rec([
    member('Mawile', 'Mawilite', ['Play Rough', 'Iron Head', 'Sucker Punch', 'Protect']),
    member('Farigiraf', 'Sitrus Berry', ['Trick Room', 'Psychic', 'Helping Hand', 'Protect']),
    member('Kingambit', 'Chople Berry', ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Protect']),
    member('Incineroar', 'Safety Goggles', ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Throat Chop']),
  ], 6, 2, 200 + i));
}
const meta = aggregate({ dex, regulation: 'M-C', regulationOrder: ['M-C', 'M-B'], snapshots: [], records, patches: [], now: '2026-10-27' });
const ctx = createEngineContext(dex, meta, heuristics);
const set = (species: string, item: string): PokemonSet => ({ species, item, sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }, nature: 'Timid', moves: [] });

describe('meta por forma: parceiros', () => {
  it('parceiros de cada forma trazem jogos e vitória da dupla', () => {
    const plain = meta.pokemon.garchomp.forms!.find(f => !f.mega)!;
    const zard = plain.teammates!.find(t => t.id === 'charizard')!;
    expect(zard.games).toBeGreaterThan(0);
    expect(zard.winRate!).toBeGreaterThan(0.5);
  });
});

describe('escolha da forma com vaga de Mega', () => {
  const oneMega = [set('Charizard', 'Charizardite Y'), set('Venusaur', 'Focus Sash')];

  it('com 1 Mega, Garchomp entra sem Mega (o Mega-Z não herda a parceria do comum com Charizard-Y)', () => {
    const g = rankPokemon(ctx, oneMega).find(s => s.species === 'Garchomp')!;
    expect(g.form?.mega).toBe(false);
    expect(g.reasonsPt.some(r => r.startsWith('Sugerido sem Mega'))).toBe(true);
    const built = suggestPokemon(ctx, oneMega, 15).find(s => s.species === 'Garchomp')!;
    expect(isStone(built.set.item)).toBe(false);
  });

  it('avaliado como Mega, uso e vitória são os da forma Mega', () => {
    const g = rankPokemon(ctx, [set('Rillaboom', 'Miracle Seed'), set('Sneasler', 'White Herb')]).find(s => s.species === 'Garchomp')!;
    const form = meta.pokemon.garchomp.forms!.find(f => f.name === g.form?.name)!;
    expect(g.meta!.usage).toBeCloseTo(form.usage, 6);
    expect(g.meta!.winRate).toBeCloseTo(form.winRate!, 6);
  });

  it('o uso citado de uma forma não traz a posição da espécie no ranking', () => {
    const twoMegas = [set('Salamence', 'Salamencite'), set('Floette-Eternal', 'Floettite')];
    for (const team of [oneMega, twoMegas]) {
      const g = rankPokemon(ctx, team).find(s => s.species === 'Garchomp')!;
      const used = g.reasonsPt.filter(r => r.startsWith('Muito usado'));
      expect(used.length).toBeGreaterThan(0);
      for (const r of used) expect(r).not.toMatch(/º mais usado/);
    }
  });

  it('o set montado segue a forma avaliada (com ou sem Mega Stone)', () => {
    const ranked = new Map(rankPokemon(ctx, oneMega).map(s => [s.species, !!s.form?.mega]));
    for (const s of suggestPokemon(ctx, oneMega, 15)) {
      expect(isStone(s.set.item), `${s.species} @ ${s.set.item}`).toBe(ranked.get(s.species));
    }
  });
});

describe('sem vaga de Mega: nada da forma Mega na nota da forma comum', () => {
  const twoMegas = [set('Charizard', 'Charizardite Y'), set('Floette-Eternal', 'Floettite'), set('Farigiraf', 'Sitrus Berry')];

  it('Mawile sem Mega não herda a parceria da Mega com Farigiraf', () => {
    const m = rankPokemon(ctx, twoMegas).find(s => s.species === 'Mawile')!;
    expect(m.form?.mega).toBe(false);
    expect(m.reasonsPt.some(r => r.startsWith('Parceiro frequente'))).toBe(false);
    // Uso da forma comum é conhecido (zero), não "desconhecido" como o de uma espécie fora do meta.
    expect(m.components.find(c => c.key === 'meta')!.value).toBe(0);
  });

  it('habilidade da Mega não conta como papel da forma comum (Manectric sem Mega não tem Intimidate)', () => {
    const manectric = ctx.dex.species('Manectric')!;
    expect(speciesPotential(ctx, manectric).get('intimidate')?.via.join()).toContain('Manectric-Mega');
    expect(speciesPotential(ctx, manectric, false).get('intimidate')?.via.join() ?? '').not.toContain('Manectric-Mega');
    const s = rankPokemon(ctx, twoMegas).find(x => x.species === 'Manectric')!;
    expect(s.reasonsPt.some(r => r.includes('(Manectric-Mega)'))).toBe(false);
  });
});
