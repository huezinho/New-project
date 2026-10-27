/**
 * Sugestão de itens: uso no meta + contexto (perfil do Pokémon, golpes,
 * fraquezas, clima/terreno da equipe). Respeita a Item Clause (item de outro
 * membro fica bloqueado), só itens legais e Mega Stones da própria espécie.
 */
import type { EngineContext, ItemSuggestion } from '../api.ts';
import { TYPE_PT } from '../i18n.ts';
import { calcStat } from '../stats.ts';
import { defenseMult, isDamaging, megaOptions, metaThreats, type Member } from '../team.ts';
import { clamp01, memo, num, pctPt } from '../util.ts';
import type { ItemData, Team, TypeName } from '../types.ts';
import { archetypeById, memberFeatures, modeArchetypes, squash, slotContext, type MemberFeatures, type SlotContext } from './common.ts';

export const RESIST_BERRY: Record<string, TypeName> = {
  occaberry: 'Fire', passhoberry: 'Water', wacanberry: 'Electric', rindoberry: 'Grass', yacheberry: 'Ice', chopleberry: 'Fighting',
  kebiaberry: 'Poison', shucaberry: 'Ground', cobaberry: 'Flying', payapaberry: 'Psychic', tangaberry: 'Bug', chartiberry: 'Rock',
  kasibberry: 'Ghost', habanberry: 'Dragon', colburberry: 'Dark', babiriberry: 'Steel', roseliberry: 'Fairy', chilanberry: 'Normal',
};
export const TYPE_BOOST_ITEM: Record<string, TypeName> = {
  charcoal: 'Fire', mysticwater: 'Water', magnet: 'Electric', miracleseed: 'Grass', nevermeltice: 'Ice', blackbelt: 'Fighting',
  poisonbarb: 'Poison', softsand: 'Ground', sharpbeak: 'Flying', twistedspoon: 'Psychic', silverpowder: 'Bug', hardstone: 'Rock',
  spelltag: 'Ghost', dragonfang: 'Dragon', blackglasses: 'Dark', metalcoat: 'Steel', fairyfeather: 'Fairy', silkscarf: 'Normal',
};
const WEATHER_ROCK: Record<string, { ability: string; move: string; label: string }> = {
  heatrock: { ability: 'drought', move: 'sunnyday', label: 'sol' },
  damprock: { ability: 'drizzle', move: 'raindance', label: 'chuva' },
  smoothrock: { ability: 'sandstream', move: 'sandstorm', label: 'areia' },
  icyrock: { ability: 'snowwarning', move: 'snowscape', label: 'neve' },
};
const SEED_TERRAIN: Record<string, 'Electric' | 'Grassy' | 'Psychic' | 'Misty'> = {
  electricseed: 'Electric', grassyseed: 'Grassy', psychicseed: 'Psychic', mistyseed: 'Misty',
};
const SURGE_TERRAIN: Record<string, string> = {
  electricsurge: 'Electric', grassysurge: 'Grassy', psychicsurge: 'Psychic', mistysurge: 'Misty', seedsower: 'Grassy',
};
const SELF_DROP = new Set(['closecombat', 'makeitrain', 'dracometeor', 'overheat', 'leafstorm', 'superpower', 'armorcannon', 'headlongrush', 'shellsmash']);
const CONSUMABLE = (item: ItemData) => !!item.isBerry || item.id.endsWith('seed') || item.id === 'whiteherb' || item.id === 'mentalherb' || item.id === 'focussash' || item.id === 'airballoon';

interface ItemEval {
  value: number;
  reasons: string[];
}

/** Pressão de cada tipo de ataque entre as ameaças do meta (0-1). */
function typePressure(ctx: EngineContext): Map<TypeName, number> {
  return memo(ctx, 'typePressure', () => {
    const out = new Map<TypeName, number>();
    const threats = metaThreats(ctx, 20);
    const total = threats.reduce((s, t) => s + t.meta.usage, 0);
    if (!total) return out;
    for (const t of threats) for (const type of t.attackTypes) out.set(type, (out.get(type) ?? 0) + t.meta.usage / total);
    return out;
  });
}

function megaEval(ctx: EngineContext, sc: SlotContext, item: ItemData, f: MemberFeatures): ItemEval | null {
  const option = megaOptions(ctx, sc.member.species).find(o => o.item.id === item.id);
  if (!option) return null;
  const { form } = option;
  const reasons: string[] = [];
  const others = sc.otherMegas.length;
  let value = others === 0 ? 0.85 : others === 1 ? 0.4 : 0.02;
  const ability = ctx.dex.ability(form.abilities['0']);
  const stat = form.baseStats.atk >= form.baseStats.spa ? `Ataque base ${form.baseStats.atk}` : `At. Esp. base ${form.baseStats.spa}`;
  reasons.push(`Mega Evolui em ${form.name} (${form.types.map(t => TYPE_PT[t]).join('/')}, ${ability?.name ?? form.abilities['0']}, ${stat}).`);
  // Mega física com golpes especiais (ou o contrário) rende menos.
  const megaPhysical = form.baseStats.atk >= form.baseStats.spa;
  if (f.damaging.length && ((megaPhysical && !f.physical) || (!megaPhysical && !f.special))) {
    value -= 0.3;
    reasons.push('A Mega favorece a outra categoria de ataque do set atual.');
  }
  value += 0.05 * ((ability?.rating ?? 3) - 3);
  // Clima da Mega combinando (ou não) com a equipe.
  const weatherAbility: Record<string, string> = { drought: 'sun', drizzle: 'rain', sandstream: 'sand', snowwarning: 'snow' };
  const arch = weatherAbility[ability?.id ?? ''];
  if (arch) {
    const mode = modeArchetypes(sc.archetypes).find(a => ['sun', 'rain', 'sand', 'snow'].includes(a.def.id));
    if (mode && mode.def.id === arch) value += 0.15;
    else if (mode) {
      value -= 0.3;
      reasons.push(`${ability?.name} conflita com o modo ${mode.def.namePt} da equipe.`);
    }
  }
  if (others === 1) reasons.push(`Já há uma Mega Stone (${sc.otherMegas[0].name}): só uma Mega Evolução por batalha, decida no preview.`);
  if (others >= 2) reasons.push(`Já há ${others} Mega Stones na equipe: só um Pokémon Mega Evolui por batalha.`);
  return { value, reasons };
}

function contextEval(ctx: EngineContext, sc: SlotContext, item: ItemData, f: MemberFeatures): ItemEval {
  const m: Member = sc.member;
  const id = item.id;
  const reasons: string[] = [];
  const hint = ctx.heuristics.itemHeuristics?.find(h => h.item === id)?.whenPt;
  const moves = m.moves;
  const moveIds = m.moveIds;
  const trick = archetypeById(modeArchetypes(sc.archetypes), 'trickroom');
  let value = 0.04;
  const say = (text: string | undefined) => {
    if (text) reasons.push(text);
  };
  switch (id) {
    case 'sitrusberry':
      value = 0.25 + 0.3 * clamp01((m.form!.baseStats.hp + m.form!.baseStats.def + m.form!.baseStats.spd - 200) / 150) + (f.support ? 0.1 : 0);
      say(hint);
      break;
    case 'lumberry':
      value = 0.22 + (moveIds.has('trickroom') || moveIds.has('tailwind') ? 0.12 : 0) + (f.attacker ? 0.05 : 0);
      say(hint);
      break;
    case 'focussash':
      value = f.frail ? 0.42 + (f.support ? 0.08 : 0) + (moveIds.has('trickroom') ? 0.12 : 0) : 0.08;
      say(f.frail ? hint : 'Pouco útil em quem já é resistente.');
      break;
    case 'lifeorb':
      value = f.attacker ? 0.42 + (f.damaging.length >= 3 ? 0.06 : 0) - (f.bulky ? 0.08 : 0) : 0.06;
      say(f.attacker ? hint : undefined);
      break;
    case 'choicescarf': {
      const status = f.status.filter(s => s.id !== 'trick' && s.id !== 'switcheroo').length;
      const spe = f.baseSpe;
      value = f.attacker ? (spe >= 70 && spe <= 105 ? 0.52 : spe > 105 ? 0.3 : 0.15) : 0.04;
      value -= 0.22 * status;
      if (trick) value *= 0.2;
      const scarfSpeed = Math.floor(calcStat(spe, 32, 'spe', { name: 'Jolly', plus: 'spe', minus: 'spa' }) * 1.5);
      const passed = metaThreats(ctx, 30).filter(t => !t.scarf && t.speed < scarfSpeed).length;
      const total = metaThreats(ctx, 30).length;
      say(total ? `Velocidade ×1,5 (até ${scarfSpeed}): passa ${passed} das ${total} ameaças mais usadas sem Tailwind.` : hint);
      if (status) say('Status no set perde valor: Choice Scarf prende em um golpe.');
      if (trick) say('Conflita com o Trick Room da equipe.');
      break;
    }
    case 'rockyhelmet':
      value = m.form!.baseStats.def >= 100 && m.form!.baseStats.hp >= 70 ? 0.36 : 0.1;
      say(hint);
      break;
    case 'leftovers':
      value = f.bulky ? 0.26 : 0.1;
      say(hint);
      break;
    case 'wiseglasses':
      value = f.special && f.attacker ? 0.36 : 0.03;
      say(f.special ? hint : undefined);
      break;
    case 'muscleband':
      value = f.physical && f.attacker ? 0.36 : 0.03;
      say(f.physical ? hint : undefined);
      break;
    case 'expertbelt': {
      const types = new Set(f.damaging.map(x => x.type));
      value = f.attacker && types.size >= 3 ? 0.34 : f.attacker ? 0.2 : 0.03;
      say(hint);
      break;
    }
    case 'lightclay':
      value = moveIds.has('reflect') || moveIds.has('lightscreen') || moveIds.has('auroraveil') ? 0.7 : 0;
      say(value ? hint : undefined);
      break;
    case 'mentalherb':
      value = moveIds.has('trickroom') || moveIds.has('tailwind') ? 0.38 : f.support ? 0.14 : 0.03;
      say(hint);
      break;
    case 'whiteherb': {
      const drop = moves.find(x => SELF_DROP.has(x.id));
      value = drop ? 0.46 : 0.08;
      say(drop ? `Restaura os atributos após ${drop.name}.` : hint);
      break;
    }
    case 'airballoon': {
      const mult = defenseMult(ctx, m, 'Ground');
      value = mult >= 4 ? 0.4 : mult >= 2 ? 0.28 : 0;
      say(value ? hint : undefined);
      break;
    }
    case 'ejectbutton':
      value = moveIds.has('uturn') || moveIds.has('partingshot') || f.support ? 0.14 : 0.04;
      break;
    case 'scopelens':
      value = moves.some(x => (x.effects?.critRatio ?? 1) >= 2) || m.ability === 'superluck' ? 0.3 : 0.03;
      break;
    case 'widelens':
      value = moves.some(x => isDamaging(x) && x.accuracy !== true && x.accuracy < 90) ? 0.24 : 0.03;
      break;
    case 'lightball':
      value = m.species?.id === 'pikachu' ? 0.85 : 0;
      break;
    case 'leek':
      value = m.species?.id === 'farfetchd' || m.species?.id === 'sirfetchd' ? 0.7 : 0;
      break;
    case 'terrainextender':
      value = SURGE_TERRAIN[m.ability] || moves.some(x => x.effects?.terrain) ? 0.4 : 0;
      say(value ? hint : undefined);
      break;
    default:
      break;
  }
  // Pedras de clima
  const rock = WEATHER_ROCK[id];
  if (rock) {
    value = m.ability === rock.ability ? 0.45 : moveIds.has(rock.move) ? 0.38 : 0;
    if (value) say(`Setter de ${rock.label}: o clima dura 8 turnos.`);
  }
  // Sementes de terreno
  const seed = SEED_TERRAIN[id];
  if (seed) {
    const ownTerrain = SURGE_TERRAIN[m.ability];
    const teamTerrain = sc.field.terrain ?? (sc.others.map(o => SURGE_TERRAIN[o.ability]).find(Boolean) as string | undefined);
    value = teamTerrain === seed || ownTerrain === seed ? 0.42 : 0;
    if (value) say(hint ?? `Aproveita o ${seed} Terrain da equipe.`);
  }
  // Frutas de resistência
  const resisted = RESIST_BERRY[id];
  if (resisted) {
    const mult = defenseMult(ctx, m, resisted);
    const pressure = typePressure(ctx).get(resisted) ?? 0.3;
    if (mult >= 2 || resisted === 'Normal') {
      value = (resisted === 'Normal' ? 0.05 : 0.22 + (mult >= 4 ? 0.2 : 0)) + 0.3 * clamp01(pressure);
      if (resisted !== 'Normal') say(`Reduz pela metade um golpe super efetivo de ${TYPE_PT[resisted]} (fraqueza ${num(mult, 0)}×, ${pctPt(pressure)} das ameaças usam).`);
    } else {
      value = 0;
    }
  }
  // Itens que fortalecem um tipo
  const boosted = TYPE_BOOST_ITEM[id];
  if (boosted) {
    const main = f.damaging.filter(x => x.type === boosted).length;
    value = main ? 0.2 + (m.types.includes(boosted) ? 0.08 : 0) + (f.attacker ? 0.04 : 0) : 0;
    if (value) say(`Golpes de ${TYPE_PT[boosted]} ×1,2 sem ficar preso a um golpe.`);
  }
  // Unburden aproveita itens consumíveis
  if (m.ability === 'unburden' && CONSUMABLE(item) && value > 0.02) {
    value += 0.22;
    say('Unburden: ao consumir o item, a Velocidade dobra.');
  }
  return { value: clamp01(value), reasons };
}

export function suggestItems(ctx: EngineContext, team: Team, slot: number): ItemSuggestion[] {
  const sc = slotContext(ctx, team, slot);
  if (!sc) return [];
  const f = memberFeatures(sc.member);
  const reg = ctx.dex.regulation;
  const usageOf = new Map((sc.meta?.items ?? []).map(i => [i.id, i.share]));
  const hasItemMeta = usageOf.size > 0;
  const speciesName = sc.member.species!.name;
  const out: ItemSuggestion[] = [];
  for (const item of ctx.dex.legalItems()) {
    if (!item.legal[reg]) continue;
    let evalResult: ItemEval;
    if (item.megaStone) {
      const mega = megaEval(ctx, sc, item, f);
      if (!mega) continue;
      evalResult = mega;
    } else {
      evalResult = contextEval(ctx, sc, item, f);
    }
    const usage = usageOf.get(item.id) ?? 0;
    // Mega Stone vale menos quando a equipe já tem outras (só uma Mega por batalha).
    const usageFactor = item.megaStone ? [1, 0.6, 0.05][Math.min(2, sc.otherMegas.length)] : 1;
    const raw = (hasItemMeta ? 0.9 * Math.min(1, usage / 0.5) * usageFactor : 0) + (hasItemMeta ? 0.6 : 1) * evalResult.value;
    if (raw < 0.05 && usage < 0.02) continue;
    const holder = sc.otherItems.get(item.id);
    const reasons = [...evalResult.reasons];
    if (usage >= 0.03) reasons.unshift(`Usado por ${pctPt(usage)} dos ${speciesName} no meta.`);
    if (holder) reasons.unshift(`Já está com ${holder.name}: a Item Clause proíbe itens repetidos.`);
    out.push({ item: item.name, score: squash(raw, 0.7), usage, reasonsPt: reasons.slice(0, 4), blocked: !!holder });
  }
  return out.sort((a, b) => b.score - a.score || b.usage - a.usage).slice(0, 20);
}

/** Melhor item não bloqueado (Item Clause) para o slot. */
export function bestItem(ctx: EngineContext, team: Team, slot: number): string | undefined {
  return suggestItems(ctx, team, slot).find(i => !i.blocked)?.item;
}
