/**
 * Construtor de meta sintético para testes do motor. Usa ids reais do
 * dex.json e valida tudo (espécie legal, golpe aprendível, item legal), para
 * que os testes não dependam do conteúdo real de public/data/meta.json.
 */
import { toId } from '../../src/core/id.ts';
import type { Dex, Meta, MetaCore, MetaPokemon, StatsTable } from '../../src/core/types.ts';

export interface FixtureMon {
  id: string;
  usage: number;
  winRate?: number | null;
  games?: number;
  moves?: [string, number][];
  items?: [string, number][];
  abilities?: [string, number][];
  spreads?: { nature: string; sp: Partial<StatsTable>; share: number }[];
  teammates?: { id: string; share: number; winRate?: number | null; games?: number }[];
}

const ZERO: StatsTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

export function emptyMeta(regulation = 'M-C'): Meta {
  return {
    version: 1,
    generatedAt: '2026-10-27T00:00:00.000Z',
    regulation,
    formatId: 'gen9championsvgc2026regmc',
    halfLifeDays: 60,
    sources: [],
    pokemon: {},
    cores: [],
    archetypes: [],
    events: [],
    notes: [],
  };
}

export function buildMeta(dex: Dex, mons: FixtureMon[], cores: MetaCore[] = []): Meta {
  const reg = dex.currentRegulation;
  const meta = emptyMeta(reg);
  const fail = (msg: string): never => {
    throw new Error(`fixture: ${msg}`);
  };
  const sorted = [...mons].sort((a, b) => b.usage - a.usage);
  for (const [i, m] of sorted.entries()) {
    const sp = dex.species[m.id] ?? fail(`espécie desconhecida ${m.id}`);
    if (!sp.legal[reg]) fail(`${m.id} não é legal na ${reg}`);
    const moves = (m.moves ?? []).map(([id, share]) => {
      const mv = dex.moves[id] ?? fail(`golpe desconhecido ${id}`);
      if (!sp.learnset.includes(id)) fail(`${m.id} não aprende ${id}`);
      return { id, name: mv.name, share };
    });
    const items = (m.items ?? []).map(([id, share]) => {
      const it = dex.items[id] ?? fail(`item desconhecido ${id}`);
      if (!it.legal[reg]) fail(`item ilegal ${id}`);
      return { id, name: it.name, share };
    });
    const abilities = (m.abilities ?? []).map(([id, share]) => {
      const ab = dex.abilities[id] ?? fail(`habilidade desconhecida ${id}`);
      if (!Object.values(sp.abilities).some(a => toId(a) === id)) fail(`${m.id} não tem ${id}`);
      return { id, name: ab.name, share };
    });
    const pokemon: MetaPokemon = {
      id: m.id,
      name: sp.name,
      usage: m.usage,
      rank: i + 1,
      winRate: m.winRate ?? null,
      games: m.games ?? 0,
      moves,
      items,
      abilities,
      spreads: (m.spreads ?? []).map(s => ({ nature: s.nature, sp: { ...ZERO, ...s.sp }, share: s.share })),
      teammates: (m.teammates ?? []).map(t => ({
        id: t.id,
        name: (dex.species[t.id] ?? fail(`parceiro desconhecido ${t.id}`)).name,
        share: t.share,
        winRate: t.winRate ?? null,
        games: t.games ?? 0,
      })),
      trend: null,
      sources: ['fixture'],
    };
    meta.pokemon[m.id] = pokemon;
  }
  // lift = P(parceiro | espécie) / P(parceiro)
  for (const p of Object.values(meta.pokemon)) {
    for (const t of p.teammates) {
      const u = meta.pokemon[t.id]?.usage;
      if (u) t.lift = t.share / u;
    }
  }
  meta.cores = cores;
  return meta;
}

/** Meta pequeno e plausível da Reg M-C para os testes. */
export function sampleMeta(dex: Dex): Meta {
  return buildMeta(
    dex,
    [
      {
        id: 'rillaboom', usage: 0.45, winRate: 0.51, games: 900,
        moves: [['fakeout', 0.98], ['grassyglide', 0.95], ['woodhammer', 0.85], ['highhorsepower', 0.5], ['uturn', 0.4], ['protect', 0.2]],
        items: [['miracleseed', 0.4], ['sitrusberry', 0.2]], abilities: [['grassysurge', 0.99]],
        spreads: [{ nature: 'Adamant', sp: { hp: 32, atk: 32, spd: 2 }, share: 0.4 }],
        teammates: [{ id: 'incineroar', share: 0.5, winRate: 0.52, games: 300 }],
      },
      {
        id: 'incineroar', usage: 0.4, winRate: 0.52, games: 800,
        moves: [['fakeout', 0.97], ['partingshot', 0.9], ['flareblitz', 0.88], ['throatchop', 0.4], ['protect', 0.3]],
        items: [['sitrusberry', 0.5], ['chopleberry', 0.2]], abilities: [['intimidate', 0.98]],
        spreads: [{ nature: 'Careful', sp: { hp: 32, def: 10, spd: 24 }, share: 0.3 }],
        teammates: [
          { id: 'rillaboom', share: 0.5, winRate: 0.52, games: 300 },
          { id: 'whimsicott', share: 0.32, winRate: 0.58, games: 150 },
          { id: 'farigiraf', share: 0.2, winRate: 0.56, games: 80 },
        ],
      },
      {
        id: 'sneasler', usage: 0.37, winRate: 0.5, games: 700,
        moves: [['closecombat', 0.98], ['direclaw', 0.8], ['protect', 0.75], ['fakeout', 0.5]],
        items: [['whiteherb', 0.4], ['grassyseed', 0.3]], abilities: [['unburden', 0.9]],
        spreads: [{ nature: 'Jolly', sp: { hp: 2, atk: 32, spe: 32 }, share: 0.6 }],
      },
      {
        id: 'garchomp', usage: 0.3, winRate: 0.5, games: 600,
        moves: [['protect', 0.78], ['earthquake', 0.6], ['dragonclaw', 0.55], ['rockslide', 0.5], ['stompingtantrum', 0.35]],
        items: [['choicescarf', 0.3], ['lifeorb', 0.25], ['garchompitez', 0.2]], abilities: [['roughskin', 0.85]],
        spreads: [{ nature: 'Jolly', sp: { hp: 2, atk: 32, spe: 32 }, share: 0.5 }],
      },
      {
        id: 'kingambit', usage: 0.27, winRate: 0.53, games: 500,
        moves: [['suckerpunch', 0.98], ['kowtowcleave', 0.97], ['protect', 0.7], ['ironhead', 0.55]],
        items: [['blackglasses', 0.3], ['chopleberry', 0.3]], abilities: [['defiant', 0.8], ['supremeoverlord', 0.2]],
        spreads: [{ nature: 'Adamant', sp: { hp: 32, atk: 32, spd: 2 }, share: 0.5 }],
      },
      {
        id: 'gholdengo', usage: 0.22, winRate: 0.49, games: 400,
        moves: [['makeitrain', 0.98], ['shadowball', 0.95], ['protect', 0.9], ['nastyplot', 0.85]],
        items: [['lifeorb', 0.4], ['choicescarf', 0.2]], abilities: [['goodasgold', 1]],
        spreads: [{ nature: 'Modest', sp: { hp: 32, spa: 32, spd: 2 }, share: 0.4 }],
      },
      {
        id: 'charizard', usage: 0.18, winRate: 0.5, games: 300,
        moves: [['heatwave', 0.9], ['protect', 0.8], ['weatherball', 0.6], ['solarbeam', 0.55]],
        items: [['charizarditey', 0.95]], abilities: [['blaze', 0.5], ['solarpower', 0.5]],
        spreads: [{ nature: 'Timid', sp: { hp: 2, spa: 32, spe: 32 }, share: 0.6 }],
      },
      {
        id: 'whimsicott', usage: 0.15, winRate: 0.55, games: 250,
        moves: [['tailwind', 0.9], ['moonblast', 0.85], ['encore', 0.7], ['protect', 0.55], ['helpinghand', 0.4]],
        items: [['focussash', 0.6]], abilities: [['prankster', 0.99]],
        spreads: [{ nature: 'Timid', sp: { hp: 2, spa: 32, spe: 32 }, share: 0.5 }],
        teammates: [{ id: 'incineroar', share: 0.85, winRate: 0.58, games: 150 }],
      },
      {
        id: 'pelipper', usage: 0.14, winRate: 0.5, games: 250,
        moves: [['hurricane', 0.9], ['weatherball', 0.85], ['protect', 0.75], ['uturn', 0.5], ['wideguard', 0.4], ['tailwind', 0.3]],
        items: [['damprock', 0.5], ['focussash', 0.2]], abilities: [['drizzle', 0.99]],
        spreads: [{ nature: 'Modest', sp: { hp: 32, spa: 32, spd: 2 }, share: 0.4 }],
      },
      {
        id: 'archaludon', usage: 0.12, winRate: 0.5, games: 200,
        moves: [['electroshot', 0.9], ['protect', 0.8], ['dracometeor', 0.7], ['bodypress', 0.4]],
        items: [['sitrusberry', 0.3]], abilities: [['stamina', 0.9]],
        spreads: [{ nature: 'Modest', sp: { hp: 32, spa: 32, spd: 2 }, share: 0.4 }],
      },
      {
        id: 'dragonite', usage: 0.1, winRate: 0.5, games: 150,
        moves: [['extremespeed', 0.9], ['protect', 0.7], ['earthquake', 0.4], ['tailwind', 0.3], ['dragonclaw', 0.3]],
        items: [['lumberry', 0.3]], abilities: [['multiscale', 0.9]],
        spreads: [{ nature: 'Adamant', sp: { hp: 32, atk: 32, spe: 2 }, share: 0.5 }],
      },
      {
        id: 'farigiraf', usage: 0.08, winRate: 0.54, games: 120,
        moves: [['trickroom', 0.9], ['protect', 0.7], ['helpinghand', 0.6], ['hypervoice', 0.5], ['psychic', 0.3]],
        items: [['mentalherb', 0.3], ['sitrusberry', 0.3]], abilities: [['armortail', 0.95]],
        spreads: [{ nature: 'Quiet', sp: { hp: 32, spa: 32, def: 2 }, share: 0.5 }],
        teammates: [{ id: 'incineroar', share: 0.6, winRate: 0.56, games: 80 }],
      },
      {
        id: 'torkoal', usage: 0.07, winRate: 0.49, games: 100,
        moves: [['eruption', 0.9], ['protect', 0.7], ['heatwave', 0.6], ['solarbeam', 0.3]],
        items: [['charcoal', 0.4]], abilities: [['drought', 0.99]],
        spreads: [{ nature: 'Quiet', sp: { hp: 32, spa: 32, spd: 2 }, share: 0.6 }],
      },
      {
        id: 'hatterene', usage: 0.06, winRate: 0.5, games: 90,
        moves: [['trickroom', 0.95], ['expandingforce', 0.7], ['dazzlinggleam', 0.6], ['protect', 0.5]],
        items: [['focussash', 0.4]], abilities: [['magicbounce', 0.9]],
        spreads: [{ nature: 'Quiet', sp: { hp: 32, spa: 32, def: 2 }, share: 0.5 }],
      },
    ],
    [
      { members: ['incineroar', 'rillaboom'], usage: 0.2, winRate: 0.52, games: 300 },
      { members: ['incineroar', 'whimsicott'], usage: 0.12, winRate: 0.58, games: 150 },
      { members: ['kingambit', 'sneasler'], usage: 0.1, winRate: 0.53, games: 120 },
    ],
  );
}
