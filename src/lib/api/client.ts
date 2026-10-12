/**
 * Browser-Client für das Cloudflare-Backend. Ohne Backend (z. B. `npm run dev`)
 * meldet apiAvailable() false und die App spielt lokal/ungewertet weiter.
 */
import type { ChallengeKey } from '../../types';
import { getDevice } from '../device';
import type {
  ApiErrorBody,
  ApiErrorCode,
  FinishRunRequest,
  FinishRunResponse,
  HealthResponse,
  LeaderboardResponse,
  Period,
  StartRunResponse,
} from './contract';

const BASE = `${(import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''}/api`;
const RATE_LIMITED = 'Zu viele Anfragen in kurzer Zeit – bitte später erneut versuchen';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
  } catch {
    throw new ApiRequestError('Server nicht erreichbar', 0, 'network');
  } finally {
    clearTimeout(timer);
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    // 429 ohne JSON (z. B. vom CDN) trotzdem als Rate-Limit melden
    const limited = res.status === 429;
    throw new ApiRequestError(
      err?.message ?? (limited ? RATE_LIMITED : `HTTP ${res.status}`),
      res.status,
      err?.error ?? (limited ? 'rate_limited' : 'server_error'),
    );
  }
  if (!isJson) throw new ApiRequestError('Unerwartete Antwort vom Server', res.status, 'server_error');
  return body as T;
}

/** So lange gilt ein gescheiterter Health-Check, danach wird beim nächsten Aufruf neu geprüft. */
export const HEALTH_RETRY_MS = 15_000;

let health: Promise<HealthResponse | null> | null = null;
/** War das Backend in diesem Seitenaufruf schon einmal erreichbar? (false = evtl. gar keins) */
let everOnline = false;

export function apiEverOnline(): boolean {
  return everOnline;
}
/** Zeitpunkt, zu dem der zwischengespeicherte Check gescheitert ist – null: läuft noch oder ok */
let healthFailedAt: number | null = null;
const healthListeners = new Set<(ok: boolean) => void>();

/**
 * Prüft, ob das Backend da ist. Ein Erfolg gilt für den ganzen Seitenaufruf, ein
 * Fehlschlag nur HEALTH_RETRY_MS lang – danach (oder mit force) wird neu geprüft.
 */
export function apiHealth(force = false): Promise<HealthResponse | null> {
  const expired = healthFailedAt != null && Date.now() - healthFailedAt >= HEALTH_RETRY_MS;
  if (!health || force || expired) {
    const probe: Promise<HealthResponse | null> = request<HealthResponse>('/health', { timeoutMs: 3500 })
      .then((h) => (h?.ok ? h : null))
      .catch(() => null)
      .then((h) => {
        // Nur der jüngste Check zählt
        if (h) everOnline = true;
        if (health === probe) {
          healthFailedAt = h ? null : Date.now();
          for (const listener of healthListeners) listener(h != null);
        }
        return h;
      });
    health = probe;
    healthFailedAt = null;
  }
  return health;
}

/**
 * Ist das Backend erreichbar? recheck: Ein bekannter Fehlschlag wird sofort neu geprüft
 * (z. B. direkt vor dem Start eines Runs), statt bis zu HEALTH_RETRY_MS alt zu sein.
 */
export async function apiAvailable(recheck = false): Promise<boolean> {
  return (await apiHealth(recheck && healthFailedAt != null)) != null;
}

/** Meldet das Ergebnis jedes weiteren Health-Checks (true = erreichbar). Liefert die Abmeldung. */
export function onApiHealth(listener: (ok: boolean) => void): () => void {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
}

export function startRun(challenge: ChallengeKey): Promise<StartRunResponse> {
  return request<StartRunResponse>('/runs/start', {
    method: 'POST',
    body: JSON.stringify({ ...getDevice(), challenge }),
  });
}

export function finishRun(req: Omit<FinishRunRequest, 'deviceId' | 'deviceSecret'>): Promise<FinishRunResponse> {
  return request<FinishRunResponse>('/runs/finish', {
    method: 'POST',
    body: JSON.stringify({ ...getDevice(), ...req }),
  });
}

export function fetchLeaderboard(challenge: ChallengeKey, period: Period, limit = 50): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({ challenge, period, limit: String(limit), me: getDevice().deviceId });
  return request<LeaderboardResponse>(`/leaderboard?${params}`);
}

export async function renamePlayer(player: string): Promise<void> {
  await request<{ ok: true }>('/player', { method: 'POST', body: JSON.stringify({ ...getDevice(), player }) });
}
