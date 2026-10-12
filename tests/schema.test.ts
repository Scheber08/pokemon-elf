import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { handleApi } from '../server/handler';
import { SCHEMA_STATEMENTS } from '../server/schema';
import { D1Shim } from './d1shim';

const MIGRATION = readFileSync(fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)), 'utf8');

const normalize = (sql: string) =>
  sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

describe('Datenbank-Schema', () => {
  it('server/schema.ts entspricht migrations/0001_init.sql', () => {
    expect([...SCHEMA_STATEMENTS]).toEqual(normalize(MIGRATION));
  });

  it('legt eine leere Datenbank beim ersten Aufruf selbst an', async () => {
    const db = new D1Shim(false);
    const tables = () => db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables()).toEqual([]);
    const res = await handleApi(new Request('http://localhost/api/health'), { DB: db });
    expect(res.status).toBe(200);
    expect(tables().sort()).toEqual(['best_entries', 'devices', 'entries', 'meta', 'run_tokens']);
    // Ein zweiter Aufruf (gleiches Binding) legt nichts doppelt an und bleibt gesund.
    expect((await handleApi(new Request('http://localhost/api/health'), { DB: db })).status).toBe(200);
  });

  it('ohne D1-Binding meldet /api/health einen Fehler (App spielt dann lokal)', async () => {
    const res = await handleApi(new Request('http://localhost/api/health'), {} as never);
    expect(res.status).toBe(500);
  });
});
