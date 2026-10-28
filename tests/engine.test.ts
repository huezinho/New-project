import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineContext, Heuristics } from '../src/core/api.ts';
import {
  analyzeTeam, autoComplete, buildSet, calcDamage, createEngineContext, DEFAULT_WEIGHTS, quickMatchups, rankPokemon,
  suggestAbilities, suggestItems, suggestMoves, suggestPokemon, suggestSpreads,
} from '../src/core/engine.ts';
import { toId } from '../src/core/id.ts';
import { parseTeam } from '../src/core/paste.ts';
import { calcStats, SP_MAX, SP_TOTAL, totalSP, validateSP } from '../src/core/stats.ts';
import { powerValue } from '../src/core/suggest/moves.ts';
import { metaThreats } from '../src/core/team.ts';
import { attackEffectiveness } from '../src/core/typechart.ts';
import type { Dex, PokemonSet, Team } from '../src/core/types.ts';
import { emptyMeta, sampleMeta } from './fixtures/meta.ts';

const dex = JSON.parse(readFileSync('public/data/dex.json', 'utf8')) as Dex;
const heuristics = JSON.parse(readFileSync('public/data/heuristics.json', 'utf8')) as Heuristics;
const reg = dex.currentRegulation;

const withMeta = createEngineContext(dex, sampleMeta(dex), heuristics);
const noMeta = createEngineContext(dex, emptyMeta(reg), heuristics);
const contexts: [string, EngineContext][] = [['meta sintético', withMeta], ['meta vazio', noMeta]];

const team = (text: string): Team => parseTeam(text);

/** Checa legalidade completa de um set (espécie, item, habilidade, golpes e SP). */
function expectLegalSet(set: PokemonSet) {
  const species = dex.species[toId(set.species)];
  expect(species, set.species).toBeDefined();
  expect(species.legal[reg]).toBe(true);
  expect(species.isMega).toBeFalsy();
  if (set.item) expect(dex.items[toId(set.item)]?.legal[reg], `${set.species} @ ${set.item}`).toBe(true);
  if (set.ability) expect(Object.values(species.abilities).map(toId)).toContain(toId(set.ability));
  expect(set.moves.length).toBeGreaterThan(0);
  expect(set.moves.length).toBeLessThanOrEqual(4);
  expect(new Set(set.moves.map(toId)).size).toBe(set.moves.length);
  for (const m of set.moves) expect(species.learnset, `${set.species} - ${m}`).toContain(toId(m));
  expect(validateSP(set.sp)).toEqual([]);
  expect(dex.natures[toId(set.nature)]).toBeDefined();
}

const NO_SPEED_CONTROL = team(`Incineroar @ Sitrus Berry
Ability: Intimidate
- Fake Out
- Flare Blitz
- Parting Shot
- Protect

Kingambit @ Black Glasses
Ability: Defiant
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Protect

Gholdengo @ Life Orb
Ability: Good as Gold
- Make It Rain
- Shadow Ball
- Nasty Plot
- Protect

Sneasler @ White Herb
Ability: Unburden
- Close Combat
- Dire Claw
- Fake Out
- Protect

Pelipper @ Damp Rock
Ability: Drizzle`);

const TRICK_ROOM = team(`Farigiraf @ Mental Herb
Ability: Armor Tail
- Trick Room
- Helping Hand
- Psychic
- Protect

Hatterene @ Focus Sash
Ability: Magic Bounce
- Trick Room
- Expanding Force
- Dazzling Gleam
- Protect

Torkoal @ Charcoal
Ability: Drought
- Eruption
- Heat Wave
- Solar Beam
- Protect

Kingambit @ Black Glasses
Ability: Defiant
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Protect

Whimsicott
Ability: Prankster`);

describe('heuristics.json', () => {
  const learnable = new Set<string>();
  const abilities = new Set<string>();
  for (const s of Object.values(dex.species)) {
    if (!s.legal[reg]) continue;
    s.learnset.forEach(m => learnable.add(m));
    Object.values(s.abilities).forEach(a => abilities.add(toId(a)));
  }
  const checkMove = (id: string) => {
    expect(dex.moves[id], `golpe ${id}`).toBeDefined();
    expect(learnable.has(id), `golpe aprendível ${id}`).toBe(true);
  };
  const checkAbility = (id: string) => {
    expect(dex.abilities[id], `habilidade ${id}`).toBeDefined();
    expect(abilities.has(id), `habilidade disponível ${id}`).toBe(true);
  };

  it('só usa golpes, habilidades e itens que existem no Champions', () => {
    for (const r of heuristics.roles) {
      r.moves.forEach(checkMove);
      r.abilities.forEach(checkAbility);
      for (const i of r.items) expect(dex.items[i]?.legal[reg], `item ${i}`).toBe(true);
      for (const k of Object.keys(r.quality ?? {})) expect([...r.moves, ...r.abilities, ...r.items]).toContain(k);
    }
    for (const a of heuristics.archetypes) {
      [...a.setters.moves, ...a.antiSynergyMoves, ...(a.requires?.moves ?? [])].forEach(checkMove);
      [...a.setters.abilities, ...a.abusers.abilities, ...(a.requires?.abilities ?? [])].forEach(checkAbility);
      for (const t of a.abusers.traits) {
        const m = /move:([a-z0-9]+)/.exec(t);
        if (m) checkMove(m[1]);
      }
    }
    for (const x of heuristics.abilityImmunities) checkAbility(x.ability);
    for (const x of heuristics.itemHeuristics) expect(dex.items[x.item]?.legal[reg], `item ${x.item}`).toBe(true);
  });

  it('cobre os papéis e arquétipos essenciais de VGC', () => {
    const roles = heuristics.roles.map(r => r.id);
    for (const id of ['speedcontrol', 'fakeout', 'intimidate', 'redirection', 'protect', 'teamprotect', 'support', 'disruption', 'pivot', 'setup', 'weather', 'terrain', 'priority', 'spread']) {
      expect(roles).toContain(id);
    }
    const archetypes = heuristics.archetypes.map(a => a.id);
    for (const id of ['tailwind', 'trickroom', 'sun', 'rain', 'sand', 'snow', 'psychicterrain', 'grassyterrain', 'electricterrain', 'hyperoffense', 'balance', 'perishtrap']) {
      expect(archetypes).toContain(id);
    }
  });
});

describe('analyzeTeam', () => {
  it('detecta fraqueza compartilhada a Terrestre e a Fada', () => {
    const a = analyzeTeam(withMeta, team(`Incineroar
- Flare Blitz

Kingambit
- Kowtow Cleave

Torkoal
- Eruption`));
    const ground = a.defensive.find(r => r.type === 'Ground')!;
    expect(ground.weak).toBe(3);
    expect(ground.status).toBe('bad');
    expect(a.summaryPt.join(' ')).toContain('Terrestre');

    const b = analyzeTeam(withMeta, team(`Garchomp
- Earthquake

Dragonite
- Extreme Speed

Salamence
- Hyper Voice`));
    const fairy = b.defensive.find(r => r.type === 'Fairy')!;
    expect(fairy.weak).toBe(3);
    expect(fairy.status).toBe('bad');
    expect(b.defensive.find(r => r.type === 'Ground')!.immune).toBe(2);
  });

  it('considera imunidade por habilidade (Levitate) e Mold Breaker', () => {
    const a = analyzeTeam(noMeta, team(`Incineroar
- Flare Blitz

Kingambit
- Kowtow Cleave

Rotom-Wash
Ability: Levitate
- Hydro Pump`));
    const ground = a.defensive.find(r => r.type === 'Ground')!;
    expect(ground.multipliers[2]).toBe(0);
    expect(ground.immune).toBe(1);
    expect(ground.status).toBe('warn');
    expect(ground.abilityNotes.join(' ')).toContain('Levitate');
    // Mold Breaker ignora o Levitate
    expect(attackEffectiveness(dex.typechart, 'Ground', ['Electric', 'Water'], 'levitate')).toBe(0);
    expect(attackEffectiveness(dex.typechart, 'Ground', ['Electric', 'Water'], 'levitate', 'moldbreaker')).toBe(2);
  });

  it('usa o tipo e a habilidade da Mega (Charizard + Charizardite Y = Fogo/Voador com Drought)', () => {
    const y = team(`Charizard @ Charizardite Y
Ability: Blaze
- Heat Wave
- Solar Beam
- Weather Ball
- Protect`);
    expect(withMeta.dex.battleForm(y[0])?.types).toEqual(['Fire', 'Flying']);
    expect(toId(withMeta.dex.battleAbility(y[0]))).toBe('drought');
    const a = analyzeTeam(withMeta, y);
    expect(a.defensive.find(r => r.type === 'Rock')!.multipliers[0]).toBe(4);
    expect(a.defensive.find(r => r.type === 'Ground')!.multipliers[0]).toBe(0);
    expect(a.archetypes.some(x => x.def.id === 'sun')).toBe(true);
    expect(a.roles.find(r => r.role.id === 'weather')!.providers[0].via).toContain('Drought');

    const x = analyzeTeam(withMeta, team(`Charizard @ Charizardite X
- Flare Blitz
- Dragon Claw`));
    // Mega X é Fogo/Dragão: Terrestre volta a acertar e Pedra só 2×
    expect(x.defensive.find(r => r.type === 'Ground')!.multipliers[0]).toBe(2);
    expect(x.defensive.find(r => r.type === 'Rock')!.multipliers[0]).toBe(2);
  });

  it('aponta Item Clause, Species Clause, item/golpe ilegal, SP inválido e excesso de Megas', () => {
    const t = team(`Incineroar @ Sitrus Berry
Ability: Intimidate
- Fake Out
- Knock Off

Kingambit @ Sitrus Berry
- Kowtow Cleave

Rotom-Wash @ Choice Band
- Hydro Pump

Rotom-Heat
- Overheat

Charizard @ Charizardite Y
- Heat Wave

Garchomp @ Garchompite Z
- Earthquake`);
    t[0].sp.hp = 33;
    const a = analyzeTeam(withMeta, t);
    const text = a.issues.map(i => i.messagePt);
    const errors = a.issues.filter(i => i.severity === 'error').map(i => i.messagePt).join('\n');
    expect(errors).toContain('Item Clause');
    expect(errors).toContain('Species Clause');
    expect(errors).toContain('Choice Band');
    expect(errors).toContain('não aprende Knock Off');
    expect(errors).toMatch(/HP tem mais de 32 SP/);
    expect(text.some(t => /Mega Stone/.test(t))).toBe(true);
    expect(a.score).toBeLessThan(80);
  });

  it('sinaliza falta de controle de velocidade e monta tiers de velocidade com o meta', () => {
    const a = analyzeTeam(withMeta, NO_SPEED_CONTROL);
    expect(a.missingRoles.map(r => r.id)).toContain('speedcontrol');
    expect(a.issues.some(i => i.messagePt.includes('controle de velocidade'))).toBe(true);
    expect(a.speedTiers.some(s => s.isMeta)).toBe(true);
    expect(a.speedTiers.some(s => !s.isMeta && s.species === 'Sneasler')).toBe(true);
    for (let i = 1; i < a.speedTiers.length; i++) expect(a.speedTiers[i - 1].speed).toBeGreaterThanOrEqual(a.speedTiers[i].speed);
    expect(a.threats.length).toBeGreaterThan(0);
    expect(a.score).toBeGreaterThan(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });

  it('detecta Trick Room e classifica a confiança', () => {
    const a = analyzeTeam(withMeta, TRICK_ROOM);
    expect(a.archetypes[0].def.id).toBe('trickroom');
    expect(a.archetypes[0].confidence).toBeGreaterThan(0.6);
  });
});

describe('suggestMoves', () => {
  it('troca um golpe mais usado por controle de velocidade quando a equipe não tem e explica a diferença', () => {
    const r = suggestMoves(withMeta, NO_SPEED_CONTROL, 4);
    expect(r.mostUsed).toEqual(['Hurricane', 'Weather Ball', 'Protect', 'U-turn']);
    expect(r.mostUsed).not.toContain('Tailwind');
    expect(r.recommended).toContain('Tailwind');
    expect(r.recommended).toHaveLength(4);
    const line = r.diffPt.find(d => d.includes('Tailwind'));
    expect(line).toBeDefined();
    expect(line).toContain('controle de velocidade');
    const tw = r.ranked.find(m => m.move === 'Tailwind')!;
    expect(tw.tags).toContain('speedcontrol');
    expect(tw.usage).toBeCloseTo(0.3);
  });

  it('não recomenda Tailwind em equipe de Trick Room', () => {
    for (const [, ctx] of contexts) {
      const r = suggestMoves(ctx, TRICK_ROOM, 4);
      expect(r.recommended.length).toBe(4);
      expect(r.recommended).not.toContain('Tailwind');
      expect(r.ranked.find(m => m.move === 'Tailwind')!.tags).toContain('conflito');
    }
    const r = suggestMoves(withMeta, TRICK_ROOM, 4);
    expect(r.mostUsed).toContain('Tailwind');
    expect(r.diffPt.some(d => d.includes('Tailwind') && d.includes('Trick Room'))).toBe(true);
  });

  it('mantém Protect e evita Earthquake sem parceiro imune quando há opção', () => {
    const t = team(`Garchomp
Ability: Rough Skin

Incineroar
- Fake Out
- Flare Blitz

Kingambit
- Kowtow Cleave`);
    for (const [, ctx] of contexts) {
      const r = suggestMoves(ctx, t, 0);
      expect(r.recommended).toContain('Protect');
      const eq = r.ranked.find(m => m.move === 'Earthquake')!;
      expect(eq.tags).toContain('acerta-aliado');
      expect(eq.reasonsPt.join(' ')).toContain('parceiro');
    }
  });

  it('só recomenda golpes que a espécie aprende, sem repetir', () => {
    for (const [, ctx] of contexts) {
      NO_SPEED_CONTROL.forEach((set, slot) => {
        const r = suggestMoves(ctx, NO_SPEED_CONTROL, slot);
        const species = dex.species[toId(set.species)];
        expect(new Set(r.recommended).size).toBe(r.recommended.length);
        for (const m of r.recommended) expect(species.learnset).toContain(toId(m));
        for (const m of r.ranked) {
          expect(m.score).toBeGreaterThanOrEqual(0);
          expect(m.score).toBeLessThanOrEqual(1);
          expect(m.reasonsPt.length).toBeGreaterThan(0);
        }
      });
    }
  });
});

describe('suggestItems / suggestAbilities / suggestSpreads', () => {
  it('bloqueia itens de outros membros (Item Clause) e só sugere itens legais', () => {
    const items = suggestItems(withMeta, NO_SPEED_CONTROL, 4);
    expect(items.length).toBeGreaterThan(3);
    for (const i of items) expect(dex.items[toId(i.item)].legal[reg]).toBe(true);
    const taken = new Set(NO_SPEED_CONTROL.slice(0, 4).map(s => toId(s.item)));
    for (const i of items) expect(i.blocked).toBe(taken.has(toId(i.item)));
    // Mega Stones só da própria espécie
    for (const i of suggestItems(withMeta, team('Charizard'), 0)) {
      const stone = dex.items[toId(i.item)].megaStone;
      if (stone) expect(Object.keys(stone)).toContain('Charizard');
    }
  });

  it('desvaloriza a terceira Mega Stone', () => {
    const t = team(`Charizard @ Charizardite Y
- Heat Wave

Garchomp @ Garchompite Z
- Earthquake

Gengar
- Shadow Ball`);
    const stone = suggestItems(withMeta, t, 2).find(i => i.item === 'Gengarite');
    const alone = suggestItems(withMeta, team('Gengar'), 0).find(i => i.item === 'Gengarite')!;
    expect(alone.score).toBeGreaterThan(0.5);
    expect(!stone || stone.score < alone.score / 2).toBe(true);
  });

  it('valoriza Intimidate quando a equipe não tem', () => {
    const t = team(`Incineroar

Garchomp
- Earthquake`);
    for (const [, ctx] of contexts) {
      const abilities = suggestAbilities(ctx, t, 0);
      expect(abilities[0].ability).toBe('Intimidate');
      expect(abilities[0].reasonsPt.join(' ')).toContain('Intimidate');
    }
  });

  it('spreads respeitam 66 SP no total e 32 por atributo', () => {
    for (const [, ctx] of contexts) {
      for (const t of [NO_SPEED_CONTROL, TRICK_ROOM]) {
        t.forEach((_, slot) => {
          const spreads = suggestSpreads(ctx, t, slot);
          expect(spreads.length).toBeGreaterThan(1);
          for (const s of spreads) {
            expect(validateSP(s.sp)).toEqual([]);
            expect(totalSP(s.sp)).toBeLessThanOrEqual(SP_TOTAL);
            expect(Math.max(...Object.values(s.sp))).toBeLessThanOrEqual(SP_MAX);
            expect(s.reasonsPt.length).toBeGreaterThan(0);
            expect(dex.natures[toId(s.nature)]).toBeDefined();
          }
        });
      }
    }
  });

  it('gera spread de Trick Room (0 SP e −Vel.) e de resistência para o setter', () => {
    for (const [, ctx] of contexts) {
      // Torkoal no Trick Room: o primeiro spread (gerado ou o do meta, se já for lento) tem 0 SP e −Vel.
      const spreads = suggestSpreads(ctx, TRICK_ROOM, 2);
      expect(spreads[0].sp.spe).toBe(0);
      expect(dex.natures[toId(spreads[0].nature)].minus).toBe('spe');
      expect(spreads[0].sp.spa).toBe(32);
      expect(spreads[0].reasonsPt.join(' ')).toContain('Trick Room');
    }
    // Resistência: a alocação gulosa deve ser pelo menos tão boa quanto 32 PS + divisão igual.
    const bulk = suggestSpreads(noMeta, TRICK_ROOM, 0).find(s => s.id === 'bulk')!;
    expect(totalSP(bulk.sp)).toBe(SP_TOTAL);
    const farigiraf = dex.species.farigiraf;
    const nature = dex.natures[toId(bulk.nature)];
    const naive = calcStats(farigiraf, { hp: 32, atk: 0, def: 17, spa: 0, spd: 17, spe: 0 }, nature);
    const product = (s: { hp: number; def: number; spd: number }) => s.hp * s.def * s.hp * s.spd;
    expect(product(bulk.stats)).toBeGreaterThanOrEqual(product(naive));
  });

  it('gera benchmarks de Velocidade contra ameaças do meta', () => {
    const spreads = suggestSpreads(withMeta, team('Garchomp\n- Earthquake\n- Dragon Claw'), 0);
    const bench = spreads.find(s => s.id.startsWith('bench'));
    expect(bench).toBeDefined();
    expect(bench!.reasonsPt[0]).toMatch(/passa/);
  });
});

describe('suggestPokemon', () => {
  const GROUND_WEAK = team(`Incineroar
Ability: Intimidate
- Fake Out
- Flare Blitz

Kingambit
- Kowtow Cleave

Torkoal
Ability: Drought
- Eruption`);
  const ROCK_ELECTRIC_WEAK = team(`Pelipper
Ability: Drizzle
- Hurricane

Talonflame
- Brave Bird

Gyarados
Ability: Intimidate
- Waterfall`);
  const groundImmune = (name: string) => {
    const s = dex.species[toId(name)];
    return s.types.includes('Flying') || Object.values(s.abilities).some(a => toId(a) === 'levitate');
  };
  const avgRank = (list: { species: string }[]) => {
    const idx = list.map((x, i) => (groundImmune(x.species) ? i : -1)).filter(i => i >= 0);
    return idx.reduce((s, i) => s + i, 0) / idx.length;
  };

  it('prioriza quem resiste/é imune à fraqueza da equipe', () => {
    for (const [, ctx] of contexts) {
      const a = rankPokemon(ctx, GROUND_WEAK);
      const b = rankPokemon(ctx, ROCK_ELECTRIC_WEAK);
      expect(avgRank(a)).toBeLessThan(avgRank(b));
      const da = a.find(x => x.species === 'Dragonite')!;
      const db = b.find(x => x.species === 'Dragonite')!;
      expect(a.indexOf(da)).toBeLessThan(b.indexOf(db));
      const defA = da.components.find(c => c.key === 'defensive')!.value;
      const defB = db.components.find(c => c.key === 'defensive')!.value;
      expect(defA).toBeGreaterThan(defB);
    }
    const top = suggestPokemon(withMeta, GROUND_WEAK, 12);
    expect(top.some(s => /(Imune|Resiste) a Terrestre/.test(s.reasonsPt.join(' ')))).toBe(true);
  });

  it('respeita a Species Clause e traz componentes, motivos e set completo', () => {
    for (const [, ctx] of contexts) {
      const list = suggestPokemon(ctx, NO_SPEED_CONTROL, 6);
      expect(list).toHaveLength(6);
      const nums = new Set(NO_SPEED_CONTROL.map(s => dex.species[toId(s.species)].num));
      for (const s of list) {
        expect(nums.has(dex.species[toId(s.species)].num)).toBe(false);
        expect(s.reasonsPt.length).toBeGreaterThanOrEqual(2);
        expect(s.reasonsPt.length).toBeLessThanOrEqual(5);
        expect(s.components.map(c => c.key).sort()).toEqual(Object.keys(DEFAULT_WEIGHTS).sort());
        for (const c of s.components) {
          expect(c.value).toBeGreaterThanOrEqual(0);
          expect(c.value).toBeLessThanOrEqual(1);
        }
        expect(s.score).toBeGreaterThan(0);
        expect(s.score).toBeLessThanOrEqual(1);
        expectLegalSet(s.set);
        const others = new Set(NO_SPEED_CONTROL.map(x => toId(x.item)));
        if (s.set.item) expect(others.has(toId(s.set.item))).toBe(false);
      }
      for (let i = 1; i < list.length; i++) expect(list[i - 1].score).toBeGreaterThanOrEqual(list[i].score);
    }
  });

  it('com a equipe sem controle de velocidade, valoriza quem traz e explica', () => {
    const list = suggestPokemon(withMeta, NO_SPEED_CONTROL.slice(0, 4), 12);
    expect(list.some(s => s.reasonsPt.some(r => r.includes('controle de velocidade')))).toBe(true);
  });

  it('usa parcerias do meta (lift e vitórias) nos motivos', () => {
    const list = rankPokemon(withMeta, team('Incineroar\nAbility: Intimidate'));
    const whimsi = list.find(s => s.species === 'Whimsicott')!;
    expect(whimsi.reasonsPt.join(' ')).toMatch(/Parceiro frequente de Incineroar \(lift 2,1×, 58% de vitórias\)/);
    const syn = whimsi.components.find(c => c.key === 'synergy')!;
    const rilla = list.find(s => s.species === 'Rillaboom')!.components.find(c => c.key === 'synergy')!;
    expect(syn.value).toBeGreaterThan(rilla.value);
  });

  it('pesos do usuário mudam o ranking e zerar um peso o desliga', () => {
    const ctx = createEngineContext(dex, sampleMeta(dex), heuristics, { meta: 1, winRate: 0, synergy: 0, defensive: 0, offensive: 0, roles: 0, threats: 0, archetype: 0 });
    const list = rankPokemon(ctx, team('Kingambit\n- Kowtow Cleave'));
    expect(list[0].species).toBe('Rillaboom');
    expect(list[0].components.find(c => c.key === 'roles')!.weight).toBe(0);
  });

  it('equipe vazia: destaques do meta e cores comuns', () => {
    const list = suggestPokemon(withMeta, [], 5);
    expect(list.map(s => s.species)).toContain('Rillaboom');
    expect(list.map(s => s.species)).toContain('Incineroar');
    const empty = suggestPokemon(noMeta, [], 3);
    expect(empty).toHaveLength(3);
    expect(empty[0].components.find(c => c.key === 'meta')!.labelPt).toContain('sem dados');
  });

  it('é rápido o bastante (equipe de 5, ~270 candidatos)', () => {
    suggestPokemon(withMeta, NO_SPEED_CONTROL, 12); // aquece caches
    const t0 = performance.now();
    suggestPokemon(withMeta, TRICK_ROOM, 12);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('buildSet / autoComplete', () => {
  it('monta set completo e legal; forma Mega vira espécie base + Mega Stone', () => {
    for (const [, ctx] of contexts) {
      const set = buildSet(ctx, NO_SPEED_CONTROL.slice(0, 4), 'Rillaboom');
      expectLegalSet(set);
      const mega = buildSet(ctx, NO_SPEED_CONTROL.slice(0, 4), 'Charizard-Mega-Y');
      expect(mega.species).toBe('Charizard');
      expect(mega.item).toBe('Charizardite Y');
      expectLegalSet(mega);
    }
    expect(buildSet(withMeta, [], 'Pokémon Inexistente').moves).toEqual([]);
  });

  it('não repete item de outro membro', () => {
    const t = team(`Kingambit @ Black Glasses
- Kowtow Cleave

Incineroar @ Sitrus Berry
- Fake Out`);
    for (const [, ctx] of contexts) {
      const set = buildSet(ctx, t, 'Farigiraf');
      expect(['blackglasses', 'sitrusberry']).not.toContain(toId(set.item));
    }
  });

  it('completa até 6 membros legais com itens únicos e no máximo 2 Megas', () => {
    for (const [label, ctx] of contexts) {
      for (const start of [[], NO_SPEED_CONTROL.slice(0, 2), TRICK_ROOM.slice(0, 3)]) {
        const full = autoComplete(ctx, start);
        expect(full, label).toHaveLength(6);
        full.forEach(expectLegalSet);
        const items = full.map(s => toId(s.item)).filter(Boolean);
        expect(new Set(items).size, `${label}: ${items.join(',')}`).toBe(items.length);
        expect(full.filter(s => dex.items[toId(s.item)]?.megaStone).length).toBeLessThanOrEqual(2);
        expect(new Set(full.map(s => dex.species[toId(s.species)].num)).size).toBe(6);
        // Não altera o que o usuário já escolheu
        start.forEach((s, i) => {
          expect(full[i].species).toBe(s.species);
          if (s.moves.length) expect(full[i].moves).toEqual(s.moves);
          if (s.item) expect(full[i].item).toBe(s.item);
        });
        const analysis = analyzeTeam(ctx, full);
        expect(analysis.issues.filter(i => i.severity === 'error')).toEqual([]);
      }
    }
  });
});

describe('meta vazio', () => {
  it('todas as funções respondem sem dados de uso', () => {
    const a = analyzeTeam(noMeta, NO_SPEED_CONTROL);
    expect(a.threats).toEqual([]);
    expect(a.summaryPt.join(' ')).toContain('Sem dados de meta');
    expect(suggestMoves(noMeta, NO_SPEED_CONTROL, 4).mostUsed).toEqual([]);
    expect(suggestMoves(noMeta, NO_SPEED_CONTROL, 4).recommended).toContain('Tailwind');
    expect(suggestItems(noMeta, NO_SPEED_CONTROL, 4).length).toBeGreaterThan(0);
    expect(suggestAbilities(noMeta, NO_SPEED_CONTROL, 4)[0].ability).toBe('Drizzle');
    expect(suggestSpreads(noMeta, NO_SPEED_CONTROL, 4).length).toBeGreaterThan(0);
    expect(analyzeTeam(noMeta, []).score).toBe(0);
    expect(suggestMoves(noMeta, NO_SPEED_CONTROL, 9)).toEqual({ recommended: [], mostUsed: [], ranked: [], diffPt: [] });
  });
});

describe('robustez', () => {
  it('não quebra com espécies desconhecidas, campos faltando, slots inválidos ou heurísticas mínimas', () => {
    const messy = [
      { species: 'Pikachu' },
      { species: 'Missingno', moves: ['Tackle'], sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } },
      { species: '', sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, moves: [] },
      { species: 'Charizard-Mega-Y', item: 'Charizardite Y', moves: ['Heat Wave', 'Golpe Falso'] },
    ] as unknown as Team;
    const bare: Heuristics = { version: 1, roles: [], archetypes: [], abilityImmunities: [], pairSynergies: [], moveHeuristics: [], spreadPrinciples: [], itemHeuristics: [] };
    for (const ctx of [withMeta, noMeta, createEngineContext(dex, sampleMeta(dex), bare)]) {
      const a = analyzeTeam(ctx, messy);
      expect(a.issues.some(i => i.messagePt.includes('Missingno'))).toBe(true);
      expect(a.issues.some(i => i.messagePt.includes('formas de batalha'))).toBe(true);
      expect(a.issues.some(i => i.messagePt.includes('Golpe Falso'))).toBe(true);
      for (const slot of [0, 1, 2, 3, 7, -1]) {
        expect(() => suggestMoves(ctx, messy, slot)).not.toThrow();
        expect(() => suggestItems(ctx, messy, slot)).not.toThrow();
        expect(() => suggestAbilities(ctx, messy, slot)).not.toThrow();
        expect(() => suggestSpreads(ctx, messy, slot)).not.toThrow();
      }
      expect(suggestPokemon(ctx, messy, 3)).toHaveLength(3);
      const full = autoComplete(ctx, messy);
      expect(full.length).toBeLessThanOrEqual(6);
      expect(full.find(s => s.species === 'Pikachu')!.moves.length).toBeGreaterThan(0);
    }
  });
});

describe('dano (@smogon/calc, geração 0)', () => {
  it('calcula porcentagem e chance de KO em português', () => {
    const [inc] = team(`Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 32 Atk / 2 Spe
Adamant Nature
- Flare Blitz`);
    const [chomp] = team(`Garchomp
Ability: Rough Skin
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake`);
    const r = calcDamage(withMeta, inc, chomp, 'Flare Blitz')!;
    expect(r).not.toBeNull();
    expect(r.maxPct).toBeGreaterThan(r.minPct);
    expect(r.minPct).toBeGreaterThan(20);
    expect(r.koTextPt).toMatch(/HKO|sem KO/);
    const eq = calcDamage(withMeta, chomp, inc, 'Earthquake', { attackerBoosts: { atk: -1 } })!;
    const eqFull = calcDamage(withMeta, chomp, inc, 'Earthquake')!;
    expect(eq.maxPct).toBeLessThan(eqFull.maxPct);
    expect(calcDamage(withMeta, { species: 'Inexistente', sp: inc.sp, moves: [] }, chomp, 'Tackle')).toBeNull();
    const protect = calcDamage(withMeta, inc, chomp, 'Protect')!;
    expect(protect.maxPct).toBe(0);
    expect(protect.koTextPt).toBe('não causa dano');
  });

  it('confrontos rápidos contra as ameaças do meta', () => {
    const list = quickMatchups(withMeta, NO_SPEED_CONTROL.slice(0, 2), 3);
    expect(list).toHaveLength(6);
    expect(list.some(m => m.offense && m.offense.maxPct > 0)).toBe(true);
    expect(list.some(m => m.defense && m.defense.maxPct > 0)).toBe(true);
    expect(quickMatchups(noMeta, NO_SPEED_CONTROL, 3)).toEqual([]);
  });
});

describe('regressões da revisão', () => {
  const SUN = team(`Charizard @ Charizardite Y
Ability: Blaze
- Heat Wave
- Solar Beam
- Weather Ball
- Protect

Venusaur @ Focus Sash
Ability: Chlorophyll
- Sleep Powder
- Energy Ball
- Sludge Bomb
- Protect

Incineroar @ Sitrus Berry
Ability: Intimidate
- Fake Out
- Flare Blitz
- Parting Shot
- Protect`);
  const NEUTRAL = team(`Kingambit @ Black Glasses
Ability: Defiant
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Protect

Gholdengo @ Life Orb
Ability: Good as Gold
- Make It Rain
- Shadow Ball
- Nasty Plot
- Protect

Incineroar @ Sitrus Berry
Ability: Intimidate
- Fake Out
- Flare Blitz
- Parting Shot
- Protect`);
  const isStone = (item: string | undefined) => !!dex.items[toId(item)]?.megaStone;

  it('penaliza quem troca o clima da equipe (Drizzle numa equipe de sol) e explica', () => {
    for (const [label, ctx] of contexts) {
      const sun = rankPokemon(ctx, SUN);
      const neutral = rankPokemon(ctx, NEUTRAL);
      const i = sun.findIndex(x => x.species === 'Pelipper');
      const j = neutral.findIndex(x => x.species === 'Pelipper');
      expect(i, label).toBeGreaterThan(j);
      expect(sun[i].reasonsPt, label).toContain('Atenção: Drizzle troca o sol da equipe pela chuva.');
      for (const s of suggestPokemon(ctx, SUN, 12)) {
        expect(['drizzle', 'sandstream', 'snowwarning'], `${label}: ${s.species}`).not.toContain(toId(ctx.dex.battleAbility(s.set)));
      }
    }
  });

  it('Swift Swim com chuva da equipe conta como controle de velocidade', () => {
    const rain = team(`Pelipper
Ability: Drizzle
- Hurricane
- Weather Ball
- Wide Guard
- Protect

Basculegion
Ability: Swift Swim
- Wave Crash
- Aqua Jet
- Last Respects
- Protect

Kingambit
Ability: Defiant
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Protect`);
    for (const [label, ctx] of contexts) {
      const a = analyzeTeam(ctx, rain);
      expect(a.missingRoles.map(r => r.id), label).not.toContain('speedcontrol');
      const via = a.roles.find(r => r.role.id === 'speedcontrol')!.providers.flatMap(p => p.via);
      expect(via).toContain('Swift Swim (chuva)');
      expect(a.issues.some(i => i.messagePt.startsWith('Sem controle de velocidade'))).toBe(false);
      // Sem quem ative a chuva, Swift Swim não conta.
      const dry = analyzeTeam(ctx, [NEUTRAL[1], rain[1], rain[2]]);
      expect(dry.missingRoles.map(r => r.id), label).toContain('speedcontrol');
    }
  });

  it('Weather Ball de quem tem Drought conta como Fogo nas ameaças do meta', () => {
    const zard = metaThreats(withMeta, 30).find(t => t.meta.id === 'charizard')!;
    expect(zard.member.formName).toBe('Charizard-Mega-Y');
    expect(zard.attackTypes).toContain('Fire');
    expect(zard.attackTypes).not.toContain('Normal');
  });

  it('o setter de Trick Room recebe spread de Velocidade mínima (o Trick Room dele conta)', () => {
    const t = team(`Farigiraf @ Sitrus Berry
Ability: Armor Tail
- Trick Room
- Psychic
- Helping Hand
- Protect

Kingambit
- Kowtow Cleave

Gholdengo
- Make It Rain`);
    for (const [label, ctx] of contexts) {
      const first = suggestSpreads(ctx, t, 0)[0];
      expect(first.sp.spe, label).toBe(0);
      expect(dex.natures[toId(first.nature)].minus, label).toBe('spe');
    }
  });

  it('Choice Scarf: spread com Velocidade e sem spread de Trick Room', () => {
    const t = team('Metagross @ Choice Scarf\nAbility: Clear Body\n- Heavy Slam\n- Zen Headbutt');
    for (const [label, ctx] of contexts) {
      const spreads = suggestSpreads(ctx, t, 0);
      expect(spreads[0].sp.spe, label).toBeGreaterThanOrEqual(20);
      expect(dex.natures[toId(spreads[0].nature)].minus).not.toBe('spe');
      expect(spreads.map(s => s.id)).not.toContain('trickroom');
    }
  });

  it('suporte com Fake Out e Parting Shot recebe spread de resistência primeiro', () => {
    const t = team('Incineroar\nAbility: Intimidate\n- Fake Out\n- Parting Shot\n- Flare Blitz\n- Protect');
    for (const [label, ctx] of contexts) {
      const first = suggestSpreads(ctx, t, 0)[0];
      expect(first.sp.atk, label).toBe(0);
      expect(first.sp.hp, label).toBeGreaterThanOrEqual(30);
    }
  });

  it('meta de outra forma não vale: Charizard-Mega-X não herda golpes e spreads do Mega Y', () => {
    const x = team('Charizard @ Charizardite X');
    const y = team('Charizard @ Charizardite Y');
    expect(suggestSpreads(withMeta, x, 0).some(s => s.id.startsWith('meta'))).toBe(false);
    expect(suggestSpreads(withMeta, y, 0).some(s => s.id === 'meta-1')).toBe(true);
    expect(suggestMoves(withMeta, x, 0).diffPt[0]).toContain('outra forma');
    for (const [label, ctx] of contexts) {
      for (const [t, stat] of [[x, 'atk'], [y, 'spa']] as const) {
        const [set] = autoComplete(ctx, t);
        expect(set.item, label).toBe(t[0].item);
        expect(dex.natures[toId(set.nature)].minus, `${label} ${set.item} ${set.nature}`).not.toBe(stat);
        const damaging = set.moves.map(m => dex.moves[toId(m)]).filter(m => m.category !== 'Status');
        const main = damaging.filter(m => m.category === (stat === 'atk' ? 'Physical' : 'Special')).length;
        expect(main * 2, `${label} ${set.item}: ${set.moves.join(', ')}`).toBeGreaterThan(damaging.length);
      }
    }
  });

  it('motivos da sugestão batem com o set montado (golpes citados e Mega)', () => {
    const teams = [NO_SPEED_CONTROL.slice(0, 3), TRICK_ROOM.slice(0, 3), SUN, [SUN[0]], []];
    for (const [label, ctx] of contexts) {
      for (const t of teams) {
        for (const s of suggestPokemon(ctx, t, 12)) {
          const own = new Set([...s.set.moves, s.set.ability, ctx.dex.battleAbility(s.set), s.set.item].filter(Boolean).map(toId));
          for (const r of s.reasonsPt) {
            const m = /^Traz (.+?)(?: \([^()]*\))?, que falta na equipe\.$/.exec(r);
            if (m) {
              for (const name of m[1].split(/, | e /)) {
                expect(own.has(toId(name.replace(/ \(.*\)$/, ''))), `${label} ${s.species}: "${r}" × ${s.set.moves.join('/')}`).toBe(true);
              }
            }
            if (r.includes('como Mega') || r.startsWith('Seria a segunda Mega')) expect(isStone(s.set.item), `${label} ${s.species}: ${r}`).toBe(true);
          }
        }
      }
    }
  });

  it('autoComplete completa golpes parciais sem tirar os do usuário', () => {
    for (const [label, ctx] of contexts) {
      const [set] = autoComplete(ctx, team('Incineroar\nAbility: Intimidate\n- Fake Out\n- Parting Shot'));
      expect(set.moves, label).toHaveLength(4);
      expect(set.moves.slice(0, 2)).toEqual(['Fake Out', 'Parting Shot']);
      expectLegalSet(set);
    }
  });

  it('não altera a equipe recebida (objetos congelados)', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object') {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
      return o;
    };
    const frozen = deepFreeze(structuredClone([...NO_SPEED_CONTROL.slice(0, 2), team('Charizard @ Charizardite Y\n- Heat Wave')[0], team('Pikachu')[0]]));
    const before = JSON.stringify(frozen);
    for (const [, ctx] of contexts) {
      analyzeTeam(ctx, frozen);
      suggestPokemon(ctx, frozen, 3);
      frozen.forEach((_, slot) => {
        suggestMoves(ctx, frozen, slot);
        suggestItems(ctx, frozen, slot);
        suggestAbilities(ctx, frozen, slot);
        suggestSpreads(ctx, frozen, slot);
      });
      buildSet(ctx, frozen, 'Rillaboom');
      autoComplete(ctx, frozen);
      quickMatchups(ctx, frozen, 2);
    }
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('campos com tipo errado não derrubam o motor', () => {
    const weird = [
      { species: 'Incineroar', moves: 'Fake Out', sp: null, item: 5, nature: 3, ability: null },
      { species: 'Garchomp', moves: [null, 7, 'Earthquake', ''], sp: { hp: '32', atk: Number.NaN, spe: -4 } },
      null,
      { species: 'Pelipper', item: null },
    ] as unknown as Team;
    for (const [, ctx] of contexts) {
      const a = analyzeTeam(ctx, weird);
      expect(a.issues.some(i => i.slot === 1 && i.messagePt.includes('SP negativo'))).toBe(true);
      expect(suggestPokemon(ctx, weird, 2)).toHaveLength(2);
      for (const slot of [0, 1, 2, 3]) {
        expect(() => suggestMoves(ctx, weird, slot)).not.toThrow();
        expect(() => suggestItems(ctx, weird, slot)).not.toThrow();
        expect(() => suggestAbilities(ctx, weird, slot)).not.toThrow();
        expect(() => suggestSpreads(ctx, weird, slot)).not.toThrow();
      }
      expect(autoComplete(ctx, weird).length).toBeLessThanOrEqual(6);
      expect(() => quickMatchups(ctx, weird, 2)).not.toThrow();
      expect(calcDamage(ctx, null as unknown as PokemonSet, weird[1], 'Earthquake')).toBeNull();
    }
  });

  it('sem meta: Eruption no sol, Protect (não Detect) e poder efetivo sem saturar cedo', () => {
    expect(suggestMoves(noMeta, TRICK_ROOM, 2).recommended).toContain('Eruption');
    for (const name of ['Staraptor', 'Scizor', 'Dragonite', 'Gallade', 'Lucario', 'Hawlucha']) {
      const rec = suggestMoves(noMeta, team(name), 0).recommended;
      expect(rec, name).toContain('Protect');
      expect(rec, name).not.toContain('Detect');
    }
    expect(powerValue(361)).toBeGreaterThan(powerValue(202) + 0.05);
    expect(powerValue(202)).toBeGreaterThan(powerValue(145));
    expect(powerValue(100)).toBeCloseTo(75 / 155);
    expect(powerValue(5000)).toBeLessThanOrEqual(1);
    expect(powerValue(Number.NaN)).toBe(0);
  });

  it('calcDamage usa a habilidade provável quando o set não informa', () => {
    const azu: PokemonSet = { species: 'Azumarill', nature: 'Adamant', sp: { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 }, moves: ['Aqua Jet'] };
    const [inc] = team('Incineroar @ Sitrus Berry\nAbility: Intimidate\nCareful Nature\nEVs: 32 HP / 10 Def / 24 SpD');
    const r = calcDamage(noMeta, azu, inc, 'Aqua Jet')!;
    expect(r.desc).toContain('Huge Power');
  });
});
