/**
 * Completa a equipe até 6 membros: primeiro preenche campos vazios de quem já
 * está na equipe (sem mexer nas escolhas do usuário; golpes faltando até 4
 * são completados) e depois adiciona, um a
 * um, a melhor sugestão com set montado — respeitando Item Clause e no máximo
 * duas Mega Stones.
 */
import type { EngineContext } from '../api.ts';
import { toId } from '../id.ts';
import { emptySP, totalSP } from '../stats.ts';
import type { PokemonSet, Team } from '../types.ts';
import { buildSet } from './build.ts';
import { suggestItems } from './items.ts';
import { suggestPokemon } from './pokemon.ts';

const MAX_MEGAS = 2;

function isStone(ctx: EngineContext, item: string | undefined): boolean {
  return !!ctx.dex.item(item)?.megaStone;
}

function copySet(set: PokemonSet): PokemonSet {
  return { ...set, sp: { ...emptySP(), ...(set.sp ?? {}) }, moves: [...(set.moves ?? [])].filter(Boolean) };
}

/** Garante item único e limite de Megas para o set no fim da equipe. */
function fixItem(ctx: EngineContext, team: Team, slot: number): void {
  const set = team[slot];
  const others = team.filter((_, i) => i !== slot);
  const taken = new Set(others.map(o => toId(o.item)).filter(Boolean));
  const megas = others.filter(o => isStone(ctx, o.item)).length;
  const bad = (item: string | undefined) => !!item && (taken.has(toId(item)) || (isStone(ctx, item) && megas >= MAX_MEGAS));
  if (!bad(set.item)) return;
  const alt = suggestItems(ctx, team, slot).find(i => !i.blocked && !bad(i.item));
  if (alt) set.item = alt.item;
  else delete set.item;
}

export function autoComplete(ctx: EngineContext, team: Team): Team {
  const out: Team = (team ?? []).filter(s => s && s.species).slice(0, 6).map(copySet);
  // 1) Completa campos vazios dos membros atuais (o set é montado em volta do que o usuário escolheu:
  //    a Mega Stone dele define a forma, os golpes dele ficam e só os slots livres são completados).
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (!ctx.dex.species(s.species)) continue;
    const fewMoves = s.moves.length < 4;
    const noSP = totalSP(s.sp) === 0;
    if (!fewMoves && s.item && s.ability && s.nature && !noSP) continue;
    const others = out.filter((_, j) => j !== i);
    const built = buildSet(ctx, others, s.species, {
      item: s.item,
      ability: s.ability,
      nature: s.nature,
      sp: noSP ? undefined : s.sp,
      moves: s.moves,
    });
    if (fewMoves) s.moves = built.moves.length >= s.moves.length ? built.moves : s.moves;
    if (!s.ability && built.ability) s.ability = built.ability;
    if (!s.item && built.item) {
      s.item = built.item;
      fixItem(ctx, out, i);
    }
    if (!s.nature && built.nature) s.nature = built.nature;
    if (noSP) s.sp = { ...built.sp };
  }
  // 2) Adiciona as melhores sugestões até 6 membros.
  let guard = 0;
  while (out.length < 6 && guard++ < 6) {
    const options = suggestPokemon(ctx, out, 2);
    const pick = options[0];
    if (!pick) break;
    out.push(copySet(pick.set));
    fixItem(ctx, out, out.length - 1);
  }
  return out;
}
