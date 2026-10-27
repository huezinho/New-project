import { describe, expect, it } from 'vitest';
import { applyMod, clean, DELETE, extractExports, extractTable } from '../scripts/lib/tsLiteral.ts';
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
