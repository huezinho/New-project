/** Hooks utilitários da interface. */
import { useEffect, useState } from 'react';

/** Devolve `value` só depois de `delay` ms sem mudanças (evita recalcular a cada tecla). */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Aba do hash da URL; hash desconhecido ou malformado (ex.: "#%") volta para `fallback`. */
export function tabFromHash<T extends string>(hash: string, tabs: readonly T[], fallback: T): T {
  let h: string;
  try {
    h = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return fallback;
  }
  return (tabs as readonly string[]).includes(h) ? (h as T) : fallback;
}

/** Aba ativa sincronizada com o hash da URL (#equipe, #analise...). */
export function useHashTab<T extends string>(tabs: readonly T[], fallback: T): [T, (tab: T) => void] {
  const read = (): T => tabFromHash(window.location.hash, tabs, fallback);
  const [tab, setTab] = useState<T>(read);
  useEffect(() => {
    const onHash = () => setTab(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const change = (next: T) => {
    setTab(next);
    try {
      window.history.replaceState(null, '', `#${next}`);
    } catch {
      window.location.hash = next;
    }
  };
  return [tab, change];
}
