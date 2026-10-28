import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregate, decay, regulationWeight, shrinkWinRate } from '../scripts/lib/aggregate.ts';
import { parsePackedTeam, parseReplayLog } from '../scripts/sources/replays.ts';
import { chaosToSnapshot } from '../scripts/sources/smogon.ts';
import { fetchSmogonMirrorSnapshots } from '../scripts/sources/mirrors.ts';
import type { TeamRecord, UsageEntry, UsageSnapshot } from '../scripts/lib/records.ts';
import type { Dex } from '../src/core/types.ts';

const dex = JSON.parse(readFileSync('public/data/dex.json', 'utf8')) as Dex;

const team = (names: string[], wins: number, losses: number, date: string, extra: Partial<TeamRecord> = {}): TeamRecord => ({
  source: 'test', sourceKind: 'online', eventId: 'ev1', eventName: 'Teste', date, regulation: 'M-C', wins, losses,
  pokemon: names.map(n => ({ species: n, moves: ['Protect'], item: null, ability: null })), ...extra,
});

describe('pesos', () => {
  it('decaimento temporal e por regulação', () => {
    expect(decay('2026-10-01', '2026-10-01', 60)).toBe(1);
    expect(decay('2026-08-02', '2026-10-01', 60)).toBeCloseTo(0.5, 2);
    expect(regulationWeight('M-C', ['M-C', 'M-B'])).toBe(1);
    expect(regulationWeight('M-B', ['M-C', 'M-B'])).toBe(0.35);
    expect(regulationWeight('I', ['M-C', 'M-B'])).toBe(0.05);
    expect(shrinkWinRate(10, 10, 20)).toBeCloseTo(20 / 30);
  });
});

describe('aggregate', () => {
  const base = ['Incineroar', 'Garchomp', 'Sneasler', 'Kingambit'];
  const records = [
    team([...base, 'Pelipper', 'Archaludon'], 7, 1, '2026-10-20', { placing: 1, players: 64 }),
    team([...base, 'Torkoal', 'Charizard-Mega-Y'], 2, 6, '2026-10-20', { placing: 50, players: 64 }),
    team(['Incineroar', 'Whimsicott', 'Dragonite', 'Gholdengo'], 4, 4, '2026-10-21'),
  ];
  const meta = aggregate({ dex, regulation: 'M-C', regulationOrder: ['M-C', 'M-B'], snapshots: [], records, patches: [], now: '2026-10-27' });

  it('calcula uso, vitória ajustada e Megas pela espécie base', () => {
    expect(meta.pokemon.incineroar.usage).toBeCloseTo(1);
    expect(meta.pokemon.charizard).toBeDefined();
    expect(meta.pokemon.charizard.items[0].name).toBe('Charizardite Y');
    expect(meta.pokemon.pelipper.winRate!).toBeGreaterThan(0.5);
    expect(meta.pokemon.torkoal.winRate!).toBeLessThan(0.5);
    expect(meta.pokemon.incineroar.rank).toBe(1);
    expect(meta.pokemon.pelipper.topCutRate).toBe(1);
  });

  it('gera cores e eventos', () => {
    expect(meta.cores.some(c => c.members.join() === ['garchomp', 'incineroar'].join())).toBe(true);
    expect(meta.events[0].teams[0].placing).toBe(1);
  });

  it('penaliza dados anteriores a patches da espécie', () => {
    const patched = aggregate({
      dex, regulation: 'M-C', regulationOrder: ['M-C'], now: '2026-10-27', snapshots: [],
      records: [team([...base, 'Pelipper', 'Archaludon'], 5, 0, '2026-09-01'), team(['Incineroar', 'Whimsicott', 'Dragonite', 'Gholdengo'], 0, 5, '2026-10-20')],
      patches: [{ date: '2026-10-01', affects: ['Pelipper'] }],
    });
    const unpatched = aggregate({
      dex, regulation: 'M-C', regulationOrder: ['M-C'], now: '2026-10-27', snapshots: [],
      records: [team([...base, 'Pelipper', 'Archaludon'], 5, 0, '2026-09-01'), team(['Incineroar', 'Whimsicott', 'Dragonite', 'Gholdengo'], 0, 5, '2026-10-20')],
      patches: [],
    });
    expect(patched.pokemon.pelipper.usage).toBeLessThan(unpatched.pokemon.pelipper.usage);
  });

  const entry = (usage: number, extra: Partial<UsageEntry> = {}): UsageEntry => ({ usage, moves: {}, items: {}, abilities: {}, spreads: {}, teammates: {}, ...extra });
  const snap = (regulation: string, pokemon: Record<string, UsageEntry>): UsageSnapshot => ({
    source: `smogon:${regulation}`, sourceKind: 'ladder', label: regulation, date: '2026-10-20', regulation, battles: 5000, pokemon,
  });

  it('uso só conta amostras de regulações em que a espécie era legal', () => {
    // Rillaboom é ilegal na M-B: times e ladder da M-B não podem diluir o uso dele na M-C.
    expect(dex.species.rillaboom.legal['M-B']).toBe(false);
    const withR = ['Incineroar', 'Rillaboom', 'Garchomp', 'Sneasler'];
    const without = ['Incineroar', 'Kingambit', 'Garchomp', 'Sneasler'];
    const recs = [
      ...[1, 2, 3].map(() => team(withR, 5, 3, '2026-10-20')),
      ...[1, 2, 3].map(() => team(without, 5, 3, '2026-10-20')),
      ...[1, 2, 3, 4].map(() => team(without, 5, 3, '2026-10-20', { regulation: 'M-B' })),
    ];
    const snapshots = [snap('M-C', { Rillaboom: entry(0.5), Incineroar: entry(0.5) }), snap('M-B', { Incineroar: entry(0.6) })];
    const m = aggregate({ dex, regulation: 'M-C', regulationOrder: ['M-C', 'M-B'], snapshots, records: recs, patches: [], now: '2026-10-27' });
    expect(m.pokemon.rillaboom.usage).toBeCloseTo(0.5, 6);
    expect(m.cores.find(c => c.members.join() === 'incineroar,rillaboom')?.usage).toBeCloseTo(0.5, 6);
    // Quem era legal nas duas regulações continua misturando as duas (M-B com peso 0,35).
    const recOnly = aggregate({ dex, regulation: 'M-C', regulationOrder: ['M-C', 'M-B'], snapshots: [], records: recs, patches: [], now: '2026-10-27' });
    expect(recOnly.pokemon.kingambit.usage).toBeCloseTo((3 + 0.35 * 4) / (6 + 0.35 * 4), 6);
    expect(recOnly.pokemon.rillaboom.usage).toBeCloseTo(0.5, 6);
  });

  it('habilidade da forma Mega não entra como habilidade da espécie base', () => {
    const megaY = (ability: string) => ({ species: 'Charizard-Mega-Y', item: 'Charizardite Y', ability, moves: ['Heat Wave'] });
    const recs = [1, 2, 3].map((_, i) => ({
      ...team(['Incineroar', 'Garchomp', 'Sneasler'], 4, 4, '2026-10-20'),
      pokemon: [...team(['Incineroar', 'Garchomp', 'Sneasler'], 0, 0, '2026-10-20').pokemon, megaY(i ? 'Solar Power' : 'Drought')],
    }));
    const snapshots = [snap('M-C', { 'Charizard-Mega-Y': entry(0.2, { abilities: { drought: 1 }, items: { charizarditey: 1 } }), Incineroar: entry(0.5) })];
    const m = aggregate({ dex, regulation: 'M-C', regulationOrder: ['M-C'], snapshots, records: recs, patches: [], now: '2026-10-27' });
    expect(m.pokemon.charizard.abilities.map(a => a.id)).toEqual(['solarpower']);
    expect(m.pokemon.charizard.abilities[0].share).toBeCloseTo(1);
    // O time mostrado no evento mantém o que o jogador listou.
    expect(m.events[0].teams.some(t => t.pokemon.some(p => p.ability === 'Drought'))).toBe(true);
  });
});

describe('fontes', () => {
  it('converte chaos da Smogon', () => {
    const snap = chaosToSnapshot({
      info: { 'number of battles': 1000 },
      data: { Incineroar: { usage: 0.5, 'Raw count': 600, Abilities: { intimidate: 90, blaze: 10 }, Items: { sitrusberry: 60, nothing: 40 }, Moves: { fakeout: 95, protect: 50 }, Spreads: { 'Careful:32/0/10/0/24/0': 30 }, Teammates: { Garchomp: 40 } } },
    }, { month: '2026-09', regulation: 'M-C', formatId: 'gen9championsvgc2026regmc', cutoff: 1760 });
    expect(snap.pokemon.Incineroar.abilities.intimidate).toBeCloseTo(0.9);
    expect(snap.pokemon.Incineroar.items.nothing).toBeUndefined();
    expect(snap.date).toBe('2026-09-15');
  });

  it('lê Open Team Sheets de replays', () => {
    const packed = 'Incineroar||SitrusBerry|Intimidate|FakeOut,FlareBlitz,PartingShot,KnockOff|Careful|32,,10,,24,||||50|]Sneasler||WhiteHerb|Unburden|CloseCombat,DireClaw,FakeOut,Protect|Jolly|,32,,,2,32||||50|';
    const team = parsePackedTeam(packed);
    expect(team[0]).toMatchObject({ species: 'Incineroar', item: 'Sitrus Berry', ability: 'Intimidate', nature: 'Careful' });
    expect(team[0].moves).toContain('Fake Out');
    expect(team[1].sp).toEqual({ atk: 32, spd: 2, spe: 32 });
    const log = `|player|p1|Alice|1|1500\n|player|p2|Bob|2|1490\n|poke|p1|Incineroar, L50, M|\n|poke|p2|Garchomp, L50, F|\n|showteam|p1|${packed}\n|win|Bob`;
    const parsed = parseReplayLog(log);
    expect(parsed.winner).toBe('p2');
    expect(parsed.teams.p1).toHaveLength(2);
    expect(parsed.teams.p2[0].species).toBe('Garchomp');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('espelho da Smogon: só meses já publicados e falha num mês não derruba os outros', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      if (url.includes('/2026-08/')) return new Response('forbidden', { status: 403 });
      if (url.endsWith('/2026-09/fmt/1760/_index.json')) {
        return new Response(JSON.stringify({ info: { 'number of battles': 4000 }, pokemon: { Rillaboom: { usage: 0.47, raw: 100 } } }));
      }
      if (url.endsWith('/2026-09/fmt/1760/Rillaboom.json')) return new Response(JSON.stringify({ Abilities: { grassysurge: 10 }, Moves: { fakeout: 10 } }));
      return new Response('not found', { status: 404 });
    });
    const snaps = await fetchSmogonMirrorSnapshots([{ id: 'fmt', regulation: 'M-C' }], { months: 2, now: new Date('2026-10-28T12:00:00Z'), log: () => {} });
    expect([...new Set(asked.map(u => /stats\/(\d{4}-\d{2})\//.exec(u)?.[1]))]).toEqual(['2026-08', '2026-09']);
    expect(snaps.map(s => s.period)).toEqual(['2026-09']);
    expect(snaps[0].pokemon.Rillaboom.usage).toBeCloseTo(0.47);
  });
});
