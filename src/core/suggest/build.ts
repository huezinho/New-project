/**
 * Monta um set completo (habilidade, item, golpes, natureza e SP) para uma
 * espécie no contexto da equipe, encadeando as sugestões de cada parte.
 * Campos "travados" (escolhas do usuário ou a Mega Stone que a sugestão
 * assumiu) são mantidos e o resto é montado em volta deles.
 */
import type { EngineContext, SpreadSuggestion } from '../api.ts';
import { toId } from '../id.ts';
import { emptySP, totalSP } from '../stats.ts';
import { defaultAbility, defaultSpread, megaOptions, natureOf } from '../team.ts';
import type { PokemonSet, StatsTable, Team } from '../types.ts';
import { suggestAbilities } from './abilities.ts';
import { bestItem, suggestItems } from './items.ts';
import { rankMoves } from './moves.ts';
import { suggestSpreads } from './spreads.ts';

export interface SetLocks {
  item?: string;
  ability?: string;
  nature?: string;
  /** SP já distribuídos (ignorado se o total for 0). */
  sp?: Partial<StatsTable>;
  /** Golpes já escolhidos: são mantidos e só os slots vazios são completados. */
  moves?: string[];
  /** Sem Mega Stone: a sugestão foi avaliada na forma comum. */
  noMega?: boolean;
}

/** Natureza compatível com SP já distribuídos: não reduz um atributo com investimento. */
function natureForSP(ctx: EngineContext, spreads: SpreadSuggestion[], sp: StatsTable): string | undefined {
  for (const s of spreads) {
    const minus = natureOf(ctx, s.nature)?.minus;
    if (!minus || sp[minus] <= 4) return s.nature;
  }
  return spreads[0]?.nature;
}

export function buildSet(ctx: EngineContext, team: Team, speciesName: string, locks: SetLocks = {}): PokemonSet {
  const raw = ctx.dex.species(speciesName);
  if (!raw) return { species: speciesName, sp: emptySP(), moves: [] };
  // Formas Mega/de batalha: monta a forma escolhível com a Mega Stone correspondente.
  let species = raw;
  let forcedItem: string | undefined;
  if (raw.isMega) {
    species = ctx.dex.baseOf(raw);
    forcedItem = megaOptions(ctx, species).find(o => o.form.id === raw.id)?.item.name ?? raw.requiredItem;
  } else if (raw.battleOnly) {
    const base = Array.isArray(raw.battleOnly) ? raw.battleOnly[0] : raw.battleOnly;
    species = ctx.dex.species(base) ?? raw;
  }
  const others = (team ?? [])
    .filter(s => {
      const sp = ctx.dex.species(s?.species);
      return !!s?.species && !(sp && ctx.dex.baseOf(sp).num === species.num);
    })
    .slice(0, 5);
  const slot = others.length;
  const lockedSP = locks.sp && totalSP(locks.sp) > 0 ? { ...emptySP(), ...locks.sp } : undefined;
  const keep = (locks.moves ?? []).filter(m => typeof m === 'string' && m.trim()).slice(0, 4);
  const draft: PokemonSet = { species: species.name, sp: lockedSP ? { ...lockedSP } : emptySP(), moves: [...keep] };
  if (locks.nature) draft.nature = locks.nature;
  const taken = new Set(others.map(o => toId(o.item)).filter(Boolean));
  if (locks.item) draft.item = locks.item;
  else if (forcedItem && !taken.has(toId(forcedItem))) draft.item = forcedItem;
  if (locks.ability) draft.ability = locks.ability;
  const teamOf = (): Team => [...others, { ...draft, moves: [...draft.moves], sp: { ...draft.sp } }];

  if (!locks.ability) draft.ability = suggestAbilities(ctx, teamOf(), slot)[0]?.ability ?? defaultAbility(ctx, species);
  const itemLocked = !!draft.item;
  const pickItem = () =>
    locks.noMega ? suggestItems(ctx, teamOf(), slot).find(i => !i.blocked && !ctx.dex.item(i.item)?.megaStone)?.item : bestItem(ctx, teamOf(), slot);
  if (!itemLocked) draft.item = pickItem();
  const pickMoves = (): string[] => {
    if (keep.length >= 4) return keep;
    const ids = new Set(keep.map(toId));
    const extra = rankMoves(ctx, teamOf(), slot, keep).recommended.filter(m => !ids.has(toId(m)));
    return [...keep, ...extra].slice(0, 4);
  };
  draft.moves = pickMoves();
  if (!itemLocked) {
    // Com os golpes definidos o melhor item pode mudar (Light Clay, White Herb, Choice Scarf...).
    const item = pickItem();
    if (item && item !== draft.item) {
      draft.item = item;
      draft.moves = pickMoves();
    }
  }
  if (!locks.ability) {
    const ability = suggestAbilities(ctx, teamOf(), slot)[0]?.ability;
    if (ability) draft.ability = ability;
  }
  if (!lockedSP || !locks.nature) {
    const spreads = suggestSpreads(ctx, teamOf(), slot);
    if (lockedSP) {
      draft.nature = natureForSP(ctx, spreads, lockedSP) ?? draft.nature;
    } else {
      // Natureza escolhida: o primeiro spread com ela; senão o melhor spread com a natureza do usuário.
      const spread = (locks.nature ? spreads.find(s => toId(s.nature) === toId(locks.nature)) : undefined) ?? spreads[0];
      if (spread) {
        if (!locks.nature) draft.nature = spread.nature;
        draft.sp = { ...spread.sp };
      } else {
        const form = ctx.dex.battleForm(draft) ?? species;
        const def = defaultSpread(form);
        if (!locks.nature) draft.nature = def.nature;
        draft.sp = def.sp;
      }
    }
  }
  // Com natureza e SP definidos, golpes do atributo reduzido (Heat Wave num Jolly) perdem valor: refaz os slots livres.
  if (keep.length < 4) draft.moves = pickMoves();
  if (!draft.item) delete draft.item;
  if (!draft.nature) delete draft.nature;
  return draft;
}
