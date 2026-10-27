/**
 * Persistência no navegador. Todo acesso ao localStorage é protegido por
 * try/catch (modo privado, armazenamento bloqueado ou cheio).
 */
import type { SuggestionWeights } from '../core/api.ts';
import type { Team } from '../core/types.ts';
import { sanitizeTeam, uid } from './util.ts';

export const STORAGE_KEYS = {
  teams: 'cvb.teams.v1',
  weights: 'cvb.weights.v1',
  regulation: 'cvb.regulation.v1',
} as const;

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sem armazenamento disponível: segue só em memória
  }
}

export interface SavedTeam {
  id: string;
  name: string;
  team: Team;
  updatedAt: string;
}

export interface TeamStore {
  activeId: string;
  teams: SavedTeam[];
}

export function newSavedTeam(name: string, team: Team = []): SavedTeam {
  return { id: uid(), name, team, updatedAt: new Date().toISOString() };
}

export function sanitizeStore(raw: unknown): TeamStore {
  const teams: SavedTeam[] = [];
  if (raw && typeof raw === 'object' && Array.isArray((raw as TeamStore).teams)) {
    for (const t of (raw as TeamStore).teams) {
      if (!t || typeof t !== 'object') continue;
      teams.push({
        id: typeof t.id === 'string' && t.id ? t.id : uid(),
        name: typeof t.name === 'string' && t.name.trim() ? t.name.slice(0, 60) : 'Equipe sem nome',
        team: sanitizeTeam(t.team),
        updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : new Date().toISOString(),
      });
    }
  }
  if (!teams.length) teams.push(newSavedTeam('Minha equipe'));
  const activeId = raw && typeof (raw as TeamStore).activeId === 'string' && teams.some(t => t.id === (raw as TeamStore).activeId)
    ? (raw as TeamStore).activeId
    : teams[0].id;
  return { activeId, teams };
}

export function loadStore(): TeamStore {
  return sanitizeStore(readJSON<unknown>(STORAGE_KEYS.teams, null));
}

export function sanitizeWeights(raw: unknown, defaults: SuggestionWeights): SuggestionWeights {
  const out = { ...defaults };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(defaults) as (keyof SuggestionWeights)[]) {
      const v = Number((raw as Record<string, unknown>)[key]);
      if (Number.isFinite(v)) out[key] = Math.max(0, Math.min(1, v));
    }
  }
  return out;
}
