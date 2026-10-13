/**
 * Browser-Client für den Online-Fantasy-Draft (siehe draftContract.ts): HTTP-Aufrufe
 * (Liga erstellen, öffentliche Lobbys, Schnappschuss) und die WebSocket-Verbindung zum
 * Draft-Raum mit automatischem Wiederverbinden, Ping und Uhrenabgleich.
 * Der Server ist maßgeblich – hier wird nichts entschieden, nur übertragen.
 */
import type { DeviceAuth, HealthResponse, ApiErrorBody } from './contract';
import { messages } from '../../i18n';
import { getDevice } from '../device';
import { ApiRequestError, apiHealth } from './client';
import {
  DRAFT_LIMITS,
  type CreateDraftRequest,
  type CreateDraftResponse,
  type DraftClientMessage,
  type DraftServerMessage,
  type DraftSnapshot,
  type PublicLobbiesResponse,
} from './draftContract';

// ---------------------------------------------------------------- Adressen

/** API-Basis aus VITE_API_BASE – wie in client.ts: ohne Wert gleiche Domain ('/api'). */
export function apiBaseFrom(envBase: string | undefined): string {
  return `${envBase?.trim().replace(/\/+$/, '') ?? ''}/api`;
}

const API_BASE = apiBaseFrom(import.meta.env.VITE_API_BASE as string | undefined);

/**
 * WebSocket-Adresse eines Draft-Raums. Absolute API-Basis: http→ws, https→wss;
 * relative Basis: Host und Protokoll der Seite (https-Seite → wss).
 */
export function draftWsUrl(
  code: string,
  base: string = API_BASE,
  loc: Pick<Location, 'protocol' | 'host'> = globalThis.location,
): string {
  const path = `/drafts/${encodeURIComponent(code)}/ws`;
  if (/^https?:\/\//i.test(base)) return base.replace(/^http/i, 'ws') + path;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  if (base.startsWith('//')) return `${proto}${base}${path}`;
  return `${proto}//${loc.host}${base.startsWith('/') ? '' : '/'}${base}${path}`;
}

/** Einladungslink: origin + BASE_URL + 'draft/' + Code. */
export function draftLinkFor(origin: string, baseUrl: string, code: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${origin.replace(/\/+$/, '')}${base.startsWith('/') ? '' : '/'}${base}draft/${code}`;
}

export function draftLink(code: string): string {
  return draftLinkFor(globalThis.location.origin, import.meta.env.BASE_URL, code);
}

// ---------------------------------------------------------------- Liga-Codes

const CODE_CHARS = new Set(DRAFT_LIMITS.codeAlphabet);

/**
 * Eingabe → Code: Großbuchstaben, nur Zeichen aus dem Code-Alphabet, höchstens 6.
 * Ein eingefügter Einladungslink (…/draft/ABC234) liefert seinen Code.
 */
export function normalizeDraftCode(raw: string): string {
  const fromLink = /\/draft\/([^/?#\s]+)/i.exec(raw)?.[1];
  let out = '';
  for (const ch of (fromLink ?? raw).toUpperCase()) {
    if (CODE_CHARS.has(ch)) out += ch;
    if (out.length === DRAFT_LIMITS.codeLength) break;
  }
  return out;
}

export function isDraftCode(code: string): boolean {
  return code.length === DRAFT_LIMITS.codeLength && [...code].every((ch) => CODE_CHARS.has(ch));
}

// ---------------------------------------------------------------- Wiederverbinden & Uhr

export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 15_000;
/** Höchste Wartezeit nach einer abgelehnten Anmeldung (hello) – schont Server und Datenbank */
export const AUTH_RETRY_MAX_MS = 60_000;
export const PING_INTERVAL_MS = 25_000;
/** So lange darf der Aufbau dauern: erst der Handshake, danach die Antwort auf hello */
export const CONNECT_TIMEOUT_MS = 8000;
/** Prüf-Ping (Tab wieder sichtbar, Aktion ohne Antwort): so lange auf ein Lebenszeichen warten */
export const PROBE_TIMEOUT_MS = 5000;
/** Hängt der Aufbau beim Zurückkehren in den Tab schon so lange, wird er ersetzt */
export const STALE_CONNECT_MS = 3000;
/** Close-Codes des Servers (wie DRAFT_CLOSE in server/draftCore.ts) – danach kein automatischer Neuversuch */
export const DRAFT_CLOSE_CODES = { closed: 4000, unauthorized: 4001, replaced: 4006 } as const;

/** Wartezeit vor dem n-ten Wiederverbindungsversuch (0-basiert): 1 s, 2 s, 4 s, 8 s, 15 s, 15 s … */
export function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, Math.floor(attempt)));
}

/** Wartezeit nach abgelehnter Anmeldung: 1 s, 2 s, 4 s … bis 60 s (z. B. Limit neuer Geräte pro Stunde). */
export function authRetryDelay(attempt: number): number {
  return Math.min(AUTH_RETRY_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, Math.floor(attempt)));
}

/** Hat der Server endgültig geschlossen (Liga geschlossen, Anmeldung abgelehnt, anderer Tab hat übernommen)? */
export function isFinalClose(code: number | undefined): boolean {
  return code === DRAFT_CLOSE_CODES.closed || code === DRAFT_CLOSE_CODES.unauthorized || code === DRAFT_CLOSE_CODES.replaced;
}

/**
 * Uhrenabgleich mit dem Server: offset = Serverzeit − Date.now(). Ping/Pong-Proben ziehen die
 * halbe Laufzeit ab; es gilt die schnellste der letzten (keep) Proben, die höchstens maxAgeMs
 * vor der zuletzt erhaltenen Probe liegen – nach einem Sprung der Geräteuhr bleibt eine alte
 * Probe so nicht lange maßgeblich. Proben aus Schnappschüssen (Laufzeit unbekannt) zählen nur,
 * solange es keine aktuelle Ping-Probe gibt.
 */
export class ClockSync {
  private samples: { offset: number; rtt: number; at: number }[] = [];
  private oneWay: { offset: number; at: number } | null = null;
  /** Empfangszeit der zuletzt erhaltenen Probe (beliebiger Art) */
  private latest = 0;

  constructor(
    private readonly keep = 5,
    private readonly maxAgeMs = 60_000,
  ) {}

  get offset(): number {
    let best: { offset: number; rtt: number } | null = null;
    for (const s of this.samples) {
      if (Math.abs(this.latest - s.at) > this.maxAgeMs) continue;
      if (!best || s.rtt < best.rtt) best = s;
    }
    return best ? best.offset : (this.oneWay?.offset ?? 0);
  }

  /** Probe aus Ping (gesendet sentAt) und Pong (empfangen receivedAt, Serverzeit serverNow). */
  addRoundTrip(serverNow: number, sentAt: number, receivedAt: number): void {
    if (!Number.isFinite(serverNow) || receivedAt < sentAt) return;
    const rtt = receivedAt - sentAt;
    this.samples.push({ offset: Math.round(serverNow - (sentAt + rtt / 2)), rtt, at: receivedAt });
    if (this.samples.length > this.keep) this.samples.shift();
    this.latest = receivedAt;
  }

  /** Probe ohne Laufzeit (Schnappschuss): Serverzeit beim Versand gegen Empfangszeit. */
  addOneWay(serverNow: number, receivedAt: number): void {
    if (!Number.isFinite(serverNow)) return;
    this.oneWay = { offset: serverNow - receivedAt, at: receivedAt };
    this.latest = receivedAt;
  }
}

// ---------------------------------------------------------------- HTTP

async function draftRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
  } catch {
    throw new ApiRequestError(messages().online.client.unreachable, 0, 'network');
  } finally {
    clearTimeout(timer);
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    const limited = res.status === 429;
    const texts = messages().online.client;
    throw new ApiRequestError(
      err?.message ??
        (limited ? texts.rateLimited : res.status === 404 ? texts.notFound : `HTTP ${res.status}`),
      res.status,
      err?.error ?? (limited ? 'rate_limited' : res.status === 404 ? 'not_found' : 'server_error'),
    );
  }
  if (!isJson) throw new ApiRequestError(messages().online.client.unexpected, res.status, 'server_error');
  return body as T;
}

/** Neue Liga anlegen – das Gerät wird automatisch angehängt (Host = dieses Gerät). */
export function createDraft(req: Omit<CreateDraftRequest, keyof DeviceAuth>): Promise<CreateDraftResponse> {
  return draftRequest<CreateDraftResponse>('/drafts', {
    method: 'POST',
    body: JSON.stringify({ ...getDevice(), ...req }),
  });
}

export function fetchPublicLobbies(): Promise<PublicLobbiesResponse> {
  return draftRequest<PublicLobbiesResponse>('/drafts/public');
}

/** Schnappschuss ohne Verbindung (you = null). 404 → Liga gibt es nicht (mehr). */
export function fetchDraftSnapshot(code: string): Promise<DraftSnapshot> {
  return draftRequest<DraftSnapshot>(`/drafts/${encodeURIComponent(code)}`);
}

/** Kann der Server Online-Ligen? (Health meldet features.drafts) */
export async function draftsSupported(force = false): Promise<boolean> {
  const health = (await apiHealth(force)) as (HealthResponse & { features?: { drafts?: boolean } }) | null;
  return health?.features?.drafts === true;
}

// ---------------------------------------------------------------- WebSocket

export type DraftSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface DraftConnectionError {
  code: string;
  message: string;
  /** Typ der abgelehnten eigenen Nachricht – fehlt, wenn der Server ihn nicht kennt */
  for?: string;
  /**
   * Antwort auf die Anmeldung (hello) – kam vor dem ersten Schnappschuss. Diese Verbindung wird
   * verworfen; der nächste Versuch folgt von selbst mit wachsender Wartezeit.
   */
  hello?: boolean;
}

export interface DraftConnectionHandlers {
  onState?(state: DraftSnapshot): void;
  onError?(error: DraftConnectionError): void;
  onStatus?(status: DraftSocketStatus): void;
  /** Neuer Uhren-Offset (Serverzeit − Date.now()) – kommt vor onState */
  onClockOffset?(offset: number): void;
}

export interface DraftConnectionOptions {
  /** Statt draftWsUrl(code) (Tests) */
  url?: string;
  WebSocketImpl?: typeof WebSocket;
  /** Geräte-Identität für hello (Standard: getDevice) */
  auth?: () => DeviceAuth;
  now?: () => number;
}

export interface DraftConnection {
  /** false, wenn gerade keine angemeldete Verbindung offen ist (Nachricht wird nicht nachgeschickt) */
  send(msg: DraftClientMessage): boolean;
  /** Endgültig schließen – kein Wiederverbinden mehr */
  close(): void;
  /**
   * Sofort neu verbinden („Jetzt verbinden", wieder online) – ersetzt auch einen hängenden oder
   * scheinbar offenen Socket. false, wenn die Verbindung endgültig geschlossen ist.
   */
  reconnectNow(): boolean;
  /**
   * Lebenszeichen prüfen (Tab wieder sichtbar, Aktion ohne Antwort): Wartet die Verbindung auf
   * den nächsten Versuch, hängt der Aufbau oder war sie länger als ein Ping-Intervall stumm, wird
   * sofort neu verbunden. Sonst geht ein Prüf-Ping raus – ohne Antwort binnen PROBE_TIMEOUT_MS
   * ebenfalls neu.
   */
  checkAlive(): void;
  readonly status: DraftSocketStatus;
  readonly clockOffset: number;
  /** Der Server hat hello bestätigt (erster Schnappschuss auf dieser Verbindung) */
  readonly authed: boolean;
}

const WS_OPEN = 1;

function parseServerMessage(data: unknown): DraftServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const msg = JSON.parse(data) as DraftServerMessage | null;
    return msg && typeof msg === 'object' && typeof msg.type === 'string' ? msg : null;
  } catch {
    return null;
  }
}

/**
 * Verbindet mit dem Draft-Raum: schickt nach jedem Öffnen hello (Gerät). Erst der erste
 * Schnappschuss bestätigt die Anmeldung – dann gilt die Verbindung als offen, es wird alle 25 s
 * gepingt und die Wartezeit zurückgesetzt. Ein Fehler davor heißt „hello abgelehnt": Socket zu,
 * später erneut (bis 60 s Pause). Nach Abbrüchen wird mit wachsender Pause (1 s … 15 s) neu
 * verbunden – außer der Server schließt endgültig (4000 Liga geschlossen, 4001 abgelehnt,
 * 4006 in einem neueren Tab geöffnet).
 * Aufbau und Anmeldung haben je CONNECT_TIMEOUT_MS Zeit; kommt seit einem Ping kein
 * Lebenszeichen mehr, gilt die Verbindung als tot.
 */
export function connectDraft(
  code: string,
  handlers: DraftConnectionHandlers,
  options: DraftConnectionOptions = {},
): DraftConnection {
  const url = options.url ?? draftWsUrl(code);
  const WS = options.WebSocketImpl ?? globalThis.WebSocket;
  const auth = options.auth ?? getDevice;
  const now = options.now ?? Date.now;
  const clock = new ClockSync();

  let ws: WebSocket | null = null;
  /** Aktueller Socket hat seinen ersten Schnappschuss bekommen (hello bestätigt) */
  let authed = false;
  /** Aufbau des aktuellen Sockets begonnen bzw. letzte Nachricht darauf */
  let startedAt = 0;
  let lastSeen = 0;
  /** Letzte Anmeldung wurde abgelehnt → längere Pausen zwischen den Versuchen */
  let rejected = false;
  /** Socket, dessen hello abgelehnt wurde – weitere Nachrichten darauf zählen nicht mehr */
  let refused: WebSocket | null = null;
  let status: DraftSocketStatus = 'connecting';
  let attempt = 0;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let pingSentAt: number | null = null;

  const setStatus = (next: DraftSocketStatus) => {
    if (next === status) return;
    status = next;
    handlers.onStatus?.(next);
  };

  const rawSend = (socket: WebSocket, msg: DraftClientMessage): boolean => {
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  };

  const ping = (socket: WebSocket) => {
    pingSentAt = now();
    rawSend(socket, { type: 'ping' });
  };

  const stopSocketTimers = () => {
    clearInterval(pingTimer);
    clearTimeout(connectTimer);
    clearTimeout(probeTimer);
    pingTimer = connectTimer = probeTimer = undefined;
    pingSentAt = null;
  };

  const scheduleRetry = () => {
    if (closed) return;
    setStatus('reconnecting');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(open, rejected ? authRetryDelay(attempt) : reconnectDelay(attempt));
    attempt++;
  };

  /** Socket ist weg (geschlossen, Fehler, Zeitüberschreitung) → später neu verbinden. */
  const drop = (socket: WebSocket, closeCode?: number) => {
    if (ws !== socket) return;
    ws = null;
    authed = false;
    stopSocketTimers();
    if (isFinalClose(closeCode) && !closed) {
      // Liga geschlossen bzw. Anmeldung endgültig abgelehnt: nicht von selbst neu verbinden
      clearTimeout(retryTimer);
      setStatus('closed');
      return;
    }
    scheduleRetry();
  };

  /** Socket aufgeben und schließen – neuer Versuch nach der Wartezeit oder sofort. */
  const abandon = (socket: WebSocket, immediately = false) => {
    if (ws !== socket) return;
    drop(socket);
    try {
      socket.close(1000);
    } catch {
      // schon zu
    }
    if (immediately && !closed) {
      attempt = 0;
      open();
    }
  };

  const armConnectTimer = (socket: WebSocket) => {
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (ws === socket && !authed) abandon(socket);
    }, CONNECT_TIMEOUT_MS);
  };

  /** Erster Schnappschuss = hello bestätigt: jetzt gilt die Verbindung als offen. */
  const welcome = (socket: WebSocket) => {
    authed = true;
    rejected = false;
    attempt = 0;
    clearTimeout(connectTimer);
    connectTimer = undefined;
    setStatus('open');
    // Erste Uhrenprobe erst jetzt – sonst stünde sie im Raum hinter der Anmeldung (Datenbank)
    ping(socket);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws !== socket) return;
      if (pingSentAt != null && now() - lastSeen >= PING_INTERVAL_MS) {
        // Seit dem letzten Ping kein Lebenszeichen mehr → tote Verbindung
        abandon(socket);
        return;
      }
      ping(socket);
    }, PING_INTERVAL_MS);
  };

  /** Prüf-Ping: kommt binnen PROBE_TIMEOUT_MS keine Nachricht, sofort neu verbinden. */
  const probe = (socket: WebSocket) => {
    if (probeTimer !== undefined) return;
    if (pingSentAt == null) ping(socket);
    else rawSend(socket, { type: 'ping' });
    probeTimer = setTimeout(() => {
      probeTimer = undefined;
      abandon(socket, true);
    }, PROBE_TIMEOUT_MS);
  };

  const onMessage = (socket: WebSocket, data: unknown) => {
    lastSeen = now();
    clearTimeout(probeTimer);
    probeTimer = undefined;
    const msg = parseServerMessage(data);
    if (!msg) return;
    if (msg.type === 'state') {
      if (!authed) welcome(socket);
      clock.addOneWay(msg.state.serverNow, now());
      handlers.onClockOffset?.(clock.offset);
      handlers.onState?.(msg.state);
    } else if (msg.type === 'pong') {
      if (pingSentAt != null) clock.addRoundTrip(msg.serverNow, pingSentAt, now());
      else clock.addOneWay(msg.serverNow, now());
      pingSentAt = null;
      handlers.onClockOffset?.(clock.offset);
    } else if (msg.type === 'error') {
      const error: DraftConnectionError = { code: String(msg.code), message: String(msg.message) };
      if (typeof msg.for === 'string') error.for = msg.for;
      if (authed) {
        handlers.onError?.(error);
        return;
      }
      // Fehler vor dem ersten Schnappschuss = hello abgelehnt: Diese Verbindung ist nutzlos.
      // Schließen; das Close-Ereignis plant den nächsten Versuch – oder hört auf, wenn der
      // Server selbst endgültig geschlossen hat. Serverfehler sind vorübergehend (kurze Pausen).
      rejected = error.code !== 'server_error';
      refused = socket;
      handlers.onError?.({ ...error, hello: true });
      if (ws === socket) {
        try {
          socket.close(1000);
        } catch {
          // schon zu
        }
      }
    }
  };

  function open() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    if (closed) return;
    let socket: WebSocket;
    try {
      socket = new WS(url);
    } catch {
      scheduleRetry();
      return;
    }
    ws = socket;
    authed = false;
    startedAt = lastSeen = now();
    armConnectTimer(socket);
    socket.onopen = () => {
      if (ws !== socket) return;
      lastSeen = now();
      rawSend(socket, { type: 'hello', ...auth() });
      // Jetzt auf die Antwort zu hello warten
      armConnectTimer(socket);
    };
    socket.onmessage = (ev: MessageEvent) => {
      if (ws === socket && refused !== socket) onMessage(socket, ev.data);
    };
    socket.onclose = (ev?: CloseEvent) => drop(socket, ev?.code);
    socket.onerror = () => {
      /* onclose folgt */
    };
  }

  /** Aktuellen Socket (falls vorhanden) verwerfen und sofort neu aufbauen. */
  const restart = () => {
    const socket = ws;
    if (socket) {
      ws = null;
      authed = false;
      stopSocketTimers();
      try {
        socket.close(1000);
      } catch {
        // schon zu
      }
    }
    if (status === 'open' || status === 'closed') setStatus('reconnecting');
    open();
  };

  open();

  return {
    send(msg) {
      if (!ws || !authed || ws.readyState !== WS_OPEN) return false;
      return rawSend(ws, msg);
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(retryTimer);
      stopSocketTimers();
      const socket = ws;
      ws = null;
      authed = false;
      try {
        socket?.close(1000);
      } catch {
        // schon zu
      }
      setStatus('closed');
    },
    reconnectNow() {
      if (closed) return false;
      attempt = 0;
      restart();
      return true;
    },
    checkAlive() {
      if (closed) return;
      const socket = ws;
      if (!socket) {
        // Wartet auf den nächsten Versuch → jetzt (nicht nach endgültigem Schließen durch den Server)
        if (status === 'closed') return;
        if (!rejected) attempt = 0;
        open();
        return;
      }
      const t = now();
      if (!authed) {
        // Aufbau hängt (z. B. nach einem Netzwechsel) → neu
        if (t - startedAt >= STALE_CONNECT_MS) restart();
        return;
      }
      if (t - lastSeen >= PING_INTERVAL_MS) {
        // Lange stumm (Hintergrund, Ruhezustand) – vermutlich eine tote Verbindung
        attempt = 0;
        restart();
        return;
      }
      probe(socket);
    },
    get status() {
      return status;
    },
    get clockOffset() {
      return clock.offset;
    },
    get authed() {
      return authed;
    },
  };
}
