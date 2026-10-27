/**
 * Cliente HTTP simples com timeout, novas tentativas (backoff exponencial) e
 * um intervalo mínimo entre requisições ao mesmo host, para respeitar as
 * fontes públicas (Smogon, Limitless, Showdown...).
 *
 * Atrás de proxy corporativo, rode com NODE_USE_ENV_PROXY=1 (Node >= 22.21)
 * para que o fetch nativo respeite HTTPS_PROXY.
 */
const USER_AGENT = 'champions-vgc-builder/0.1 (+https://github.com/huezinho/New-project)';
const lastRequestByHost = new Map<string, number>();

export interface FetchOptions {
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  /** Devolve null em vez de erro quando o servidor responde 404. */
  allow404?: boolean;
  /** Intervalo mínimo (ms) entre requisições ao mesmo host. */
  minIntervalMs?: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function throttle(url: string, minIntervalMs: number) {
  const host = new URL(url).host;
  const last = lastRequestByHost.get(host) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestByHost.set(host, Date.now());
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string | null> {
  const retries = options.retries ?? 4;
  const timeoutMs = options.timeoutMs ?? 60_000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(url, options.minIntervalMs ?? 300);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...options.headers },
        signal: controller.signal,
      });
      if (res.status === 404 && options.allow404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} em ${url}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} em ${url}`);
        (err as Error & { fatal?: boolean }).fatal = true;
        throw err;
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      if ((err as { fatal?: boolean }).fatal) break;
      if (attempt < retries) await sleep(2000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T | null> {
  const text = await fetchText(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
  if (text === null) return null;
  return JSON.parse(text) as T;
}
