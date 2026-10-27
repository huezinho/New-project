import type { MoveCategory, StatId, TypeName } from './types.ts';

/** Nomes oficiais dos tipos em português do Brasil. */
export const TYPE_PT: Record<TypeName, string> = {
  Normal: 'Normal',
  Fire: 'Fogo',
  Water: 'Água',
  Electric: 'Elétrico',
  Grass: 'Planta',
  Ice: 'Gelo',
  Fighting: 'Lutador',
  Poison: 'Venenoso',
  Ground: 'Terrestre',
  Flying: 'Voador',
  Psychic: 'Psíquico',
  Bug: 'Inseto',
  Rock: 'Pedra',
  Ghost: 'Fantasma',
  Dragon: 'Dragão',
  Dark: 'Sombrio',
  Steel: 'Aço',
  Fairy: 'Fada',
};

export const TYPE_COLORS: Record<TypeName, string> = {
  Normal: '#9fa19f',
  Fire: '#e62829',
  Water: '#2980ef',
  Electric: '#fac000',
  Grass: '#3fa129',
  Ice: '#3dcef3',
  Fighting: '#ff8000',
  Poison: '#9141cb',
  Ground: '#915121',
  Flying: '#81b9ef',
  Psychic: '#ef4179',
  Bug: '#91a119',
  Rock: '#afa981',
  Ghost: '#704170',
  Dragon: '#5060e1',
  Dark: '#624d4e',
  Steel: '#60a1b8',
  Fairy: '#ef70ef',
};

export const STAT_PT: Record<StatId, string> = {
  hp: 'PS',
  atk: 'Ataque',
  def: 'Defesa',
  spa: 'At. Esp.',
  spd: 'Def. Esp.',
  spe: 'Velocidade',
};

export const STAT_SHORT: Record<StatId, string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

export const CATEGORY_PT: Record<MoveCategory, string> = {
  Physical: 'Físico',
  Special: 'Especial',
  Status: 'Status',
};

export const NATURE_PT: Record<string, string> = {
  Adamant: 'Adamant (+Atk −SpA)',
  Bashful: 'Bashful (neutra)',
  Bold: 'Bold (+Def −Atk)',
  Brave: 'Brave (+Atk −Spe)',
  Calm: 'Calm (+SpD −Atk)',
  Careful: 'Careful (+SpD −SpA)',
  Docile: 'Docile (neutra)',
  Gentle: 'Gentle (+SpD −Def)',
  Hardy: 'Hardy (neutra)',
  Hasty: 'Hasty (+Spe −Def)',
  Impish: 'Impish (+Def −SpA)',
  Jolly: 'Jolly (+Spe −SpA)',
  Lax: 'Lax (+Def −SpD)',
  Lonely: 'Lonely (+Atk −Def)',
  Mild: 'Mild (+SpA −Def)',
  Modest: 'Modest (+SpA −Atk)',
  Naive: 'Naive (+Spe −SpD)',
  Naughty: 'Naughty (+Atk −SpD)',
  Quiet: 'Quiet (+SpA −Spe)',
  Quirky: 'Quirky (neutra)',
  Rash: 'Rash (+SpA −SpD)',
  Relaxed: 'Relaxed (+Def −Spe)',
  Sassy: 'Sassy (+SpD −Spe)',
  Serious: 'Serious (neutra)',
  Timid: 'Timid (+Spe −Atk)',
};

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits).replace('.', ',')}%`;
}
