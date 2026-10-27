/**
 * Formatos intermediários normalizados que todas as fontes de meta produzem
 * antes da agregação (scripts/lib/aggregate.ts).
 */
import type { StatsTable } from '../../src/core/types.ts';

export interface RecordMember {
  species: string;
  item?: string | null;
  ability?: string | null;
  moves: string[];
  nature?: string | null;
  sp?: Partial<StatsTable> | null;
}

/** Um time com resultado conhecido (torneio, replay ou seed). */
export interface TeamRecord {
  source: string;
  sourceKind: 'official' | 'online' | 'ladder' | 'seed';
  eventId?: string;
  eventName?: string;
  date: string; // ISO yyyy-mm-dd
  regulation: string;
  game?: string;
  player?: string;
  placing?: number | null;
  players?: number | null;
  wins: number | null;
  losses: number | null;
  ties?: number | null;
  rating?: number | null;
  pokemon: RecordMember[];
}

export interface UsageEntry {
  usage: number;
  rawCount?: number;
  moves: Record<string, number>;
  items: Record<string, number>;
  abilities: Record<string, number>;
  /** "Natureza:hp/atk/def/spa/spd/spe" -> fração */
  spreads: Record<string, number>;
  teammates: Record<string, number>;
}

/** Estatística agregada de uso (ex.: um mês do ladder da Smogon). */
export interface UsageSnapshot {
  source: string;
  sourceKind: 'ladder' | 'seed';
  label: string;
  url?: string;
  /** Data representativa (meio do período). */
  date: string;
  period?: string;
  regulation: string;
  cutoff?: number;
  battles: number;
  pokemon: Record<string, UsageEntry>;
}

export interface PatchEvent {
  date: string;
  version?: string;
  /** Nomes (espécies, golpes, habilidades, itens) afetados. */
  affects: string[];
}
