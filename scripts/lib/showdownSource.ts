/**
 * Acesso aos arquivos de dados do Pokémon Showdown (fonte oficial dos dados de
 * Pokémon Champions usados no simulador).
 *
 * Ordem de preferência:
 *  1. SHOWDOWN_DIR=/caminho/para/pokemon-showdown (checkout local);
 *  2. download dos arquivos individuais via raw.githubusercontent.com (padrão),
 *     com cache em .cache/showdown.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fetchText } from './http.ts';

const RAW_BASE = 'https://raw.githubusercontent.com/smogon/pokemon-showdown';

export interface ShowdownSource {
  /** Lê um arquivo relativo à raiz do repositório; devolve null se não existir. */
  read(path: string): Promise<string | null>;
  describe(): { kind: 'local' | 'github'; ref: string; commit: string | null; location: string };
}

export function createShowdownSource(options: { localDir?: string; ref?: string; cacheDir?: string } = {}): ShowdownSource {
  const localDir = options.localDir ?? process.env.SHOWDOWN_DIR;
  const ref = options.ref ?? process.env.SHOWDOWN_REF ?? 'master';
  if (localDir) {
    let commit: string | null = null;
    try {
      commit = execFileSync('git', ['-C', localDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      commit = null;
    }
    return {
      async read(path) {
        const full = join(localDir, path);
        return existsSync(full) ? readFileSync(full, 'utf8') : null;
      },
      describe: () => ({ kind: 'local', ref, commit, location: localDir }),
    };
  }

  const cacheDir = options.cacheDir ?? join(process.cwd(), '.cache', 'showdown', ref);
  let commit: string | null = null;
  return {
    async read(path) {
      const cached = join(cacheDir, path);
      if (process.env.SHOWDOWN_CACHE === '1' && existsSync(cached)) return readFileSync(cached, 'utf8');
      const text = await fetchText(`${RAW_BASE}/${ref}/${path}`, { allow404: true });
      if (text === null) return null;
      mkdirSync(dirname(cached), { recursive: true });
      writeFileSync(cached, text);
      return text;
    },
    describe: () => ({ kind: 'github', ref, commit, location: `${RAW_BASE}/${ref}` }),
  };
}

/** Tenta descobrir o commit atual do branch via API pública do GitHub (opcional). */
export async function resolveGithubCommit(ref = 'master'): Promise<string | null> {
  try {
    const text = await fetchText(`https://api.github.com/repos/smogon/pokemon-showdown/commits/${ref}`, {
      headers: { Accept: 'application/vnd.github.sha' },
      allow404: true,
      retries: 1,
    });
    return text && /^[0-9a-f]{40}$/.test(text.trim()) ? text.trim() : null;
  } catch {
    return null;
  }
}
