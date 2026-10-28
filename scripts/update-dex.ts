/**
 * Gera public/data/dex.json a partir dos dados oficiais do Pokémon Showdown
 * para Pokémon Champions (mod "champions" = regulação atual e mods de
 * regulações anteriores, ex. "championsregmb").
 *
 * Uso:
 *   npm run update:dex                       # baixa do GitHub (branch master)
 *   SHOWDOWN_DIR=../pokemon-showdown npm run update:dex   # usa checkout local
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createShowdownSource, resolveGithubCommit, type ShowdownSource } from './lib/showdownSource.ts';
import { applyMod, clean, extractExports, extractTable, type Literal, type LiteralTable } from './lib/tsLiteral.ts';
import { toId } from '../src/core/id.ts';
import type {
  AbilityData, DataChange, Dex, FormatInfo, ItemData, MoveData, MoveEffects, NatureData, SpeciesData, StatId, TypeName,
} from '../src/core/types.ts';

type Entry = Record<string, Literal>;

const TYPES: TypeName[] = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
];
const SPREAD_TARGETS = new Set(['allAdjacentFoes', 'allAdjacent']);
const FORMAT_RE = /^\[Gen 9 Champions\] VGC (\d{4}) Reg(?:ulation)? ([A-Z]-?[A-Z0-9]*)( \(Bo3\))?$/;

const str = (v: Literal | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: Literal | undefined): number | undefined => (typeof v === 'number' ? v : undefined);
const obj = (v: Literal | undefined): Entry | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Entry) : undefined;
const arr = (v: Literal | undefined): Literal[] => (Array.isArray(v) ? v : []);

interface ModTables {
  formatsData: LiteralTable;
  moves: LiteralTable;
  abilities: LiteralTable;
  items: LiteralTable;
  learnsets: LiteralTable;
  isChampions: boolean;
}

async function readTable(src: ShowdownSource, path: string): Promise<LiteralTable | undefined> {
  const text = await src.read(path);
  return text === null ? undefined : extractTable(text, path);
}

async function loadMod(src: ShowdownSource, mod: string, base: ModTables, cache: Map<string, ModTables>): Promise<ModTables> {
  if (mod === 'base' || mod === 'gen9') return base;
  const hit = cache.get(mod);
  if (hit) return hit;
  const dir = `data/mods/${mod}`;
  const scriptsText = await src.read(`${dir}/scripts.ts`);
  let parentId = 'base';
  if (scriptsText) {
    const scripts = obj(extractExports(scriptsText).Scripts);
    const inherit = scripts && str(scripts.inherit);
    if (inherit) parentId = inherit;
  }
  const parent = await loadMod(src, parentId, base, cache);
  const [formatsData, moves, abilities, items, learnsets] = await Promise.all([
    readTable(src, `${dir}/formats-data.ts`),
    readTable(src, `${dir}/moves.ts`),
    readTable(src, `${dir}/abilities.ts`),
    readTable(src, `${dir}/items.ts`),
    readTable(src, `${dir}/learnsets.ts`),
  ]);
  const tables: ModTables = {
    formatsData: applyMod(parent.formatsData, formatsData),
    moves: applyMod(parent.moves, moves),
    abilities: applyMod(parent.abilities, abilities),
    items: applyMod(parent.items, items),
    learnsets: applyMod(parent.learnsets, learnsets),
    isChampions: parent.isChampions || mod.startsWith('champions'),
  };
  cache.set(mod, tables);
  return tables;
}

function parseFormats(formatsText: string): FormatInfo[] {
  const exported = extractExports(formatsText, 'formats.ts');
  const list = arr(exported.Formats);
  const byReg = new Map<string, FormatInfo>();
  for (const raw of list) {
    const f = obj(raw);
    const name = f && str(f.name);
    if (!f || !name) continue;
    const m = FORMAT_RE.exec(name);
    if (!m) continue;
    const [, season, reg, bo3] = m;
    const regulation = reg.includes('-') ? reg : `${reg[0]}-${reg.slice(1)}`;
    const existing = byReg.get(regulation);
    if (bo3) {
      if (existing) existing.bo3Id = toId(name);
      else byReg.set(regulation, { id: '', name: '', regulation, season: Number(season), mod: str(f.mod) ?? 'champions', current: false, bo3Id: toId(name), ruleset: [], banlist: [] });
      continue;
    }
    const info: FormatInfo = {
      id: toId(name),
      name,
      regulation,
      season: Number(season),
      mod: str(f.mod) ?? 'champions',
      current: f.searchShow !== false,
      bo3Id: existing?.bo3Id,
      ruleset: arr(f.ruleset).filter((r): r is string => typeof r === 'string'),
      banlist: arr(f.banlist).filter((r): r is string => typeof r === 'string'),
    };
    byReg.set(regulation, info);
  }
  const formats = [...byReg.values()].filter(f => f.id);
  formats.sort((a, b) => b.season - a.season || b.regulation.localeCompare(a.regulation));
  // Se nada estiver marcado como atual, a regulação mais recente é a atual.
  const currents = formats.filter(f => f.current);
  if (currents.length !== 1 && formats.length) {
    const pick = currents[0] ?? formats[0];
    for (const f of formats) f.current = f === pick;
  }
  return formats;
}

function isBanned(entry: { name: string; id: string; tags?: string[] }, banlist: string[]): boolean {
  for (const ban of banlist) {
    const banId = toId(ban);
    if (banId === entry.id || banId === toId(entry.name)) return true;
    if (entry.tags?.some(t => toId(t) === banId)) return true;
  }
  return false;
}

/**
 * Entrada de formats-data da espécie com a regra do Showdown (sim/dex-species.ts):
 * uma forma sem entrada própria (ex.: Meowstic-F) herda o tier da forma de origem
 * (battleOnly) ou da espécie base. Formas cosméticas (Vivillon-Polar...) não têm
 * dados próprios e ficam de fora.
 */
function formatsDataOf(table: LiteralTable, id: string, sp: Entry): Entry | undefined {
  const own = table[id];
  const baseName = str(sp.baseSpecies);
  if (own || !baseName || sp.isCosmeticForme === true) return own;
  const from = str(Array.isArray(sp.battleOnly) ? sp.battleOnly[0] : sp.battleOnly) ?? baseName;
  const parent = table[toId(from)];
  if (!parent) return undefined;
  const tier = str(parent.tier) ?? 'Illegal';
  return { tier, doublesTier: str(parent.doublesTier) ?? tier };
}

function speciesLegal(sp: Entry, fd: Entry | undefined, format: FormatInfo, tags: string[]): boolean {
  const nonstandard = (fd && fd.isNonstandard) ?? sp.isNonstandard;
  if (nonstandard) return false;
  if (!fd || str(fd.tier) === 'Illegal') return false;
  const flat = format.ruleset.some(r => toId(r) === 'flatrules');
  if (flat && tags.some(t => t === 'Mythical' || t === 'Restricted Legendary')) return false;
  return !isBanned({ name: str(sp.name) ?? '', id: toId(sp.name), tags }, format.banlist);
}

function moveEffects(m: Entry): MoveEffects {
  const e: MoveEffects = {};
  const sec = obj(m.secondary) ?? obj(arr(m.secondaries)[0]);
  if (sec) {
    e.secondaryChance = num(sec.chance) ?? 100;
    if (str(sec.status)) e.status = str(sec.status);
    if (str(sec.volatileStatus)) e.volatileStatus = str(sec.volatileStatus);
    const b = obj(sec.boosts);
    if (b) e.boosts = b as Record<string, number>;
    const self = obj(sec.self);
    const sb = self && obj(self.boosts);
    if (sb) e.selfBoosts = sb as Record<string, number>;
  }
  if (str(m.status)) e.status = str(m.status);
  if (str(m.volatileStatus)) e.volatileStatus = str(m.volatileStatus);
  if (str(m.sideCondition)) e.sideCondition = str(m.sideCondition);
  if (str(m.weather)) e.weather = str(m.weather);
  if (str(m.terrain)) e.terrain = str(m.terrain);
  if (str(m.pseudoWeather)) e.pseudoWeather = str(m.pseudoWeather);
  const boosts = obj(m.boosts);
  if (boosts) {
    if (str(m.target) === 'self' || str(m.target) === 'adjacentAllyOrSelf' || str(m.target) === 'allySide' || str(m.target) === 'allies') e.selfBoosts = boosts as Record<string, number>;
    else e.boosts = boosts as Record<string, number>;
  }
  const self = obj(m.self);
  const selfBoosts = self && obj(self.boosts);
  if (selfBoosts) e.selfBoosts = selfBoosts as Record<string, number>;
  const pair = (v: Literal | undefined) => (Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number') ? (v as [number, number]) : undefined);
  if (pair(m.drain)) e.drain = pair(m.drain);
  if (pair(m.recoil)) e.recoil = pair(m.recoil);
  if (pair(m.heal)) e.heal = pair(m.heal);
  if (typeof m.multihit === 'number') e.multihit = m.multihit;
  else if (pair(m.multihit)) e.multihit = pair(m.multihit);
  if (num(m.critRatio)) e.critRatio = num(m.critRatio);
  if (m.willCrit === true) e.willCrit = true;
  if (m.selfSwitch) e.selfSwitch = typeof m.selfSwitch === 'string' ? m.selfSwitch : true;
  if (m.forceSwitch === true) e.forceSwitch = true;
  if (m.breaksProtect === true) e.breaksProtect = true;
  if (m.ohko) e.ohko = true;
  if (SPREAD_TARGETS.has(str(m.target) ?? '')) e.isSpread = true;
  return e;
}

function textFor(text: LiteralTable, id: string): { desc?: string; shortDesc: string } {
  const t = text[id];
  if (!t) return { shortDesc: '' };
  const champ = obj(t.champions);
  const desc = str(champ?.desc) ?? str(t.desc);
  const shortDesc = str(champ?.shortDesc) ?? str(t.shortDesc) ?? desc ?? '';
  return { desc: desc && desc !== shortDesc ? desc : undefined, shortDesc };
}

function flagsOf(m: Entry): string[] {
  const f = obj(m.flags);
  return f ? Object.keys(f).filter(k => f[k]).sort() : [];
}

function direction(field: string, from: unknown, to: unknown): DataChange['direction'] {
  if (typeof from === 'number' && typeof to === 'number') {
    return to > from ? 'buff' : to < from ? 'nerf' : 'change';
  }
  if (field === 'accuracy') {
    if (to === true) return 'buff';
    if (from === true) return 'nerf';
  }
  if (field === 'disponibilidade') return to === 'disponível' ? 'buff' : 'nerf';
  return 'change';
}

const FIELD_PT: Record<string, string> = {
  basePower: 'Poder base',
  accuracy: 'Precisão',
  pp: 'PP',
  type: 'Tipo',
  category: 'Categoria',
  priority: 'Prioridade',
  target: 'Alvo',
  flags: 'Flags',
  secondaryChance: 'Chance de efeito',
  disponibilidade: 'Disponibilidade',
  descricao: 'Efeito',
};

function fmt(v: unknown): string {
  if (v === true) return 'nunca erra';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (v === undefined || v === null) return '—';
  return String(v);
}

function change(kind: DataChange['kind'], id: string, name: string, field: string, from: unknown, to: unknown): DataChange {
  return {
    kind, id, name, field, from, to,
    direction: direction(field, from, to),
    notePt: `${FIELD_PT[field] ?? field}: ${fmt(from)} → ${fmt(to)}`,
  };
}

async function main() {
  const src = createShowdownSource();
  const started = Date.now();
  console.log(`[dex] fonte: ${JSON.stringify(src.describe())}`);

  const [pokedexText, movesText, abilitiesText, itemsText, learnsetsText, formatsDataText, typechartText, naturesText,
    movesDescText, abilitiesDescText, itemsDescText, formatsText] = await Promise.all([
    'data/pokedex.ts', 'data/moves.ts', 'data/abilities.ts', 'data/items.ts', 'data/learnsets.ts', 'data/formats-data.ts',
    'data/typechart.ts', 'data/natures.ts', 'data/text/moves.ts', 'data/text/abilities.ts', 'data/text/items.ts', 'config/formats.ts',
  ].map(p => src.read(p)));
  if (!pokedexText || !movesText || !formatsText || !typechartText) throw new Error('Arquivos essenciais do Showdown não encontrados');

  const pokedex = extractTable(pokedexText);
  // Como no Showdown, a forma herda as tags da espécie base (ex.: Restricted Legendary).
  const tagsOf = (sp: Entry): string[] =>
    arr(sp.tags ?? (str(sp.baseSpecies) ? pokedex[toId(sp.baseSpecies)]?.tags : undefined)).filter((t): t is string => typeof t === 'string');
  const base: ModTables = {
    formatsData: extractTable(formatsDataText ?? ''),
    moves: extractTable(movesText),
    abilities: extractTable(abilitiesText ?? ''),
    items: extractTable(itemsText ?? ''),
    learnsets: extractTable(learnsetsText ?? ''),
    isChampions: false,
  };
  const movesDesc = extractTable(movesDescText ?? '');
  const abilitiesDesc = extractTable(abilitiesDescText ?? '');
  const itemsDesc = extractTable(itemsDescText ?? '');

  const formats = parseFormats(formatsText);
  if (!formats.length) throw new Error('Nenhum formato VGC de Pokémon Champions encontrado em config/formats.ts');
  const current = formats.find(f => f.current)!;
  console.log(`[dex] formatos: ${formats.map(f => `${f.regulation}${f.current ? '*' : ''} (${f.mod})`).join(', ')}`);

  const cache = new Map<string, ModTables>();
  const modTables = new Map<string, ModTables>();
  for (const f of formats) modTables.set(f.regulation, await loadMod(src, f.mod, base, cache));
  const main = modTables.get(current.regulation)!;

  // ---------------------------- Espécies ----------------------------
  const legalBy = new Map<string, Set<string>>();
  for (const f of formats) {
    const t = modTables.get(f.regulation)!;
    const legal = new Set<string>();
    for (const [id, sp] of Object.entries(pokedex)) {
      if (speciesLegal(sp, formatsDataOf(t.formatsData, id, sp), f, tagsOf(sp))) legal.add(id);
    }
    legalBy.set(f.regulation, legal);
  }
  const anyLegal = new Set<string>();
  for (const set of legalBy.values()) for (const id of set) anyLegal.add(id);

  const availableMoves = new Set(Object.entries(main.moves).filter(([, m]) => !m.isNonstandard && str(m.name)).map(([id]) => id));

  const learnsetOf = (id: string, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>();
    if (seen.has(id)) return out;
    seen.add(id);
    const sp = pokedex[id];
    const own = obj(main.learnsets[id]?.learnset);
    if (own) for (const move of Object.keys(own)) out.add(move);
    const parents: string[] = [];
    if (sp) {
      // No Champions o Showdown não herda golpes da pré-evolução (learnsetParent),
      // salvo para uma espécie base sem learnset próprio.
      if (str(sp.prevo) && (!main.isChampions || (!own && !str(sp.baseSpecies)))) parents.push(toId(sp.prevo));
      if (str(sp.changesFrom)) parents.push(toId(sp.changesFrom));
      const battleOnly = sp.battleOnly;
      if (typeof battleOnly === 'string') parents.push(toId(battleOnly));
      if (!own && str(sp.baseSpecies)) parents.push(toId(sp.baseSpecies));
    }
    for (const p of parents) for (const move of learnsetOf(p, seen)) out.add(move);
    return out;
  };

  const species: Record<string, SpeciesData> = {};
  for (const id of anyLegal) {
    const sp = pokedex[id];
    const fd = formatsDataOf(main.formatsData, id, sp) ?? {};
    const name = str(sp.name)!;
    const legal: Record<string, boolean> = {};
    for (const f of formats) legal[f.regulation] = legalBy.get(f.regulation)!.has(id);
    const abilities: SpeciesData['abilities'] = {};
    const ab = obj(sp.abilities) ?? {};
    for (const slot of ['0', '1', 'H', 'S'] as const) if (str(ab[slot])) abilities[slot] = str(ab[slot]);
    // Igual ao Showdown: "Mega", "Mega-X", "Mega-Z", mas também "M-Mega"/"F-Mega" (Meowstic).
    const isMega = str(sp.forme)?.includes('Mega') ?? false;
    const entry: SpeciesData = {
      id,
      name,
      num: num(sp.num) ?? 0,
      types: arr(sp.types) as TypeName[],
      baseStats: obj(sp.baseStats) as unknown as SpeciesData['baseStats'],
      abilities,
      weightkg: num(sp.weightkg) ?? 0,
      legal,
      learnset: isMega ? [] : [...learnsetOf(id)].filter(m => availableMoves.has(m)).sort(),
    };
    if (str(sp.baseSpecies)) entry.baseSpecies = str(sp.baseSpecies);
    if (str(sp.forme)) entry.forme = str(sp.forme);
    if (str(sp.requiredItem)) entry.requiredItem = str(sp.requiredItem);
    if (sp.battleOnly) entry.battleOnly = sp.battleOnly as string | string[];
    if (isMega) entry.isMega = true;
    const tags = tagsOf(sp);
    if (tags.length) entry.tags = tags;
    if (str(fd.tier)) entry.tier = str(fd.tier);
    if (str(fd.doublesTier)) entry.doublesTier = str(fd.doublesTier);
    const others = arr(sp.otherFormes).map(toId).filter(o => anyLegal.has(o));
    if (others.length) entry.otherFormes = others;
    species[id] = entry;
  }

  // Formas idênticas à base em batalha (ex.: Sinistcha-Masterpiece, Vivillon-Fancy):
  // continuam legais (importação funciona), mas não aparecem duplicadas no builder.
  for (const entry of Object.values(species)) {
    if (!entry.baseSpecies || entry.isMega || entry.battleOnly) continue;
    const base = species[toId(entry.baseSpecies)];
    if (!base || base === entry) continue;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (same(entry.types, base.types) && same(entry.baseStats, base.baseStats) && same(entry.abilities, base.abilities) && same(entry.learnset, base.learnset)) {
      entry.duplicateOf = base.id;
    }
  }

  // ----------------------------- Itens ------------------------------
  const items: Record<string, ItemData> = {};
  const itemLegal = (t: ModTables, id: string, f: FormatInfo) => {
    const it = t.items[id];
    return !!it && !it.isNonstandard && !isBanned({ name: str(it.name) ?? id, id }, f.banlist);
  };
  for (const [id, it] of Object.entries(main.items)) {
    const legal: Record<string, boolean> = {};
    let any = false;
    for (const f of formats) {
      legal[f.regulation] = itemLegal(modTables.get(f.regulation)!, id, f);
      any ||= legal[f.regulation];
    }
    if (!any) continue;
    const d = textFor(itemsDesc, id);
    const item: ItemData = { id, name: str(it.name)!, shortDesc: d.shortDesc, legal };
    if (d.desc) item.desc = d.desc;
    const mega = obj(it.megaStone);
    if (mega) item.megaStone = mega as Record<string, string>;
    if (it.isBerry === true) item.isBerry = true;
    items[id] = item;
  }

  // Megas: liga espécie base -> forma Mega quando a pedra existe no jogo.
  for (const item of Object.values(items)) {
    if (!item.megaStone) continue;
    for (const [baseName, megaName] of Object.entries(item.megaStone)) {
      const baseSp = species[toId(baseName)];
      const megaSp = species[toId(megaName)];
      if (!baseSp || !megaSp) continue;
      baseSp.megas = [...(baseSp.megas ?? []).filter(m => m.id !== megaSp.id), { id: megaSp.id, item: item.name }];
      megaSp.requiredItem = item.name;
    }
  }

  // ----------------------------- Golpes -----------------------------
  const usedMoves = new Set<string>();
  for (const sp of Object.values(species)) for (const m of sp.learnset) usedMoves.add(m);
  const moves: Record<string, MoveData> = {};
  // O Champions limita o PP base a 20 (init() de data/mods/champions/scripts.ts).
  const ppOf = (m: Entry) => Math.min(num(m.pp) ?? 0, main.isChampions ? 20 : 64);
  for (const id of availableMoves) {
    if (!usedMoves.has(id) && id !== 'struggle') continue;
    const m = main.moves[id];
    const basePP = ppOf(m);
    const d = textFor(movesDesc, id);
    const move: MoveData = {
      id,
      name: str(m.name)!,
      type: str(m.type) as TypeName,
      category: str(m.category) as MoveData['category'],
      basePower: num(m.basePower) ?? 0,
      accuracy: m.accuracy === true ? true : num(m.accuracy) ?? 100,
      pp: basePP,
      ppInGame: m.noPPBoosts === true || !main.isChampions ? basePP : (basePP / 5 + 1) * 4,
      priority: num(m.priority) ?? 0,
      target: str(m.target) ?? 'normal',
      flags: flagsOf(m),
      shortDesc: d.shortDesc,
      effects: moveEffects(m),
    };
    if (d.desc) move.desc = d.desc;
    moves[id] = move;
  }

  // --------------------------- Habilidades ---------------------------
  const usedAbilities = new Set<string>();
  for (const sp of Object.values(species)) for (const a of Object.values(sp.abilities)) if (a) usedAbilities.add(toId(a));
  const abilities: Record<string, AbilityData> = {};
  for (const id of usedAbilities) {
    const a = main.abilities[id];
    if (!a) continue;
    const d = textFor(abilitiesDesc, id);
    abilities[id] = { id, name: str(a.name)!, shortDesc: d.shortDesc, rating: num(a.rating) };
    if (d.desc) abilities[id].desc = d.desc;
  }

  // --------------------------- Natures / tipos ---------------------------
  const natures: Record<string, NatureData> = {};
  for (const [id, n] of Object.entries(extractTable(naturesText ?? ''))) {
    natures[id] = { name: str(n.name)!, plus: str(n.plus) as StatId | undefined, minus: str(n.minus) as StatId | undefined };
  }
  const rawChart = extractTable(typechartText);
  const typechart = {} as Dex['typechart'];
  for (const def of TYPES) {
    const dt = obj(rawChart[toId(def)]?.damageTaken) ?? {};
    const row = {} as Record<TypeName, number>;
    for (const atk of TYPES) {
      const code = num(dt[atk]) ?? 0;
      row[atk] = code === 1 ? 2 : code === 2 ? 0.5 : code === 3 ? 0 : 1;
    }
    typechart[def] = row;
  }

  // ------------------ Mudanças Champions x Scarlet/Violet ------------------
  const changes: DataChange[] = [];
  for (const [id, m] of Object.entries(main.moves)) {
    const sv = base.moves[id];
    if (!sv || !str(m.name)) continue;
    const name = str(m.name)!;
    const svAvail = !sv.isNonstandard;
    const chAvail = !m.isNonstandard;
    if (svAvail !== chAvail) {
      if (chAvail && !usedMoves.has(id)) continue;
      changes.push(change('move', id, name, 'disponibilidade', svAvail ? 'disponível' : 'indisponível', chAvail ? 'disponível' : 'indisponível'));
      continue;
    }
    if (!chAvail) continue;
    for (const field of ['basePower', 'accuracy', 'type', 'category', 'priority', 'target'] as const) {
      if (JSON.stringify(sv[field]) !== JSON.stringify(m[field])) changes.push(change('move', id, name, field, clean(sv[field]), clean(m[field])));
    }
    if ((num(sv.pp) ?? 0) !== ppOf(m)) changes.push(change('move', id, name, 'pp', num(sv.pp), ppOf(m)));
    const fa = flagsOf(sv), fb = flagsOf(m);
    if (fa.join() !== fb.join()) changes.push(change('move', id, name, 'flags', fa, fb));
    const ca = moveEffects(sv).secondaryChance, cb = moveEffects(m).secondaryChance;
    if (ca !== cb && ca !== undefined && cb !== undefined) changes.push(change('move', id, name, 'secondaryChance', ca, cb));
    const t = movesDesc[id];
    const champ = t && obj(t.champions);
    if (champ && str(champ.shortDesc) && str(champ.shortDesc) !== str(t.shortDesc)) {
      changes.push(change('move', id, name, 'descricao', str(t.shortDesc), str(champ.shortDesc)));
    }
  }
  for (const [id, t] of Object.entries(abilitiesDesc)) {
    const champ = obj(t.champions);
    if (!champ || !usedAbilities.has(id)) continue;
    const from = str(t.shortDesc) ?? str(t.desc);
    const to = str(champ.shortDesc) ?? str(champ.desc);
    if (to && to !== from) changes.push(change('ability', id, str(t.name) ?? id, 'descricao', from, to));
  }
  for (const [id, it] of Object.entries(main.items)) {
    const sv = base.items[id];
    if (!sv) continue;
    const svAvail = !sv.isNonstandard, chAvail = !it.isNonstandard;
    if (svAvail !== chAvail) changes.push(change('item', id, str(it.name) ?? id, 'disponibilidade', svAvail ? 'disponível' : 'indisponível', chAvail ? 'disponível' : 'indisponível'));
    const t = itemsDesc[id];
    const champ = t && obj(t.champions);
    if (chAvail && champ && str(champ.shortDesc) && str(champ.shortDesc) !== str(t.shortDesc)) {
      changes.push(change('item', id, str(it.name) ?? id, 'descricao', str(t.shortDesc), str(champ.shortDesc)));
    }
  }

  const described = src.describe();
  const commit = described.commit ?? (described.kind === 'github' ? await resolveGithubCommit(described.ref) : null);
  const dex: Dex = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: { repo: 'smogon/pokemon-showdown', ref: described.ref, commit, mod: current.mod, kind: described.kind },
    statPoints: { total: 66, maxPerStat: 32, level: 50 },
    formats,
    currentRegulation: current.regulation,
    species,
    moves,
    abilities,
    items,
    natures,
    typechart,
    changes,
  };

  const out = join(process.cwd(), 'public', 'data', 'dex.json');
  mkdirSync(dirname(out), { recursive: true });
  // Mantém a data anterior se nada mudou, para o workflow diário não gerar commits vazios.
  if (existsSync(out)) {
    try {
      const prev = JSON.parse(readFileSync(out, 'utf8')) as Dex;
      const strip = (d: Dex) => JSON.stringify({ ...d, generatedAt: '', source: { ...d.source, commit: null } });
      if (strip(prev) === strip(dex)) dex.generatedAt = prev.generatedAt;
    } catch {
      // arquivo anterior inválido: sobrescreve
    }
  }
  writeFileSync(out, JSON.stringify(dex));
  const legalNow = Object.values(species).filter(s => s.legal[current.regulation] && !s.battleOnly).length;
  const megasNow = Object.values(species).filter(s => s.legal[current.regulation] && s.isMega).length;
  console.log(`[dex] ${Object.keys(species).length} espécies (${legalNow} selecionáveis + ${megasNow} Megas na Reg ${current.regulation}), ` +
    `${Object.keys(moves).length} golpes, ${Object.keys(abilities).length} habilidades, ${Object.keys(items).length} itens, ` +
    `${changes.length} mudanças vs SV — ${((Date.now() - started) / 1000).toFixed(1)}s -> ${out}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
