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
    throw new ApiRequestError(err?.message ?? `HTTP ${res.status}`, res.status, err?.error ?? 'server_error');
  }
  if (!isJson) throw new ApiRequestError('Unerwartete Antwort vom Server', res.status, 'server_error');
  return body as T;
}

let health: Promise<HealthResponse | null> | null = null;

/** Prüft einmal pro Seitenaufruf, ob das Backend da ist. */
export function apiHealth(force = false): Promise<HealthResponse | null> {
  if (!health || force) {
    health = request<HealthResponse>('/health', { timeoutMs: 3500 })
      .then((h) => (h?.ok ? h : null))
      .catch(() => null);
  }
  return health;
}

export async function apiAvailable(): Promise<boolean> {
  return (await apiHealth()) != null;
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
