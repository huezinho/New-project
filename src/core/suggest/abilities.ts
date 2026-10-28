/**
 * Sugestão de habilidades: uso no meta + contexto da equipe (Intimidate que
 * falta, clima/terreno do arquétipo, imunidades que cobrem fraquezas...).
 */
import type { AbilitySuggestion, EngineContext } from '../api.ts';
import { detectArchetypes, fieldOf } from '../analysis.ts';
import { TYPE_PT } from '../i18n.ts';
import { toId } from '../id.ts';
import { rolesOfAbility } from '../roles.ts';
import { isDamaging } from '../team.ts';
import { ABILITY_TYPE_MODIFIERS } from '../typechart.ts';
import { clamp01, memo, pctPt } from '../util.ts';
import type { Team } from '../types.ts';
import { modeArchetypes, slotContext, squash } from './common.ts';

const WEATHER_SETTER: Record<string, string> = { drought: 'sun', drizzle: 'rain', sandstream: 'sand', snowwarning: 'snow' };
const WEATHER_ABUSER: Record<string, string> = {
  chlorophyll: 'sun', solarpower: 'sun', harvest: 'sun', leafguard: 'sun', flowergift: 'sun',
  swiftswim: 'rain', raindish: 'rain', dryskin: 'rain', hydration: 'rain',
  sandrush: 'sand', sandforce: 'sand', sandveil: 'sand',
  slushrush: 'snow', icebody: 'snow', snowcloak: 'snow',
};
const ARCH_WEATHER: Record<string, string> = { sun: 'Sun', rain: 'Rain', sand: 'Sand', snow: 'Snow' };
const WEATHER_PT: Record<string, string> = { sun: 'sol', rain: 'chuva', sand: 'areia', snow: 'neve' };
const SURGE: Record<string, string> = { psychicsurge: 'psychicterrain', grassysurge: 'grassyterrain', electricsurge: 'electricterrain', mistysurge: 'mistyterrain', seedsower: 'grassyterrain' };
const DOUBLES_BONUS: Record<string, [number, string]> = {
  friendguard: [0.25, 'Friend Guard reduz em 25% o dano recebido pelo parceiro.'],
  regenerator: [0.12, 'Regenerator recupera PS a cada troca.'],
  innerfocus: [0.15, 'Inner Focus ignora Intimidate e o hesitar do Fake Out.'],
  armortail: [0.25, 'Armor Tail bloqueia prioridade (inclusive Fake Out) contra a dupla.'],
  queenlymajesty: [0.25, 'Queenly Majesty bloqueia prioridade contra a dupla.'],
  goodasgold: [0.2, 'Good as Gold bloqueia golpes de status do oponente.'],
  magicbounce: [0.15, 'Magic Bounce reflete golpes de status.'],
  prankster: [0.15, 'Prankster dá prioridade a golpes de status.'],
  multiscale: [0.1, 'Multiscale reduz o dano com PS cheio.'],
  unburden: [0.08, 'Unburden dobra a Velocidade ao consumir o item.'],
};

/** Fração do meta (ponderada por uso) que usa Intimidate. */
function intimidatePressure(ctx: EngineContext): number {
  return memo(ctx, 'intimidatePressure', () => {
    const mons = Object.values(ctx.meta.pokemon ?? {}).sort((a, b) => b.usage - a.usage).slice(0, 30);
    const total = mons.reduce((s, p) => s + p.usage, 0);
    if (!total) return 0.4;
    const num = mons.reduce((s, p) => s + p.usage * (p.abilities?.find(a => a.id === 'intimidate')?.share ?? 0), 0);
    return clamp01((num / total) * 2.5);
  });
}

export function suggestAbilities(ctx: EngineContext, team: Team, slot: number): AbilitySuggestion[] {
  const sc = slotContext(ctx, team, slot);
  if (!sc) return [];
  const species = sc.member.species!;
  const options = ctx.dex.abilitiesOf(species);
  const usageOf = new Map((sc.meta?.abilities ?? []).map(a => [a.id, a.share]));
  const hasMeta = usageOf.size > 0;
  // Arquétipo dos parceiros: a habilidade deste membro é justamente o que está em escolha.
  const othersArch = detectArchetypes(ctx, sc.others);
  const othersField = fieldOf(othersArch);
  const modes = modeArchetypes(othersArch, 0.3);
  const weatherMode = modes.find(a => ARCH_WEATHER[a.def.id]);
  const terrainMode = modes.find(a => a.def.id.endsWith('terrain'));
  // Intimidate de verdade (a Mega ainda intimida ao entrar, antes de evoluir).
  const othersIntimidate = sc.others.filter(o => o.ability === 'intimidate' || toId(o.set.ability) === 'intimidate');
  const defensive = sc.state.analysis.defensive;
  const weakOthers = (type: string) => {
    const row = defensive.find(r => r.type === type);
    if (!row) return 0;
    return row.multipliers.filter((m, i) => i !== slot && sc.state.members[i]?.form && m > 1).length;
  };
  const statusMoves = sc.member.moves.filter(m => !isDamaging(m)).length;
  const megaForm = sc.member.isMega ? sc.member.form : undefined;
  const out: AbilitySuggestion[] = [];
  for (const ability of options) {
    const id = ability.id;
    const reasons: string[] = [];
    let value = ((ability.rating ?? 2) / 5) * 0.35;
    if (id === 'intimidate') {
      if (!othersIntimidate.length) {
        value += 0.45;
        reasons.push('A equipe não tem outro Intimidate: reduz o Ataque dos dois oponentes ao entrar.');
      } else {
        value += 0.15;
        reasons.push(`Segundo Intimidate (já há ${othersIntimidate.map(o => o.name).join(', ')}): ciclar Intimidate é forte.`);
      }
    }
    const setter = WEATHER_SETTER[id];
    if (setter) {
      if (weatherMode?.def.id === setter) {
        value += 0.5 * Math.max(0.5, weatherMode.confidence);
        reasons.push(`Ativa o ${WEATHER_PT[setter]} ao entrar, base do modo ${weatherMode.def.namePt} da equipe.`);
      } else if (weatherMode) {
        value -= 0.45 * weatherMode.confidence;
        reasons.push(`Conflita com o modo ${weatherMode.def.namePt} da equipe (clima diferente).`);
      } else {
        value += 0.2;
        reasons.push(`Ativa o ${WEATHER_PT[setter]} ao entrar e pode definir um modo de jogo.`);
      }
    }
    const abuser = WEATHER_ABUSER[id];
    if (abuser) {
      const active = othersField.weather === ARCH_WEATHER[abuser];
      if (active) {
        value += 0.45;
        reasons.push(`Aproveita o ${WEATHER_PT[abuser]} da equipe.`);
      } else {
        value -= 0.05;
        reasons.push(`Depende de ${WEATHER_PT[abuser]}, que a equipe não ativa.`);
      }
    }
    const surge = SURGE[id];
    if (surge) {
      if (terrainMode?.def.id === surge) {
        value += 0.45;
        reasons.push(`Ativa o terreno do modo ${terrainMode.def.namePt}.`);
      } else if (terrainMode) {
        value -= 0.3 * terrainMode.confidence;
        reasons.push(`Troca o terreno do modo ${terrainMode.def.namePt} da equipe.`);
      } else {
        value += 0.25;
        reasons.push('Ativa um terreno ao entrar.');
      }
    }
    for (const mod of ABILITY_TYPE_MODIFIERS[id] ?? []) {
      if (mod.mult !== 0) continue;
      const weak = weakOthers(mod.type);
      if (weak >= 2) {
        value += 0.3;
        reasons.push(`Imune a ${TYPE_PT[mod.type]}, fraqueza de ${weak} membros da equipe.`);
      } else {
        value += 0.08;
        reasons.push(`Imunidade a ${TYPE_PT[mod.type]}${mod.absorb ? ` (${mod.absorb})` : ''}.`);
      }
    }
    if (rolesOfAbility(ctx, id).some(e => e.role.id === 'redirection')) value += 0.1;
    if (rolesOfAbility(ctx, id).some(e => e.role.id === 'antiintimidate')) {
      const p = intimidatePressure(ctx);
      value += 0.1 + 0.25 * p;
      reasons.push(`Pune ou ignora Intimidate (pressão no meta: ${pctPt(p)}).`);
    }
    const bonus = DOUBLES_BONUS[id];
    if (bonus) {
      let v = bonus[0];
      if (id === 'prankster') v += statusMoves ? 0.15 : 0.05;
      value += v;
      reasons.push(bonus[1]);
    }
    if (id === 'telepathy' && sc.others.some(o => o.moves.some(mv => mv.target === 'allAdjacent' && isDamaging(mv)))) {
      value += 0.25;
      reasons.push('Telepathy evita o dano dos ataques em área do parceiro.');
    }
    if ((ability.rating ?? 2) <= 1) reasons.push('Habilidade de pouco impacto em batalha.');
    const usage = usageOf.get(id) ?? 0;
    if (usage >= 0.03) reasons.unshift(`Usada por ${pctPt(usage)} dos ${species.name} no meta.`);
    if (megaForm) {
      reasons.push(`Com a Mega Stone, vira ${ctx.dex.ability(megaForm.abilities['0'])?.name ?? megaForm.abilities['0']} ao Mega Evoluir; esta vale ao entrar em campo.`);
    }
    if (!reasons.length) reasons.push(ability.shortDesc);
    const raw = (hasMeta ? 0.9 * Math.min(1, usage / 0.6) : 0) + (hasMeta ? 0.6 : 1) * Math.max(0, value);
    out.push({ ability: ability.name, score: squash(raw, 0.6), usage, reasonsPt: reasons.slice(0, 4) });
  }
  return out.sort((a, b) => b.score - a.score || b.usage - a.usage);
}
