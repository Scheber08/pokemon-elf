/**
 * Browser-Client für das Cloudflare-Backend. Ohne Backend (z. B. `npm run dev`)
 * meldet apiAvailable() false und die App spielt lokal/ungewertet weiter.
 */
import { currentLang, messages } from '../../i18n';
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
/** Sprache der Server-Meldungen – in dieser Sprache werden sie unverändert gezeigt. */
const SERVER_LANG = 'de';

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

/**
 * Anzeigbare Meldung zu einem Fehler des Servers in der aktiven Sprache. Der Server meldet
 * auf Deutsch: Im deutschen Modus bleibt seine Meldung unverändert, sonst wird sie über den
 * stabilen Fehlercode übersetzt (unbekannter Code → Meldung des Servers).
 */
export function apiErrorMessage(code: string, serverMessage: string): string {
  if (currentLang() === SERVER_LANG) return serverMessage;
  return translateServerError(code, serverMessage) ?? serverMessage;
}

function translateServerError(code: string, msg: string): string | null {
  const t = messages().errors;
  switch (code) {
    case 'bad_request':
      // POST /api/player: „Spielername ist zu lang …", „Spielername braucht mindestens …"
      return /^Spielername/.test(msg) ? t.invalidPlayerName : t.code.bad_request;
    case 'not_found':
      return msg === 'Run nicht gefunden' ? t.runNotFound : t.code.not_found;
    case 'already_played': {
      // „Die Tägliche Elf vom 12.10.2026 hast du schon gespielt …"
      const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(msg);
      return m ? t.alreadyPlayedOn(messages().game.day(`${m[3]}-${m[2]}-${m[1]}`)) : t.code.already_played;
    }
    case 'invalid_run': {
      const m = /\(Runde (\d+)\)/.exec(msg);
      return m ? t.invalidRunInRound(Number(m[1])) : t.code.invalid_run;
    }
    case 'token_expired': {
      const m = /(\d+) Stunden/.exec(msg);
      return m ? t.tokenExpired(Number(m[1])) : t.code.token_expired;
    }
    case 'rate_limited':
      if (/Geräte/.test(msg)) return t.tooManyDevices;
      if (/gewertete Runs/.test(msg)) return t.tooManyFinishes;
      if (/Runs/.test(msg)) return t.tooManyRuns;
      return t.code.rate_limited;
    default:
      return Object.prototype.hasOwnProperty.call(t.code, code) ? t.code[code as ApiErrorCode] : null;
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
    throw new ApiRequestError(messages().errors.network, 0, 'network');
  } finally {
    clearTimeout(timer);
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    // 429 ohne JSON (z. B. vom CDN) trotzdem als Rate-Limit melden
    const limited = res.status === 429;
    const code = err?.error ?? (limited ? 'rate_limited' : 'server_error');
    const t = messages().errors;
    throw new ApiRequestError(
      err?.message != null ? apiErrorMessage(code, err.message) : limited ? t.rateLimited : t.http(res.status),
      res.status,
      code,
    );
  }
  if (!isJson) throw new ApiRequestError(messages().errors.unexpected, res.status, 'server_error');
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
