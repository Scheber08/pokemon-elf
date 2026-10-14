/**
 * Bindings des Backends (Cloudflare Worker bzw. Pages Functions).
 *
 * Die Datenbank wird über eine schmale Schnittstelle angesprochen – genau die
 * Teilmenge von D1Database (@cloudflare/workers-types), die der Server nutzt.
 * Dadurch lässt sich der Server ohne Workers-Typen prüfen (App-tsconfig, Tests
 * mit node:sqlite). functions/api/[[route]].ts stellt per Typprüfung sicher,
 * dass das echte D1Database dazu passt. Dasselbe gilt für die Draft-Räume:
 * worker/index.ts prüft, dass DurableObjectNamespace<DraftRoom> zu DraftNamespace passt.
 */
import type { DraftSettings, DraftSnapshot } from '../src/lib/api/draftContract';
import type { DraftState } from '../src/lib/draftEngine';
import type { FormationId } from '../src/types';

/** Ergebnis von run()/all() – wie D1Result. */
export interface DbResult<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}

/** Vorbereitete Anweisung – wie D1PreparedStatement. */
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(colName: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  run<T = Record<string, unknown>>(): Promise<DbResult<T>>;
}

/** Datenbank – wie D1Database. batch() läuft als eine Transaktion. */
export interface Db {
  prepare(query: string): DbStatement;
  batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]>;
}

/** Neue Liga anlegen (RPC an den Draft-Raum, aufgerufen von POST /api/drafts). */
export interface CreateRoomInput {
  code: string;
  /** Geheimer Liga-Seed (32 Zufallsbytes hex; ältere Aufrufer: Zahl) */
  seed: number | string;
  settings: Partial<DraftSettings>;
  /** Gerät des Hosts (schon authentifiziert) */
  deviceId: string;
  teamName: string;
  formation: FormationId;
}

export type CreateRoomResult = { ok: true } | { ok: false; code: string; message: string };

/** Vorlage einer Revanche (ohne Code und Seed) – oder der Code der schon angelegten. */
export type RematchTemplateResult =
  | { ok: true; template: Omit<DraftState, 'code' | 'seed'> }
  | { ok: true; existing: string }
  | { ok: false; code: string; message: string };

/** Stub eines Draft-Raums – wie DurableObjectStub<DraftRoom>, nur die genutzte Teilmenge. */
export interface DraftRoomStub {
  /** WebSocket-Upgrade (GET /api/drafts/:code/ws) */
  fetch(request: Request): Promise<Response>;
  create(input: CreateRoomInput): Promise<CreateRoomResult>;
  /** Schnappschuss für Zuschauer (you = null) – null, wenn es die Liga nicht gibt */
  snapshot(): Promise<DraftSnapshot | null>;
  /** Revanche: Vorlage aus dieser (fertigen) Liga für das Gerät eines Mitglieds */
  /** dead: Code einer früheren Revanche, die es nicht mehr gibt – sie wird ersetzt */
  rematchTemplate(deviceId: string, dead?: string | null): Promise<RematchTemplateResult>;
  /** Revanche: neue Liga aus einer Vorlage (mit Code und Seed) anlegen */
  createFrom(state: DraftState): Promise<CreateRoomResult>;
  /** Revanche merken (der erste Code gilt) – liefert den gültigen Code bzw. null ohne Liga */
  setRematch(code: string, dead?: string | null): Promise<string | null>;
}

/** ID eines Durable Objects (undurchsichtig). */
export interface DraftObjectId {
  toString(): string;
}

/** Namespace der Draft-Räume – wie DurableObjectNamespace<DraftRoom>. */
export interface DraftNamespace {
  idFromName(name: string): DraftObjectId;
  get(id: DraftObjectId): DraftRoomStub;
}

export interface Env {
  /** D1-Datenbank (Binding „DB" – im Cloudflare-Dashboard oder per wrangler.toml) */
  DB: Db;
  /** Durable Objects des Online-Drafts (Binding „DRAFTS") – fehlt z. B. auf Cloudflare Pages */
  DRAFTS?: DraftNamespace;
  /** Kommagetrennte Origins, die die API per CORS nutzen dürfen (sonst nur same-origin) */
  ALLOWED_ORIGINS?: string;
  /** Optionales Geheimnis, mit dem IP-Adressen vor dem Hashen gesalzen werden */
  IP_SALT?: string;
}
