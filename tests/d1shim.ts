/**
 * Minimales D1 auf Basis von node:sqlite – genug für server/ in Tests:
 * prepare().bind().first()/all()/run(), batch() (eine Transaktion) und exec().
 * Wendet die Migrationen aus migrations/*.sql an und protokolliert jede ausgeführte
 * Anweisung samt Parametern (für Tests auf Abfragepläne).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { Db, DbResult, DbStatement } from '../server/env';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Wie D1: undefined ist verboten, Booleans werden zu 0/1. */
function toSql(v: unknown): SQLInputValue {
  if (v === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  throw new Error(`D1_TYPE_ERROR: Type '${typeof v}' not supported`);
}

class ShimStatement implements DbStatement {
  constructor(
    private readonly shim: D1Shim,
    readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): DbStatement {
    return new ShimStatement(this.shim, this.sql, values.map(toSql));
  }

  private stmt(): StatementSync {
    return this.shim.sqlite.prepare(this.sql);
  }

  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(colName: string): Promise<T | null>;
  async first<T>(colName?: string): Promise<T | null> {
    this.shim.executed.push({ sql: this.sql, params: this.params });
    const row = this.stmt().get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName === undefined) return row as T;
    if (!(colName in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${colName})`);
    return row[colName] as T;
  }

  async all<T = Record<string, unknown>>(): Promise<DbResult<T>> {
    return this.execute<T>();
  }

  async run<T = Record<string, unknown>>(): Promise<DbResult<T>> {
    return this.execute<T>();
  }

  /** Synchron ausführen – liefert Zeilen (SELECT/RETURNING) oder die Anzahl geänderter Zeilen. */
  execute<T>(): DbResult<T> {
    this.shim.executed.push({ sql: this.sql, params: this.params });
    const stmt = this.stmt();
    if (stmt.columns().length > 0) {
      return { results: stmt.all(...this.params) as T[], meta: { changes: 0 } };
    }
    const res = stmt.run(...this.params);
    return { results: [], meta: { changes: Number(res.changes) } };
  }
}

export class D1Shim implements Db {
  readonly sqlite: DatabaseSync;
  /** Alle vorbereiteten SQL-Texte (für Tests auf Abfragen) */
  readonly log: string[] = [];
  /** Alle ausgeführten Anweisungen mit ihren Parametern */
  readonly executed: { sql: string; params: SQLInputValue[] }[] = [];

  constructor(migrate = true) {
    this.sqlite = new DatabaseSync(':memory:');
    if (migrate) this.migrate();
  }

  migrate(): void {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) this.sqlite.exec(readFileSync(MIGRATIONS_DIR + f, 'utf8'));
    // Testdatenbanken gelten als nach dem Ranglisten-Neustart (Kapitän) angelegt – sonst löschte
    // der erste API-Aufruf die vorbereiteten Einträge (eigene Tests: captainReset.test.ts).
    this.sqlite.exec("INSERT OR IGNORE INTO meta (key, value) VALUES ('cleanup:captain-reset-v1', '1970-01-01T00:00:00.000Z')");
  }

  prepare(query: string): DbStatement {
    this.log.push(query);
    return new ShimStatement(this, query);
  }

  /** Wie D1: alle Anweisungen in einer Transaktion – bei einem Fehler wird alles zurückgerollt. */
  async batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]> {
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map((s) => (s as ShimStatement).execute<T>());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(query);
    return { count: query.split(';').filter((s) => s.trim()).length, duration: 0 };
  }

  /** Direkter, synchroner Zugriff für Test-Manipulationen. */
  query<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }

  update(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.sqlite.prepare(sql).run(...params).changes);
  }

  /** Abfrageplan (EXPLAIN QUERY PLAN) – eine Zeile pro Schritt, z. B. „SEARCH b USING INDEX …". */
  plan(sql: string, ...params: SQLInputValue[]): string[] {
    return this.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params).map((r) => r.detail);
  }
}
