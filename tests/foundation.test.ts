import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMod, clean, DELETE, extractExports, extractTable } from '../scripts/lib/tsLiteral.ts';
import type { Dex } from '../src/core/types.ts';
import { calcStat, evsToSP, validateSP } from '../src/core/stats.ts';
import { exportTeam, parseTeam } from '../src/core/paste.ts';
import { toId } from '../src/core/id.ts';

describe('tsLiteral', () => {
  it('extrai literais e ignora funções', () => {
    const src = `export const Moves: import('x').T = {
      firelash: { inherit: true, basePower: 90, onHit(t) { return 1; }, flags: { contact: 1 }, volatileStatus: undefined },
      other: { name: "Other", accuracy: true, priority: -1, list: ['a', "b"] },
    };`;
    const table = extractTable(src);
    expect(table.firelash.basePower).toBe(90);
    expect(table.firelash.volatileStatus).toBe(DELETE);
    expect(clean(table.firelash)).toEqual({ inherit: true, basePower: 90, flags: { contact: 1 } });
    expect(table.other).toEqual({ name: 'Other', accuracy: true, priority: -1, list: ['a', 'b'] });
  });

  it('aplica mods com inherit (merge raso) e substituição', () => {
    const base = { a: { name: 'A', basePower: 80, volatileStatus: 'x' }, b: { name: 'B', tier: 'OU' } };
    const mod = { a: { inherit: true, basePower: 90, volatileStatus: DELETE }, b: { tier: 'Illegal' } };
    const out = applyMod(base, mod as never);
    expect(out.a).toEqual({ name: 'A', basePower: 90 });
    expect(out.b).toEqual({ tier: 'Illegal' });
  });

  it('lê arrays exportados (config/formats.ts)', () => {
    const out = extractExports(`export const Formats: X = [{ section: "S" }, { name: "[Gen 9 Champions] VGC 2026 Reg M-C", mod: 'champions' }];`);
    expect(Array.isArray(out.Formats)).toBe(true);
  });
});

describe('stats (Champions)', () => {
  it('usa a fórmula de Stat Points no nível 50', () => {
    // Incineroar: PS base 95 + 32 SP = 202 (igual a 252 EVs em SV)
    expect(calcStat(95, 32, 'hp')).toBe(202);
    // Velocidade base 100, 32 SP, natureza +Spe -> 167
    expect(calcStat(100, 32, 'spe', { name: 'Jolly', plus: 'spe', minus: 'spa' })).toBe(167);
    expect(calcStat(100, 0, 'spe', { name: 'Brave', plus: 'atk', minus: 'spe' })).toBe(108);
    expect(calcStat(1, 32, 'hp', undefined, 'shedinja')).toBe(1);
  });

  it('valida limites de SP', () => {
    expect(validateSP({ hp: 32, atk: 32, spe: 2 })).toEqual([]);
    expect(validateSP({ hp: 33 }).length).toBe(1);
    expect(validateSP({ hp: 32, atk: 32, spe: 32 }).length).toBe(1);
  });

  it('converte EVs para SP', () => {
    expect(evsToSP({ hp: 252, atk: 252, spe: 4 })).toEqual({ hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 1 });
  });
});

describe('paste', () => {
  it('importa e exporta no formato do Showdown', () => {
    const text = `Fofinho (Incineroar) (M) @ Sitrus Berry
Ability: Intimidate
Level: 50
EVs: 32 HP / 10 Def / 24 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Parting Shot
- Knock Off

Charizard @ Charizardite Y
Ability: Solar Power
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Heat Wave
- Solar Beam
- Protect
- Weather Ball`;
    const team = parseTeam(text);
    expect(team).toHaveLength(2);
    expect(team[0]).toMatchObject({ species: 'Incineroar', nickname: 'Fofinho', gender: 'M', item: 'Sitrus Berry', ability: 'Intimidate', nature: 'Careful' });
    expect(team[0].sp).toEqual({ hp: 32, atk: 0, def: 10, spa: 0, spd: 24, spe: 0 });
    expect(team[1].sp).toEqual({ hp: 0, atk: 0, def: 0, spa: 32, spd: 1, spe: 32 });
    const again = parseTeam(exportTeam(team));
    expect(again).toEqual(team.map(s => ({ ...s, level: 50 })));
  });

  it('gera ids no padrão do Showdown', () => {
    expect(toId('Charizard-Mega-Y')).toBe('charizardmegay');
    expect(toId("King's Rock")).toBe('kingsrock');
  });
});

describe('update-dex (mini checkout do Showdown)', () => {
  // Arquivos mínimos no formato do Showdown; o script real roda com SHOWDOWN_DIR apontando para eles.
  const mon = (name: string, extra = '') =>
    `{ num: 1, name: "${name}", types: ["Psychic"], baseStats: { hp: 74, atk: 48, def: 76, spa: 83, spd: 81, spe: 104 }, abilities: { 0: "Keen Eye" }, weightkg: 8.5, ${extra} }`;
  const move = (name: string, pp: number) =>
    `{ name: "${name}", type: "Normal", category: "Status", basePower: 0, accuracy: true, pp: ${pp}, priority: 0, target: "self", flags: {} }`;
  const files: Record<string, string> = {
    'config/formats.ts': `export const Formats: X = [{ name: "[Gen 9 Champions] VGC 2026 Reg M-C", mod: 'champions', gameType: 'doubles', ruleset: ['Flat Rules'] }];`,
    'data/pokedex.ts': `export const Pokedex: X = {
      espurr: ${mon('Espurr')},
      meowstic: ${mon('Meowstic', 'prevo: "Espurr"')},
      meowsticf: ${mon('Meowstic-F', 'baseSpecies: "Meowstic", forme: "F", prevo: "Espurr"')},
      meowsticmmega: ${mon('Meowstic-M-Mega', 'baseSpecies: "Meowstic", forme: "M-Mega", requiredItem: "Meowsticite", battleOnly: "Meowstic"')},
      meowsticfmega: ${mon('Meowstic-F-Mega', 'baseSpecies: "Meowstic", forme: "F-Mega", requiredItem: "Meowsticite", battleOnly: "Meowstic-F"')},
      calyrex: ${mon('Calyrex', 'tags: ["Restricted Legendary"]')},
      calyrexshadow: ${mon('Calyrex-Shadow', 'baseSpecies: "Calyrex", forme: "Shadow"')},
      vivillon: ${mon('Vivillon')},
      vivillonpolar: { isCosmeticForme: true, name: "Vivillon-Polar", baseSpecies: "Vivillon", forme: "Polar" },
    };`,
    'data/formats-data.ts': `export const FormatsData: X = {};`,
    'data/mods/champions/scripts.ts': `export const Scripts: X = { gen: 9, init() { return 1; } };`,
    'data/mods/champions/formats-data.ts': `export const FormatsData: X = {
      espurr: { isNonstandard: "Past", tier: "Illegal" }, meowstic: { tier: "RU" }, meowsticmmega: { tier: "RU" }, meowsticfmega: { tier: "RU" },
      calyrex: { tier: "Uber" }, calyrexshadow: { tier: "Uber" }, vivillon: { tier: "RU" },
    };`,
    'data/moves.ts': `export const Moves: X = { protect: ${move('Protect', 10)}, psychic: ${move('Psychic', 10)}, quickattack: ${move('Quick Attack', 30)}, fakeout: ${move('Fake Out', 10)} };`,
    'data/mods/champions/moves.ts': `export const Moves: X = { protect: { inherit: true, pp: 5 } };`,
    'data/learnsets.ts': `export const Learnsets: X = {
      espurr: { learnset: { fakeout: ["9E"], psychic: ["9M"] } },
      meowstic: { learnset: { psychic: ["9M"], protect: ["9M"] } }, meowsticf: { learnset: { psychic: ["9M"] } },
      calyrex: { learnset: { psychic: ["9M"] } }, vivillon: { learnset: { protect: ["9M"] } },
    };`,
    'data/mods/champions/learnsets.ts': `export const Learnsets: X = {
      meowstic: { learnset: { psychic: ["9M"], protect: ["9M"], quickattack: ["9M"] } }, meowsticf: { learnset: { psychic: ["9M"], protect: ["9M"] } },
    };`,
    'data/items.ts': `export const Items: X = { meowsticite: { name: "Meowsticite", megaStone: { "Meowstic": "Meowstic-M-Mega", "Meowstic-F": "Meowstic-F-Mega" } } };`,
    'data/abilities.ts': `export const Abilities: X = { keeneye: { name: "Keen Eye", rating: 0 } };`,
    'data/typechart.ts': `export const TypeChart: X = { psychic: { damageTaken: { Dark: 3, Bug: 1, Ghost: 1, Fighting: 2, Psychic: 2 } } };`,
  };

  it('segue as regras do Showdown para formas, Megas, learnsets e PP do Champions', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'update-dex-'));
    try {
      const sd = join(tmp, 'showdown');
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(sd, path)), { recursive: true });
        writeFileSync(join(sd, path), text);
      }
      const out = join(tmp, 'out');
      mkdirSync(out);
      execFileSync(resolve('node_modules/.bin/tsx'), [resolve('scripts/update-dex.ts')], { cwd: out, env: { ...process.env, SHOWDOWN_DIR: sd }, stdio: 'pipe' });
      const dex = JSON.parse(readFileSync(join(out, 'public', 'data', 'dex.json'), 'utf8')) as Dex;
      // Forma sem entrada própria em formats-data herda o tier da base (Meowstic-F).
      expect(dex.species.meowsticf?.legal['M-C']).toBe(true);
      // "M-Mega"/"F-Mega" também são Megas, ligadas à forma certa pela pedra.
      expect(dex.species.meowsticmmega.isMega).toBe(true);
      expect(dex.species.meowsticfmega.isMega).toBe(true);
      expect(dex.species.meowstic.megas).toEqual([{ id: 'meowsticmmega', item: 'Meowsticite' }]);
      expect(dex.species.meowsticf.megas).toEqual([{ id: 'meowsticfmega', item: 'Meowsticite' }]);
      // No Champions não se herdam golpes da pré-evolução (Fake Out de Espurr).
      expect(dex.species.meowstic.learnset).toEqual(['protect', 'psychic', 'quickattack']);
      expect(dex.species.meowsticf.learnset).toEqual(['protect', 'psychic']);
      // Flat Rules: a forma herda a tag Restricted Legendary da base; forma cosmética fica de fora.
      expect(dex.species.calyrex).toBeUndefined();
      expect(dex.species.calyrexshadow).toBeUndefined();
      expect(dex.species.vivillon).toBeDefined();
      expect(dex.species.vivillonpolar).toBeUndefined();
      // PP: teto de 20 do Champions entra na lista de mudanças.
      const pp = Object.fromEntries(dex.changes.filter(c => c.field === 'pp').map(c => [c.id, [c.from, c.to, c.direction]]));
      expect(pp.quickattack).toEqual([30, 20, 'nerf']);
      expect(pp.protect).toEqual([10, 5, 'nerf']);
      expect(dex.moves.quickattack.pp).toBe(20);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('dex: formas cosméticas', () => {
  it('formas idênticas à base ficam legais, mas fora do seletor', async () => {
    const { readFileSync } = await import('node:fs');
    const { DexAccess } = await import('../src/core/dex.ts');
    const data = JSON.parse(readFileSync('public/data/dex.json', 'utf8'));
    const dex = new DexAccess(data);
    const dup = Object.values(dex.data.species).find(s => s.duplicateOf);
    if (!dup) return; // nenhuma forma duplicada nesta versão dos dados
    expect(dex.isLegal(dup)).toBe(true);
    expect(dex.selectableSpecies().some(s => s.id === dup.id)).toBe(false);
    expect(dex.selectableSpecies().some(s => s.id === dup.duplicateOf)).toBe(true);
  });
});
