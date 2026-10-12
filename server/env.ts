/**
 * Bindings des Backends (Cloudflare Pages Functions).
 *
 * Die Datenbank wird über eine schmale Schnittstelle angesprochen – genau die
 * Teilmenge von D1Database (@cloudflare/workers-types), die der Server nutzt.
 * Dadurch lässt sich der Server ohne Workers-Typen prüfen (App-tsconfig, Tests
 * mit node:sqlite). functions/api/[[route]].ts stellt per Typprüfung sicher,
 * dass das echte D1Database dazu passt.
 */

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

export interface Env {
  /** D1-Datenbank (Binding „DB" – im Cloudflare-Dashboard oder per wrangler.toml) */
  DB: Db;
  /** Kommagetrennte Origins, die die API per CORS nutzen dürfen (sonst nur same-origin) */
  ALLOWED_ORIGINS?: string;
  /** Optionales Geheimnis, mit dem IP-Adressen vor dem Hashen gesalzen werden */
  IP_SALT?: string;
}
