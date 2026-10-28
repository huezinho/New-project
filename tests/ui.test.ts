import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SpeedEntry } from '../src/core/api.ts';
import { DexAccess } from '../src/core/dex.ts';
import type { Dex } from '../src/core/types.ts';
import { checkMeta, checkPatches, checkRegulations } from '../src/ui/data.ts';
import { eventNamePt, locationPt } from '../src/ui/eventNames.ts';
import { simpleDefensive, simpleSpeed } from '../src/ui/fallback.ts';
import { sanitizeStore } from '../src/ui/storage.ts';
import {
  formatLooseDate, formatMult, illegalMoves, itemClauseConflicts, itemsForSpecies, looseDateRange, matchesQuery, normalizeSet,
  repeatedMoves, sanitizeSP, setSPValue, speciesClauseConflicts, speedRows, spriteId,
} from '../src/ui/util.ts';

const dexData = JSON.parse(readFileSync(new URL('../public/data/dex.json', import.meta.url), 'utf8')) as Dex;
const dex = new DexAccess(dexData);
const sp = (v: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>> = {}) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...v });

describe('UI: sprites e textos', () => {
  it('monta o id de sprite do Showdown', () => {
    expect(spriteId({ name: 'Charizard-Mega-Y', baseSpecies: 'Charizard', forme: 'Mega-Y' })).toBe('charizard-megay');
    expect(spriteId({ name: 'Floette-Eternal', baseSpecies: 'Floette', forme: 'Eternal' })).toBe('floette-eternal');
    expect(spriteId({ name: 'Rotom-Wash', baseSpecies: 'Rotom', forme: 'Wash' })).toBe('rotom-wash');
    expect(spriteId({ name: 'Incineroar' })).toBe('incineroar');
  });

  it('busca ignora acentos e caixa', () => {
    expect(matchesQuery('psiquico', 'Farigiraf', 'Normal Psíquico')).toBe(true);
    expect(matchesQuery('fake out', 'Fake Out')).toBe(true);
    expect(matchesQuery('fogo agua', 'Volcanion', 'Fogo')).toBe(false);
  });

  it('formata multiplicadores', () => {
    expect([0, 0.25, 0.5, 1, 2, 4].map(formatMult)).toEqual(['0', '¼', '½', '1', '2', '4']);
  });

  it('formata datas soltas dos JSON curados', () => {
    expect(formatLooseDate('2026-09-18/20')).toBe('18–20/09/2026');
    expect(formatLooseDate('2026-10-31/11-01')).toBe('31/10–01/11/2026');
    expect(formatLooseDate('2026-04-22 (Américas) / 2026-04-23 (Nintendo Europa)')).toBe('22/04/2026 (Américas) / 23/04/2026 (Nintendo Europa)');
    expect(formatLooseDate('desconhecida')).toBe('desconhecida');
    const r = looseDateRange('2026-10-31/11-01')!;
    expect(new Date(r.end).toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(looseDateRange('sem data')).toBeNull();
  });

  it('traduz nomes de eventos e locais', () => {
    expect(eventNamePt('2027 Recife Regional Championship')).toBe('Regional de Recife 2027');
    expect(eventNamePt('Latin America International Championships (LAIC 2027)')).toBe('Internacional da América Latina (LAIC 2027)');
    expect(eventNamePt('2026 Indianapolis Regional Championships (first in-person Champions VGC event)')).toBe('Regional de Indianapolis 2026');
    expect(eventNamePt('2026 World Championship')).toBe('Mundial Pokémon 2026');
    expect(eventNamePt('Rio de Janeiro Regional Championships')).toBe('Regional do Rio de Janeiro');
    expect(eventNamePt('Intimidators Champions Challenge #52 REG M-C')).toBe('Intimidators Champions Challenge #52 REG M-C');
    expect(locationPt('São Paulo, Brazil')).toBe('São Paulo, Brasil');
    expect(locationPt('online (in-game)')).toBe('Online (no jogo)');
  });
});

describe('UI: Stat Points e saneamento', () => {
  it('respeita 32 por atributo e 66 no total', () => {
    let s = setSPValue(sp(), 'spe', 40);
    expect(s.spe).toBe(32);
    s = setSPValue(s, 'spa', 32);
    s = setSPValue(s, 'hp', 9);
    expect(s.hp).toBe(2);
    const clean = sanitizeSP({ hp: 50, atk: 32, spe: 32, def: -3, spd: 'x' });
    expect(Object.values(clean).reduce((a, b) => a + b, 0)).toBe(66);
    expect(Math.max(...Object.values(clean))).toBeLessThanOrEqual(32);
    expect(clean.def).toBe(0);
    expect(clean.spd).toBe(0);
  });

  it('recupera equipes salvas inválidas', () => {
    const store = sanitizeStore({ activeId: 'nao-existe', teams: [{ id: 'a', name: '', team: [{ species: 'Incineroar', sp: { hp: 99 }, moves: ['Fake Out', 3] }, { foo: 1 }] }] });
    expect(store.activeId).toBe('a');
    expect(store.teams[0].name).toBe('Equipe sem nome');
    expect(store.teams[0].team).toHaveLength(1);
    expect(store.teams[0].team[0].sp.hp).toBe(32);
    expect(store.teams[0].team[0].moves).toEqual(['Fake Out']);
    expect(sanitizeStore(null).teams).toHaveLength(1);
  });
});

describe('UI: regras do Champions com o dex real', () => {
  it('normaliza Megas escritas como espécie para base + Mega Stone', () => {
    const { set, warnings } = normalizeSet(dex, { species: 'charizard-mega-y', sp: sp(), moves: ['heat wave'] });
    expect(set.species).toBe('Charizard');
    expect(set.item).toBe('Charizardite Y');
    expect(set.moves).toEqual(['Heat Wave']);
    expect(warnings).toEqual([]);
    expect(dex.battleForm(set)?.name).toBe('Charizard-Mega-Y');
  });

  it('avisa itens que não existem no Champions', () => {
    const { warnings } = normalizeSet(dex, { species: 'Incineroar', item: 'Assault Vest', sp: sp(), moves: [] });
    expect(warnings.some(w => /Assault Vest/.test(w))).toBe(true);
  });

  it('detecta Item Clause e Species Clause (formas contam como a mesma espécie)', () => {
    const team = [
      { species: 'Rotom-Wash', item: 'Sitrus Berry', sp: sp(), moves: [] },
      { species: 'Rotom-Heat', item: 'Sitrus Berry', sp: sp(), moves: [] },
      { species: 'Incineroar', item: 'Focus Sash', sp: sp(), moves: [] },
    ];
    expect([...itemClauseConflicts(team).keys()]).toEqual([0, 1]);
    expect([...speciesClauseConflicts(dex, team).keys()]).toEqual([0, 1]);
  });

  it('lista só as Mega Stones da própria espécie e nenhum item ilegal', () => {
    const { megas, others } = itemsForSpecies(dex, dex.species('Charizard'));
    expect(megas.map(i => i.name).sort()).toEqual(['Charizardite X', 'Charizardite Y']);
    expect(others.some(i => i.megaStone)).toBe(false);
    expect(others.some(i => i.id === 'choiceband' || i.id === 'assaultvest')).toBe(false);
  });

  it('análise local usa a forma Mega (tipos e habilidade)', () => {
    const team = [{ species: 'Charizard', item: 'Charizardite Y', ability: 'Blaze', nature: 'Timid', sp: sp({ spa: 32, spe: 32, hp: 2 }), moves: [] }];
    const rock = simpleDefensive(dex, team).find(r => r.type === 'Rock')!;
    expect(rock.multipliers[0]).toBe(4);
    const [speed] = simpleSpeed(dex, team);
    expect(speed.species).toBe('Charizard-Mega-Y');
    expect(speed.speed).toBeGreaterThan(150);
  });
});

describe('UI: revisão (bugs corrigidos)', () => {
  it('normaliza golpes repetidos e a habilidade de Mega escrita na forma base', () => {
    const { set, warnings } = normalizeSet(dex, { species: 'Charizard-Mega-Y', ability: 'Drought', sp: sp(), moves: ['Protect', 'protect', 'Heat Wave'] });
    expect(set.moves).toEqual(['Protect', 'Heat Wave']);
    expect(warnings.some(w => /repetido/.test(w))).toBe(true);
    expect(Object.values(dex.species('Charizard')!.abilities)).toContain(set.ability);
    expect(dex.battleAbility(set)).toBe('Drought');
  });

  it('aponta golpes que a espécie não aprende e golpes repetidos', () => {
    const set = { species: 'Incineroar', sp: sp(), moves: ['Fake Out', 'Knock Off', 'Fake Out', 'fakeout'] };
    expect(illegalMoves(dex, set)).toEqual(['Knock Off']);
    expect(repeatedMoves(dex, set)).toEqual(['Fake Out']);
  });

  it('velocidades: Tailwind do motor não é dobrado de novo e Trick Room usa só a base', () => {
    const entries: SpeedEntry[] = [
      { slot: 0, species: 'Talonflame', speed: 252, label: 'sob Tailwind (×2)', isMeta: false },
      { slot: 0, species: 'Talonflame', speed: 126, label: '32 SP', isMeta: false },
      { slot: 1, species: 'Venusaur', speed: 160, label: 'Chlorophyll no clima (×2)', isMeta: false },
      { slot: 1, species: 'Venusaur', speed: 80, label: '0 SP', isMeta: false },
      { species: 'Garchomp', speed: 169, label: 'spread mais comum', isMeta: true },
    ];
    expect(speedRows(entries, 'normal').map(r => r.eff)).toEqual([169, 160, 126, 80]);
    expect(speedRows(entries, 'tailwind').map(r => r.eff)).toEqual([320, 252, 169, 160]);
    expect(speedRows(entries, 'trickroom').map(r => r.eff)).toEqual([80, 126, 169]);
  });

  it('meta.json malformado não quebra a interface', () => {
    const meta = checkMeta({
      pokemon: { incineroar: { name: 'Incineroar', usage: '0,5' }, lixo: 3 },
      events: [{ id: 'x', teams: [{ pokemon: [{ species: 'Incineroar', moves: ['Fake Out', 4] }, { item: 'x' }] }, 'y'] }, 5],
      cores: [{ members: 'nope' }, { members: ['incineroar', 'sneasler'], usage: 0.1 }],
      archetypes: [{ id: 'tw' }],
      sources: [{ label: 'Smogon', samples: 'x' }, 7],
    });
    const p = meta.pokemon.incineroar;
    expect(p.id).toBe('incineroar');
    expect(p.usage).toBe(0);
    expect([p.moves, p.items, p.abilities, p.spreads, p.teammates]).toEqual([[], [], [], [], []]);
    expect(meta.pokemon.lixo).toBeUndefined();
    expect(meta.events).toHaveLength(1);
    expect(meta.events[0].teams[0].pokemon).toEqual([{ species: 'Incineroar', moves: ['Fake Out'] }]);
    expect(meta.cores).toHaveLength(1);
    expect(meta.archetypes[0].keyMembers).toEqual([]);
    expect(meta.sources[0].samples).toBe(0);
  });

  it('regulations.json e patches.json com tipos errados viram campos ausentes', () => {
    const regs = checkRegulations({
      regulations: [{ id: 5, start: 7, rankedSeasons: 'x', events: [{ event: 3, date: {} }] }, null],
      season2027: [{ event: 3, date: {} }],
      itemsAvailability: [{ item: 'Life Orb', available: 'sim' }, { item: 3 }],
      legalityDiffMBtoMC: { added: 'Pikachu', removed: ['Garchomp', 2] },
      battleRules: { clauses: [{ clause: {} }, { clause: 'Item Clause' }] },
    })!;
    expect(regs.regulations).toHaveLength(1);
    expect(regs.regulations[0].start).toBeUndefined();
    expect(regs.regulations[0].rankedSeasons).toEqual([]);
    expect(regs.season2027[0].date).toBeUndefined();
    expect(regs.itemsAvailability).toEqual([{ item: 'Life Orb', available: undefined, availableMB: undefined, availableMA: undefined }]);
    expect(regs.legalityDiffs[0].diff.removed).toEqual(['Garchomp']);
    expect(regs.battleRules?.clauses).toEqual([{ clause: 'Item Clause', source: undefined }]);
    const patches = checkPatches({ versions: [{ version: 1, changes: [{ name: {}, field: 'basePower', from: 80, to: 90 }, 3] }], gaps: [1, 'ok'] })!;
    expect(patches.versions[0].version).toBe('1');
    expect(patches.versions[0].changes).toHaveLength(1);
    expect(patches.versions[0].changes![0].name).toBeUndefined();
    expect(patches.gaps).toEqual(['ok']);
  });
});
