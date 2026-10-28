import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregate } from '../scripts/lib/aggregate.ts';
import type { TeamRecord } from '../scripts/lib/records.ts';
import { createEngineContext, rankPokemon, suggestMegaAlternatives, suggestPokemon } from '../src/core/engine.ts';
import type { Heuristics } from '../src/core/api.ts';
import type { Dex, PokemonSet } from '../src/core/types.ts';

const dex = JSON.parse(readFileSync('public/data/dex.json', 'utf8')) as Dex;
const heuristics = JSON.parse(readFileSync('public/data/heuristics.json', 'utf8')) as Heuristics;

const member = (species: string, item: string, moves: string[]) => ({ species, item, ability: null, moves });
const rec = (pokemon: ReturnType<typeof member>[], wins: number, losses: number, i: number): TeamRecord => ({
  source: 'teste', sourceKind: 'online', eventId: `ev${i % 7}`, eventName: 'Teste', date: '2026-10-20', regulation: 'M-C',
  wins, losses, pokemon,
});

// Salamence quase sempre como Mega (e vencendo); a forma comum aparece pouco e perde.
const records: TeamRecord[] = [];
for (let i = 0; i < 60; i++) {
  records.push(rec([
    member('Salamence', 'Salamencite', ['Hyper Voice', 'Draco Meteor', 'Tailwind', 'Protect']),
    member('Incineroar', 'Sitrus Berry', ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Throat Chop']),
    member('Garchomp', 'Choice Scarf', ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Stomping Tantrum']),
    member('Kingambit', 'Black Glasses', ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Protect']),
  ], 6, 2, i));
}
for (let i = 0; i < 4; i++) {
  records.push(rec([
    member('Salamence', 'Life Orb', ['Draco Meteor', 'Flamethrower', 'Hurricane', 'Protect']),
    member('Sneasler', 'White Herb', ['Close Combat', 'Dire Claw', 'Fake Out', 'Protect']),
    member('Rillaboom', 'Miracle Seed', ['Fake Out', 'Grassy Glide', 'Wood Hammer', 'U-turn']),
    member('Gholdengo', 'Life Orb', ['Make It Rain', 'Shadow Ball', 'Nasty Plot', 'Protect']),
  ], 1, 6, 100 + i));
}
const meta = aggregate({ dex, regulation: 'M-C', regulationOrder: ['M-C', 'M-B'], snapshots: [], records, patches: [], now: '2026-10-27' });

describe('meta por forma', () => {
  it('separa Mega e forma comum com uso e vitória próprios', () => {
    const forms = meta.pokemon.salamence.forms!;
    const mega = forms.find(f => f.mega)!;
    const plain = forms.find(f => !f.mega)!;
    expect(mega.name).toBe('Salamence-Mega');
    expect(mega.share).toBeGreaterThan(0.9);
    expect(plain.usage).toBeLessThan(mega.usage / 10);
    expect(plain.winRate!).toBeLessThan(mega.winRate!);
    expect(plain.items[0].name).toBe('Life Orb');
    expect(meta.pokemon.incineroar.forms).toBeUndefined();
  });
});

describe('sugestões com as vagas de Mega ocupadas', () => {
  const ctx = createEngineContext(dex, meta, heuristics);
  const set = (species: string, item: string): PokemonSet => ({ species, item, sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }, nature: 'Timid', moves: [] });
  const twoMegas = [set('Charizard', 'Charizardite Y'), set('Floette-Eternal', 'Floettite')];
  const oneMega = [set('Charizard', 'Charizardite Y'), set('Pelipper', 'Damp Rock')];

  it('avalia Salamence pela forma comum quando a equipe já tem 2 Megas', () => {
    const rankFull = rankPokemon(ctx, twoMegas);
    const rankOpen = rankPokemon(ctx, oneMega);
    const full = rankFull.find(s => s.species === 'Salamence')!;
    const open = rankOpen.find(s => s.species === 'Salamence')!;
    expect(full.form?.mega).toBe(false);
    expect(open.form?.mega).toBe(true);
    expect(full.meta!.usage).toBeLessThan(meta.pokemon.salamence.usage / 5);
    expect(full.reasonsPt.some(r => r.startsWith('Avaliado sem Mega'))).toBe(true);
    expect(full.score).toBeLessThan(open.score);
  });

  it('não monta Mega Stone no set sugerido sem vaga', () => {
    for (const s of suggestPokemon(ctx, twoMegas, 15)) {
      expect(dex.items[s.set.item?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '']?.megaStone).toBeUndefined();
    }
  });

  it('lista quem seria sugerido se houvesse vaga de Mega', () => {
    const alts = suggestMegaAlternatives(ctx, twoMegas, 5);
    expect(alts.every(a => a.replaces.length === 2)).toBe(true);
    expect(alts.every(a => a.scoreWithoutMega === null || a.score > a.scoreWithoutMega)).toBe(true);
    expect(suggestMegaAlternatives(ctx, oneMega)).toEqual([]);
  });
});
