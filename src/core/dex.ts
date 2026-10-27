/**
 * Acesso de alto nível ao banco de dados (dex.json) com buscas por nome/id,
 * legalidade na regulação e resolução de Mega Evolução.
 */
import { toId } from './id.ts';
import type { AbilityData, Dex, FormatInfo, ItemData, MoveData, PokemonSet, SpeciesData } from './types.ts';

export class DexAccess {
  readonly data: Dex;
  readonly regulation: string;

  constructor(data: Dex, regulation?: string) {
    this.data = data;
    this.regulation = regulation ?? data.currentRegulation;
  }

  get format(): FormatInfo | undefined {
    return this.data.formats.find(f => f.regulation === this.regulation);
  }

  species(nameOrId: string | undefined | null): SpeciesData | undefined {
    if (!nameOrId) return undefined;
    return this.data.species[toId(nameOrId)];
  }

  move(nameOrId: string | undefined | null): MoveData | undefined {
    if (!nameOrId) return undefined;
    return this.data.moves[toId(nameOrId)];
  }

  item(nameOrId: string | undefined | null): ItemData | undefined {
    if (!nameOrId) return undefined;
    return this.data.items[toId(nameOrId)];
  }

  ability(nameOrId: string | undefined | null): AbilityData | undefined {
    if (!nameOrId) return undefined;
    return this.data.abilities[toId(nameOrId)];
  }

  /** Espécies escolhíveis no team builder (exclui formas só de batalha, como Megas). */
  selectableSpecies(): SpeciesData[] {
    return Object.values(this.data.species).filter(s => s.legal[this.regulation] && !s.isMega && !s.battleOnly);
  }

  isLegal(species: SpeciesData | undefined): boolean {
    return !!species && !!species.legal[this.regulation];
  }

  legalItems(): ItemData[] {
    return Object.values(this.data.items).filter(i => i.legal[this.regulation]);
  }

  /** Golpes que a espécie aprende (Megas usam o learnset da forma base). */
  learnset(species: SpeciesData | undefined): MoveData[] {
    if (!species) return [];
    const base = species.isMega && species.baseSpecies ? this.species(species.baseSpecies) ?? species : species;
    return base.learnset.map(id => this.data.moves[id]).filter((m): m is MoveData => !!m);
  }

  canLearn(species: SpeciesData | undefined, move: string): boolean {
    if (!species) return false;
    const base = species.isMega && species.baseSpecies ? this.species(species.baseSpecies) ?? species : species;
    return base.learnset.includes(toId(move));
  }

  /** Forma em batalha: se o set segura a Mega Stone correta, devolve a Mega. */
  battleForm(set: Pick<PokemonSet, 'species' | 'item'>): SpeciesData | undefined {
    const species = this.species(set.species);
    if (!species) return undefined;
    const item = this.item(set.item);
    if (item?.megaStone) {
      const megaName = item.megaStone[species.name];
      const mega = megaName ? this.species(megaName) : undefined;
      if (mega) return mega;
    }
    return species;
  }

  /** Espécie base (para Megas e formas). */
  baseOf(species: SpeciesData): SpeciesData {
    if (species.isMega && species.baseSpecies) {
      // Ex.: Floette-Mega tem base "Floette" mas evolui de Floette-Eternal.
      const viaStone = Object.values(this.data.items).find(i => i.megaStone && Object.values(i.megaStone).includes(species.name));
      const baseName = viaStone ? Object.keys(viaStone.megaStone!).find(k => viaStone.megaStone![k] === species.name) : undefined;
      return this.species(baseName ?? species.baseSpecies) ?? species;
    }
    return species;
  }

  /** Habilidades possíveis (na forma escolhida pelo jogador, não a Mega). */
  abilitiesOf(species: SpeciesData | undefined): AbilityData[] {
    if (!species) return [];
    return Object.values(species.abilities)
      .map(a => this.ability(a))
      .filter((a): a is AbilityData => !!a);
  }

  /** Efeito da habilidade ativa em batalha (Mega troca a habilidade). */
  battleAbility(set: Pick<PokemonSet, 'species' | 'item' | 'ability'>): string | undefined {
    const form = this.battleForm(set);
    if (form?.isMega) return form.abilities['0'];
    return set.ability;
  }
}
