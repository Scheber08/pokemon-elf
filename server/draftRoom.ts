/**
 * Durable Object „DraftRoom" – eine Instanz pro Liga (DRAFTS.idFromName(code)).
 * Dünner Adapter: WebSocket-Hibernation, Storage und Alarm der Laufzeit werden an
 * DraftRoomCore (server/draftCore.ts) weitergereicht, wo die ganze Logik steckt.
 * Diese Datei importiert 'cloudflare:workers' und ist daher nur im Worker-Build dabei.
 */
import { DurableObject } from 'cloudflare:workers';
import type { DraftSnapshot } from '../src/lib/api/draftContract';
import type { DraftState } from '../src/lib/draftEngine';
import { positionFit } from '../src/lib/fit';
import { DraftRoomCore, type ConnAttachment, type DraftConn, type StoredRoom } from './draftCore';
import type { CreateRoomInput, CreateRoomResult, Env, RematchTemplateResult } from './env';
import { DRAFT_LIST, draftScale } from './game';
import { ApiError, errorResponse } from './http';

/** Schlüssel des Raums im Storage (Zustand bzw. Grabstein einer geschlossenen Lobby) */
const ROOM_KEY = 'room';
/** WebSocket.readyState: offen */
const WS_OPEN = 1;

const SCALE = draftScale();
// Fit-Cache schon beim Start des Isolates füllen (alle Profile je Pokémon, ~7 ms) – sonst kostet
// der erste CPU- bzw. Timer-Pick diese Zeit zusätzlich auf das CPU-Limit eines Aufrufs.
for (const p of DRAFT_LIST) positionFit(p, 'TW', SCALE);

export class DraftRoom extends DurableObject<Env> {
  private readonly core: DraftRoomCore;
  /** Eine Hülle pro WebSocket (stabile Identität innerhalb der Isolate-Lebenszeit) */
  private readonly conns = new WeakMap<WebSocket, DraftConn>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const storage = ctx.storage;
    this.core = new DraftRoomCore({
      storage: {
        load: async () => (await storage.get<StoredRoom>(ROOM_KEY)) ?? null,
        save: (rec) => storage.put(ROOM_KEY, rec),
        clear: () => storage.deleteAll(),
      },
      now: () => Date.now(),
      alarm: {
        set: (at) => storage.setAlarm(at),
        clear: () => storage.deleteAlarm(),
      },
      sockets: () => ctx.getWebSockets().map((ws) => this.wrap(ws)),
      env,
      list: DRAFT_LIST,
      scale: SCALE,
    });
  }

  private wrap(ws: WebSocket): DraftConn {
    let conn = this.conns.get(ws);
    if (!conn) {
      conn = {
        attachment: () => (ws.deserializeAttachment() as ConnAttachment | null) ?? null,
        setAttachment: (a) => ws.serializeAttachment(a),
        send: (data) => ws.send(data),
        close: (code, reason) => ws.close(code, reason),
        isOpen: () => ws.readyState === WS_OPEN,
      };
      this.conns.set(ws, conn);
    }
    return conn;
  }

  /** WebSocket-Upgrade (weitergereicht von GET /api/drafts/:code/ws). */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return errorResponse(new ApiError(426, 'bad_request', 'Hier geht es nur per WebSocket weiter', { Upgrade: 'websocket' }));
    }
    if (!(await this.core.exists())) return errorResponse(new ApiError(404, 'not_found', 'Diese Liga gibt es nicht'));
    // Räumt hängende Anmeldungen ab bzw. lässt die älteste unangemeldete Verbindung weichen –
    // abgelehnt wird nur, wenn der Raum hart voll ist (Team-Besitzer finden beim hello Platz).
    const attachment = this.core.admit(request.headers.get('CF-Connecting-IP'));
    if (!attachment) return errorResponse(new ApiError(429, 'rate_limited', 'Zu viele Verbindungen zu dieser Liga'));
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation-API: Die Laufzeit hält den Socket, das Objekt darf zwischendurch schlafen.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.core.message(this.wrap(ws), message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      // Close-Handshake abschließen (ältere Kompatibilitätsdaten antworten nicht selbst).
      ws.close(1000, 'bye');
    } catch {
      // schon geschlossen
    }
    await this.core.disconnect(this.wrap(ws));
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.core.disconnect(this.wrap(ws));
  }

  async alarm(): Promise<void> {
    await this.core.alarm();
  }

  // ------------------------------------------------ RPC (server/drafts.ts)

  async create(input: CreateRoomInput): Promise<CreateRoomResult> {
    return this.core.create(input);
  }

  async snapshot(): Promise<DraftSnapshot | null> {
    return this.core.snapshot();
  }

  async rematchTemplate(deviceId: string, dead: string | null = null): Promise<RematchTemplateResult> {
    return this.core.rematchTemplate(deviceId, dead);
  }

  async createFrom(state: DraftState): Promise<CreateRoomResult> {
    return this.core.createFrom(state);
  }

  async setRematch(code: string, dead: string | null = null): Promise<string | null> {
    return this.core.setRematch(code, dead);
  }

  async discard(): Promise<void> {
    return this.core.discard();
  }
}
