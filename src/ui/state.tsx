/**
 * Estado global da interface (equipe ativa, equipes salvas, regulação, pesos)
 * exposto por contexto React.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SuggestionWeights } from '../core/api.ts';
import type { DexAccess } from '../core/dex.ts';
import { DEFAULT_WEIGHTS } from '../core/engine.ts';
import type { PokemonSet, Team } from '../core/types.ts';
import type { AppData } from './data.ts';
import { makeBridge, runBuildSet, teamKeyOf, type Bridge } from './engineBridge.ts';
import { useDebounced } from './hooks.ts';
import { loadStore, newSavedTeam, readJSON, sanitizeWeights, STORAGE_KEYS, writeJSON, type SavedTeam, type TeamStore } from './storage.ts';
import { MAX_TEAM } from './util.ts';

export const TABS = ['equipe', 'analise', 'meta', 'regras', 'fontes'] as const;
export type TabId = (typeof TABS)[number];

export interface AppState {
  data: AppData;
  bridge: Bridge;
  dex: DexAccess;
  regulation: string;
  setRegulation: (reg: string) => void;
  /** Equipe atual (atualiza a cada edição). */
  team: Team;
  /** Equipe usada pelo motor (com debounce de 250 ms) e sua chave JSON. */
  engineTeam: Team;
  engineKey: string;
  /** true enquanto a equipe editada ainda não chegou ao motor. */
  pending: boolean;
  setTeam: (next: Team | ((prev: Team) => Team)) => void;
  updateSet: (slot: number, patch: Partial<PokemonSet>) => void;
  addSpecies: (species: string) => void;
  replaceSpecies: (slot: number, species: string) => void;
  removeSet: (slot: number) => void;
  selected: number;
  setSelected: (slot: number) => void;
  store: TeamStore;
  activeTeam: SavedTeam;
  switchTeam: (id: string) => void;
  createTeam: (name?: string, team?: Team) => void;
  duplicateTeam: () => void;
  deleteTeam: () => void;
  renameTeam: (name: string) => void;
  weights: SuggestionWeights;
  setWeights: (w: SuggestionWeights) => void;
  tab: TabId;
  goTab: (tab: TabId) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fora do AppProvider');
  return v;
}

export function AppProvider({ data, tab, goTab, children }: { data: AppData; tab: TabId; goTab: (t: TabId) => void; children: ReactNode }) {
  const regulations = data.dex.formats.map(f => f.regulation);
  const [regulation, setRegulationState] = useState<string>(() => {
    const saved = readJSON<string | null>(STORAGE_KEYS.regulation, null);
    return saved && regulations.includes(saved) ? saved : data.dex.currentRegulation;
  });
  const [weights, setWeightsState] = useState<SuggestionWeights>(() => sanitizeWeights(readJSON(STORAGE_KEYS.weights, null), DEFAULT_WEIGHTS));
  const [store, setStore] = useState<TeamStore>(loadStore);
  const [selected, setSelectedState] = useState(0);

  useEffect(() => writeJSON(STORAGE_KEYS.teams, store), [store]);

  const setRegulation = useCallback((reg: string) => {
    setRegulationState(reg);
    writeJSON(STORAGE_KEYS.regulation, reg);
  }, []);
  const setWeights = useCallback((w: SuggestionWeights) => {
    setWeightsState(w);
    writeJSON(STORAGE_KEYS.weights, w);
  }, []);

  const debouncedWeights = useDebounced(weights, 250);
  const bridge = useMemo(() => makeBridge(data, regulation, debouncedWeights), [data, regulation, debouncedWeights]);
  const dex = bridge.dex;

  const activeTeam = store.teams.find(t => t.id === store.activeId) ?? store.teams[0];
  const team = activeTeam.team;
  const teamKey = useMemo(() => teamKeyOf(team), [team]);
  const engineKey = useDebounced(teamKey, 250);
  const engineTeam = useMemo(() => JSON.parse(engineKey) as Team, [engineKey]);

  const setTeam = useCallback((next: Team | ((prev: Team) => Team)) => {
    setStore(s => ({
      ...s,
      teams: s.teams.map(t => {
        if (t.id !== s.activeId) return t;
        const value = typeof next === 'function' ? next(t.team) : next;
        return { ...t, team: value.slice(0, MAX_TEAM), updatedAt: new Date().toISOString() };
      }),
    }));
  }, []);

  const setSelected = useCallback((slot: number) => setSelectedState(Math.max(0, Math.min(MAX_TEAM - 1, slot))), []);

  // mantém a seleção dentro da equipe (ou no primeiro slot vazio)
  useEffect(() => {
    if (selected > team.length) setSelectedState(Math.min(team.length, MAX_TEAM - 1));
  }, [selected, team.length]);

  const updateSet = useCallback(
    (slot: number, patch: Partial<PokemonSet>) => setTeam(t => t.map((s, i) => (i === slot ? { ...s, ...patch } : s))),
    [setTeam],
  );

  const addSpecies = useCallback(
    (species: string) => {
      if (team.length >= MAX_TEAM) return;
      const { set } = runBuildSet(bridge, team, species);
      setTeam([...team, set]);
      setSelectedState(team.length);
    },
    [bridge, team, setTeam],
  );

  const replaceSpecies = useCallback(
    (slot: number, species: string) => {
      const others = team.filter((_, i) => i !== slot);
      const { set } = runBuildSet(bridge, others, species);
      setTeam(team.map((s, i) => (i === slot ? set : s)));
    },
    [bridge, team, setTeam],
  );

  const removeSet = useCallback(
    (slot: number) => {
      setTeam(t => t.filter((_, i) => i !== slot));
      setSelectedState(s => (s > slot ? s - 1 : s));
    },
    [setTeam],
  );

  const switchTeam = useCallback((id: string) => {
    setStore(s => (s.teams.some(t => t.id === id) ? { ...s, activeId: id } : s));
    setSelectedState(0);
  }, []);

  const createTeam = useCallback((name?: string, initial: Team = []) => {
    setStore(s => {
      const t = newSavedTeam(name ?? `Equipe ${s.teams.length + 1}`, initial.slice(0, MAX_TEAM));
      return { activeId: t.id, teams: [...s.teams, t] };
    });
    setSelectedState(0);
  }, []);

  const duplicateTeam = useCallback(() => {
    setStore(s => {
      const cur = s.teams.find(t => t.id === s.activeId) ?? s.teams[0];
      const t = newSavedTeam(`${cur.name} (cópia)`.slice(0, 60), cur.team);
      return { activeId: t.id, teams: [...s.teams, t] };
    });
  }, []);

  const deleteTeam = useCallback(() => {
    setStore(s => {
      const rest = s.teams.filter(t => t.id !== s.activeId);
      if (!rest.length) {
        const t = newSavedTeam('Minha equipe');
        return { activeId: t.id, teams: [t] };
      }
      return { activeId: rest[0].id, teams: rest };
    });
    setSelectedState(0);
  }, []);

  const renameTeam = useCallback((name: string) => {
    setStore(s => ({ ...s, teams: s.teams.map(t => (t.id === s.activeId ? { ...t, name: name.slice(0, 60) } : t)) }));
  }, []);

  const value: AppState = {
    data, bridge, dex, regulation, setRegulation, team, engineTeam, engineKey, pending: engineKey !== teamKey,
    setTeam, updateSet, addSpecies, replaceSpecies, removeSet, selected, setSelected, store, activeTeam,
    switchTeam, createTeam, duplicateTeam, deleteTeam, renameTeam, weights, setWeights, tab, goTab,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
