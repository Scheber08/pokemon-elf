/**
 * Standardnamen („Trainer"): Gewertete Runs nur mit eigenem Namen, Teamname Pflicht,
 * Ranglisten ohne Standardnamen und die einmalige Bereinigung alter Ranglisten-Daten.
 * Echte Requests durch handleApi, D1 simuliert mit node:sqlite (tests/d1shim.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanPlayerName,
  DEFAULT_PLAYER_NAME,
  isDefaultPlayerName,
  PLAYER_NAME_MAX,
  type ApiErrorBody,
  type DeviceAuth,
  type FinishRunResponse,
  type LeaderboardResponse,
  type StartRunResponse,
} from '../src/lib/api/contract';
import {
  candidates,
  createEngineData,
  isComplete,
  isFreeSlot,
  legendBlocked,
  place,
  startRun,
  type RunConfig,
  type RunState,
} from '../src/lib/challengeEngine';
import { dayKey } from '../src/lib/daily';
import type { ChallengeKey } from '../src/types';
import { DEFAULT_PLAYER } from '../server/auth';
import { ALL_TIME_SCOPE, cleanupDefaultNames, DEFAULT_NAMES_CLEANUP_KEY, UPSERT_BEST_SQL } from '../server/db';
import type { Db, DbResult, DbStatement } from '../server/env';
import { handleApi, type Env } from '../server/handler';
import { parsePlayerName } from '../server/validate';
import { D1Shim } from './d1shim';
import { ALL } from './helpers';

const DATA = createEngineData(ALL);
const HOUR = 3_600_000;

let db: D1Shim;
let env: Env;

beforeEach(() => {
  db = new D1Shim();
  env = { DB: db };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------- Helfer

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

const newDevice = (): DeviceAuth => ({ deviceId: crypto.randomUUID(), deviceSecret: hex(32) });

async function call<T = unknown>(method: string, path: string, body?: unknown, e: Env = env) {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await handleApi(new Request(`http://localhost${path}`, init), e);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, text };
}

const post = <T = unknown>(path: string, body: unknown) => call<T>('POST', path, body);
const get = <T = unknown>(path: string) => call<T>('GET', path);

const rename = (dev: DeviceAuth, player: unknown) => post<ApiErrorBody & { ok?: boolean }>('/api/player', { ...dev, player });
const start = (dev: DeviceAuth, challenge: ChallengeKey = 'c340') =>
  post<StartRunResponse & ApiErrorBody>('/api/runs/start', { ...dev, challenge });
const board = (q: string) => get<LeaderboardResponse>(`/api/leaderboard?${q}`);
const nameOf = (deviceId: string) =>
  db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', deviceId.toLowerCase())[0]?.name;

/** Spielt einen Run automatisch: erste wählbare Wahl, erster freier Slot. */
function autoPlay(config: RunConfig): RunState {
  let s = startRun(config, DATA);
  while (!isComplete(s)) {
    const pick = candidates(s, DATA).filter((p) => !legendBlocked(s, p, DATA))[0];
    s = place(s, pick.id, s.slots.findIndex((_, i) => isFreeSlot(s, i)), DATA);
  }
  return s;
}

function finishBody(dev: DeviceAuth, token: string, state: RunState, over: { teamName?: unknown; player?: unknown } = {}) {
  return {
    ...dev,
    token,
    formation: state.config.formation,
    ssEnabled: state.config.ssEnabled,
    picks: state.picks,
    teamName: 'teamName' in over ? over.teamName : 'Test-Elf',
    player: 'player' in over ? over.player : 'Ash',
  };
}

/** Gestarteter Run (Gerät muss benannt sein) samt lokal gespieltem Zustand. */
async function started(dev: DeviceAuth, challenge: ChallengeKey = 'c340') {
  const s = await start(dev, challenge);
  expect(s.status, s.text).toBe(200);
  const state = autoPlay({ challenge, formation: '4-3-3', ssEnabled: false, seed: s.body.seed });
  return { token: s.body.token, state };
}

/** Kompletter gewerteter Run eines benannten Geräts. */
async function playNamed(dev: DeviceAuth, name: string, challenge: ChallengeKey = 'c340') {
  expect((await rename(dev, name)).status).toBe(200);
  const { token, state } = await started(dev, challenge);
  const finish = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, token, state, { player: name }));
  expect(finish.status, finish.text).toBe(200);
  return { token, state, finish: finish.body };
}

let synth = 0;
/** Eintrag direkt in der DB (samt Gerät und Bestwerten wie insertEntry) – z. B. „vor dem Deploy". */
function insertEntryRow(
  deviceId: string,
  name: string,
  e: { points: number; score?: number; createdAt?: number; day?: string; challenge?: ChallengeKey },
): string {
  const createdAt = e.createdAt ?? Date.now() - HOUR;
  const day = e.day ?? dayKey();
  const challenge = e.challenge ?? 'c340';
  db.update(
    'INSERT OR IGNORE INTO devices (id, secret_hash, name, ip_hash, created_at) VALUES (?, ?, ?, NULL, ?)',
    deviceId,
    hex(32),
    name,
    createdAt,
  );
  const id = `entry-${++synth}`;
  db.update(
    `INSERT INTO entries (id, device_id, challenge, day, formation, ss_enabled, picks_json, lineup_json, team_name,
       score, wins, draws, losses, points, season_seed, created_at)
     VALUES (?, ?, ?, ?, '4-3-3', 0, '[]', '[]', 'Synth', ?, 10, 4, 20, ?, 1, ?)`,
    id,
    deviceId,
    challenge,
    day,
    e.score ?? 500,
    e.points,
    createdAt,
  );
  for (const scope of [ALL_TIME_SCOPE, day]) {
    db.update(UPSERT_BEST_SQL, challenge, scope, deviceId, id, e.points, e.score ?? 500, createdAt);
  }
  return id;
}

/** Gewerteter Token zu einem Eintrag (wie nach finish). */
function insertFinishedToken(deviceId: string, entryId: string, challenge: ChallengeKey = 'c340'): string {
  const token = hex(32);
  db.update(
    'INSERT INTO run_tokens (token, device_id, challenge, seed, day, created_at, finished_at, entry_id) VALUES (?, ?, ?, 1, ?, ?, ?, ?)',
    token,
    deviceId,
    challenge,
    dayKey(),
    Date.now() - HOUR,
    Date.now() - HOUR + 1000,
    entryId,
  );
  return token;
}

const count = (sql: string, ...params: (string | number)[]) => db.query(sql, ...params).length;
const cleanupDone = () => count('SELECT 1 FROM meta WHERE key = ?', DEFAULT_NAMES_CLEANUP_KEY) === 1;

/** Bereinigung als erledigt vermerken – dann testen Ranglisten-Tests den Filter, nicht die Bereinigung. */
const markCleanupDone = () => db.update('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', DEFAULT_NAMES_CLEANUP_KEY, 'test');

interface IsolateOpts {
  /** Diese Anweisungen scheitern erst beim Ausführen im Batch (davor Ausgeführtes wird zurückgerollt) */
  failOn?: (sql: string) => boolean;
  /** Der Blick in meta findet nichts – wie zwei Isolates, die gleichzeitig nachsehen */
  blindCheck?: boolean;
  /** Läuft nach jedem all() – z. B. eine parallele Anfrage zwischen Lesen und Batch */
  afterAll?: (sql: string) => void;
}

class IsolateStatement implements DbStatement {
  constructor(
    readonly inner: DbStatement,
    readonly sql: string,
    private readonly owner: IsolateDb,
  ) {}

  bind(...values: unknown[]): DbStatement {
    return new IsolateStatement(this.inner.bind(...values), this.sql, this.owner);
  }

  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(colName: string): Promise<T | null>;
  async first<T>(colName?: string): Promise<T | null> {
    this.owner.sql.push(this.sql);
    if (this.owner.opts.blindCheck && this.sql.startsWith('SELECT 1 AS x FROM meta')) return null;
    return colName === undefined ? this.inner.first<T>() : this.inner.first<T>(colName);
  }

  async all<T = Record<string, unknown>>(): Promise<DbResult<T>> {
    this.owner.sql.push(this.sql);
    const res = await this.inner.all<T>();
    this.owner.opts.afterAll?.(this.sql);
    return res;
  }

  run<T = Record<string, unknown>>(): Promise<DbResult<T>> {
    this.owner.sql.push(this.sql);
    return this.inner.run<T>();
  }
}

/** Ein weiteres Isolate: eigenes Binding um dieselbe Datenbank (ensureSchema merkt sich pro Binding). */
class IsolateDb implements Db {
  readonly sql: string[] = [];

  constructor(
    readonly inner: D1Shim,
    readonly opts: IsolateOpts = {},
  ) {}

  prepare(query: string): DbStatement {
    return new IsolateStatement(this.inner.prepare(query), query, this);
  }

  async batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]> {
    const real = statements.map((st) => {
      const { sql, inner } = st as IsolateStatement;
      this.sql.push(sql);
      if (!this.opts.failOn?.(sql)) return inner;
      const failing = {
        execute() {
          throw new Error('D1_ERROR: simuliert');
        },
      };
      return failing as unknown as DbStatement;
    });
    return this.inner.batch<T>(real);
  }
}

const isolate = (opts: IsolateOpts = {}) => new IsolateDb(db, opts);

// ---------------------------------------------------------------- Vertrag

/**
 * „Trainer" mit unsichtbaren Zusätzen, die cleanText stehen lässt (Kombinationszeichen, keine
 * Formatzeichen), und Vollbreite/mathematische Buchstaben – sieht in der Liste aus wie „Trainer".
 */
const DISGUISED_TRAINERS = [
  'Trainer\uFE0F', // Variantenwähler-16
  'Trainer\u034F', // Combining Grapheme Joiner
  'T\u034Frainer',
  'Trainer\u{E0100}', // Variantenwähler-17 (Supplement)
  'Trainer\u17B4', // Khmer: unsichtbarer Vokal
  'Trainer\u180B', // Mongolischer Variantenwähler
  'TRA\u0130NER', // Großes I mit Punkt: klein „i" + Kombinationspunkt
  '\uFF34\uFF52\uFF41\uFF49\uFF4E\uFF45\uFF52', // Vollbreite
  '\u{1D413}\u{1D42B}\u{1D41A}\u{1D422}\u{1D427}\u{1D41E}\u{1D42B}', // mathematisch fett
  'Trainer\u2800', // leere Braille-Zelle
];

describe('isDefaultPlayerName / cleanPlayerName', () => {
  it('Standardnamen: leer oder „Trainer" (Groß-/Kleinschreibung und Leerraum egal)', () => {
    for (const name of ['', '   ', '\t\n', null, undefined, 'Trainer', 'trainer', 'TRAINER', ' TrAiNeR ', ' Trainer　']) {
      expect(isDefaultPlayerName(name), JSON.stringify(name)).toBe(true);
    }
    for (const name of ['Ash', 'Trainer Ash', 'Trainerin', 'Tra iner', 'Trainer1', '⚽', '0', 'Trainér', 'Müller']) {
      expect(isDefaultPlayerName(name), name).toBe(false);
    }
    expect(DEFAULT_PLAYER).toBe(DEFAULT_PLAYER_NAME);
    expect(isDefaultPlayerName(DEFAULT_PLAYER)).toBe(true);
  });

  it('unsichtbare Zusätze, Vollbreite und Format-/Steuerzeichen machen „Trainer" nicht zum eigenen Namen', () => {
    const more = ['Train\u200Ber', '\u200BTrainer\u00AD', 'Train\u0007er', 'Trainer\u0332', '\u3164', '\uFE0F'];
    for (const name of [...DISGUISED_TRAINERS, ...more]) {
      expect(isDefaultPlayerName(name), JSON.stringify(name)).toBe(true);
    }
  });

  it('cleanPlayerName fasst Leerraum zusammen, trimmt und kürzt auf PLAYER_NAME_MAX Zeichen', () => {
    expect(PLAYER_NAME_MAX).toBe(24);
    expect(cleanPlayerName('  Ash   Ketchum \n')).toBe('Ash Ketchum');
    expect(cleanPlayerName('x'.repeat(30))).toBe('x'.repeat(PLAYER_NAME_MAX));
    // Kürzen trennt keine Emoji (Codepoints) und lässt keinen Leerraum am Ende.
    expect(cleanPlayerName('⚽'.repeat(30))).toBe('⚽'.repeat(PLAYER_NAME_MAX));
    expect(cleanPlayerName(`${'a'.repeat(23)} b`)).toBe('a'.repeat(23));
    expect(cleanPlayerName('   ')).toBe('');
  });
});

// ---------------------------------------------------------------- POST /api/player

describe('POST /api/player: kein Standardname', () => {
  it('„Trainer" in jeder Schreibweise und leere Namen → 400 bad_name, Name bleibt', async () => {
    const dev = newDevice();
    expect((await rename(dev, 'Misty')).status).toBe(200);
    for (const player of ['Trainer', 'trainer', ' TRAINER ', 'Trainer​', 'ㅤTrainer', '', '   ', '​']) {
      const res = await rename(dev, player);
      expect([res.status, res.body.error], JSON.stringify(player)).toEqual([400, 'bad_name']);
      expect(res.body.message).toMatch(/bitte wähle einen eigenen Namen/);
    }
    expect(nameOf(dev.deviceId)).toBe('Misty');
    expect((await rename(dev, 'Trainer Rot')).status).toBe(200);
    expect(nameOf(dev.deviceId)).toBe('Trainer Rot');
    // Ein vorkomponierter Akzent ist ein sichtbar anderer Buchstabe – ein eigener Name.
    expect((await rename(dev, 'Trainér')).status).toBe(200);
    expect(nameOf(dev.deviceId)).toBe('Trainér');
  });

  it('„Trainer" mit unsichtbaren Kombinationszeichen oder in Vollbreite → 400 bad_name, kein Run', async () => {
    const dev = newDevice();
    for (const player of DISGUISED_TRAINERS) {
      const res = await rename(dev, player);
      expect([res.status, res.body.error], JSON.stringify(player)).toEqual([400, 'bad_name']);
    }
    // Nie gespeichert (das Gerät wurde gar nicht erst angelegt) – ein Start bleibt gesperrt.
    expect(db.query('SELECT * FROM devices')).toHaveLength(0);
    expect((await start(dev)).body.error).toBe('name_required');
    expect(db.query('SELECT * FROM run_tokens')).toHaveLength(0);
  });

  it('ein abgelehnter Name registriert kein Gerät; andere Fehler bleiben bad_request', async () => {
    const dev = newDevice();
    expect((await rename(dev, 'Trainer')).status).toBe(400);
    expect(db.query('SELECT * FROM devices')).toHaveLength(0);
    for (const player of ['-_-', 'x'.repeat(PLAYER_NAME_MAX + 1), 42]) {
      expect((await rename(dev, player)).body.error, String(player)).toBe('bad_request');
    }
    expect(() => parsePlayerName('trainer')).toThrow(/Standardname/);
  });
});

// ---------------------------------------------------------------- POST /api/runs/start

describe('POST /api/runs/start: nur mit eigenem Namen', () => {
  it('neues Gerät (heißt „Trainer") → 400 name_required, kein Token – nach dem Benennen klappt es', async () => {
    const dev = newDevice();
    for (const challenge of ['c340', 'daily', 'retro340', 'c151'] as ChallengeKey[]) {
      const res = await start(dev, challenge);
      expect([res.status, res.body.error], challenge).toEqual([400, 'name_required']);
      expect(res.body.message).toBe('Bitte wähle zuerst deinen Namen für die Rangliste');
    }
    // Das Gerät ist registriert (mit Standardnamen), einen Token gibt es nicht.
    expect(nameOf(dev.deviceId)).toBe(DEFAULT_PLAYER);
    expect(db.query('SELECT * FROM run_tokens')).toHaveLength(0);

    expect((await rename(dev, 'Brock')).status).toBe(200);
    for (const challenge of ['c340', 'daily', 'retro340', 'c151'] as ChallengeKey[]) {
      expect((await start(dev, challenge)).status, challenge).toBe(200);
    }
    expect(db.query('SELECT * FROM run_tokens')).toHaveLength(4);
  });

  it('gilt auch für Standardnamen in anderer Schreibweise (z. B. aus älteren Daten)', async () => {
    const dev = newDevice();
    expect((await rename(dev, 'Erika')).status).toBe(200);
    for (const name of ['trainer', ' TRAINER ', '', ...DISGUISED_TRAINERS]) {
      db.update('UPDATE devices SET name = ? WHERE id = ?', name, dev.deviceId);
      expect((await start(dev)).body.error, JSON.stringify(name)).toBe('name_required');
    }
  });

  it('falscher Schlüssel bleibt 401 (die Namensprüfung verrät nichts über fremde Geräte)', async () => {
    const dev = newDevice();
    await start(dev);
    const res = await start({ ...dev, deviceSecret: hex(32) });
    expect([res.status, res.body.error]).toEqual([401, 'unauthorized']);
  });
});

// ---------------------------------------------------------------- POST /api/runs/finish

describe('POST /api/runs/finish', () => {
  it('ein Standardname beim Abschluss setzt den eigenen Namen nicht zurück', async () => {
    const dev = newDevice();
    expect((await rename(dev, 'Rocko')).status).toBe(200);
    const { token, state } = await started(dev);
    const res = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, token, state, { player: ' trainer ' }));
    expect(res.status).toBe(200);
    expect(nameOf(dev.deviceId)).toBe('Rocko');
    // Auch nicht mit „Trainer" samt unsichtbarem Zusatz
    const next = await started(dev);
    const again = await post('/api/runs/finish', finishBody(dev, next.token, next.state, { player: 'Trainer\u034F' }));
    expect(again.status).toBe(200);
    expect(nameOf(dev.deviceId)).toBe('Rocko');
    expect((await board('challenge=c340')).body.rows.map((r) => r.player)).toEqual(['Rocko']);
  });

  it('Wiederholung eines gewerteten Runs bekommt ihr Ergebnis auch ohne Teamnamen', async () => {
    const dev = newDevice();
    const { token, state, finish } = await playNamed(dev, 'Gary');
    const again = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, token, state, { teamName: '' }));
    expect(again.status).toBe(200);
    expect(again.body).toEqual(finish);
  });

  it('alter, offener Token eines „Trainer"-Geräts: mit eigenem Namen gewertet, sonst gespeichert, aber unsichtbar', async () => {
    // Zwei Geräte, die vor dem Deploy (noch ohne Namenspflicht) gestartet haben.
    const [named, anon] = [newDevice(), newDevice()];
    const runs = [];
    for (const dev of [named, anon]) {
      expect((await rename(dev, 'Vorher')).status).toBe(200);
      runs.push(await started(dev));
      db.update('UPDATE devices SET name = ? WHERE id = ?', DEFAULT_PLAYER, dev.deviceId);
    }
    const a = await post<FinishRunResponse>('/api/runs/finish', finishBody(named, runs[0].token, runs[0].state, { player: 'Lt. Surge' }));
    expect(a.status).toBe(200);
    expect([a.body.rankToday, a.body.rankAllTime]).toEqual([1, 1]);
    expect(nameOf(named.deviceId)).toBe('Lt. Surge');

    const b = await post<FinishRunResponse>('/api/runs/finish', finishBody(anon, runs[1].token, runs[1].state, { player: 'Trainer' }));
    expect(b.status).toBe(200);
    expect([b.body.rankToday, b.body.rankAllTime]).toEqual([null, null]);
    expect(nameOf(anon.deviceId)).toBe(DEFAULT_PLAYER);
    const list = await board(`challenge=c340&period=all&me=${anon.deviceId}`);
    expect(list.body.rows.map((r) => r.player)).toEqual(['Lt. Surge']);
    expect(list.body.players).toBe(1);
    expect(list.body.mine).toBeNull();
  });
});

// ---------------------------------------------------------------- Rangliste

describe('Rangliste ohne Standardnamen', () => {
  it('nach der Bereinigung: Liste, Spielerzahl, eigene Zeile und Plätze ohne Standardnamen – Plätze passen zur Liste', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const t = Date.now() - 2 * HOUR;
    const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'a7'].map((x) => x.repeat(16));
    // Stand vor dem Deploy: Bessere Runs der Standardnamen (auch getarnter) liegen zwischen den echten Spielern.
    insertEntryRow(ids[0], 'Trainer', { points: 99, createdAt: t });
    const anna = insertEntryRow(ids[1], 'Anna', { points: 90, createdAt: t + 1 });
    insertEntryRow(ids[2], 'trainer', { points: 85, createdAt: t + 2 });
    const ben = insertEntryRow(ids[3], 'Ben', { points: 80, createdAt: t + 3 });
    insertEntryRow(ids[4], '', { points: 80, score: 900, createdAt: t + 4 });
    insertEntryRow(ids[6], 'Trainer\uFE0F', { points: 75, createdAt: t + 6 });
    const cleo = insertEntryRow(ids[5], 'Trainer Cleo', { points: 70, createdAt: t + 5 });

    for (const period of ['all', 'today']) {
      const res = await board(`challenge=c340&period=${period}`);
      expect(res.status).toBe(200);
      expect(res.body.players, period).toBe(3);
      expect(res.body.rows.map((r) => [r.rank, r.player, r.entryId])).toEqual([
        [1, 'Anna', anna],
        [2, 'Ben', ben],
        [3, 'Trainer Cleo', cleo],
      ]);
      // Eigene Zeile außerhalb des Limits: Platz wie in der Liste.
      const mine = await board(`challenge=c340&period=${period}&limit=1&me=${ids[5]}`);
      expect(mine.body.mine).toMatchObject({ rank: 3, player: 'Trainer Cleo', me: true });
      // Standardnamen haben keine eigene Zeile.
      for (const id of [ids[0], ids[2], ids[4], ids[6]]) {
        const hidden = await board(`challenge=c340&period=${period}&me=${id}`);
        expect(hidden.body.mine).toBeNull();
        expect(hidden.body.rows.some((r) => r.me)).toBe(false);
      }
    }
    // Bestwerte gibt es nur noch für die drei echten Spieler (Allzeit + Tag).
    expect(db.query('SELECT DISTINCT device_id FROM best_entries ORDER BY device_id')).toEqual(
      [ids[1], ids[3], ids[5]].sort().map((device_id) => ({ device_id })),
    );
    expect(count('SELECT * FROM best_entries')).toBe(6);
  });

  it('Platz nach einem Abschluss zählt Standardnamen nicht mit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const t = Date.now() - HOUR;
    for (let i = 0; i < 4; i++) insertEntryRow(`${i}`.repeat(32), 'Trainer', { points: 102 - i, createdAt: t + i });
    insertEntryRow('9'.repeat(32), 'Profi', { points: 102, score: 999, createdAt: t });
    const { finish } = await playNamed(newDevice(), 'Neuling');
    expect([finish.rankToday, finish.rankAllTime]).toEqual([2, 2]);
    const res = await board('challenge=c340&period=today');
    expect(res.body.players).toBe(2);
    expect(res.body.rows.map((r) => [r.rank, r.player])).toEqual([
      [1, 'Profi'],
      [2, 'Neuling'],
    ]);
  });

  it('Run eines unbenannten Geräts (alter Token): gespeichert, aber ohne Bestwerte – nach dem Benennen zählt erst der nächste Run', async () => {
    const dev = newDevice();
    expect((await rename(dev, 'Vorher')).status).toBe(200);
    const old = await started(dev);
    db.update('UPDATE devices SET name = ? WHERE id = ?', DEFAULT_PLAYER, dev.deviceId);
    const res = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, old.token, old.state, { player: 'Trainer' }));
    expect(res.status).toBe(200);
    expect([res.body.rankToday, res.body.rankAllTime]).toEqual([null, null]);
    expect(count('SELECT * FROM entries WHERE device_id = ?', dev.deviceId)).toBe(1);
    expect(count('SELECT * FROM best_entries WHERE device_id = ?', dev.deviceId)).toBe(0);

    // Benennen allein bringt den alten Run nicht in die Liste …
    expect((await rename(dev, 'Spätzünder')).status).toBe(200);
    const before = await board(`challenge=c340&period=all&me=${dev.deviceId}`);
    expect([before.body.players, before.body.rows.length, before.body.mine]).toEqual([0, 0, null]);
    // … der nächste Run schon.
    const { finish } = await playNamed(dev, 'Spätzünder');
    expect(finish.rankAllTime).toBe(1);
    const after = await board(`challenge=c340&period=all&me=${dev.deviceId}`);
    expect(after.body.players).toBe(1);
    expect(after.body.rows.map((r) => [r.rank, r.player, r.entryId])).toEqual([[1, 'Spätzünder', finish.entryId]]);
  });

  it('Liste und eigene Zeile prüfen den Namen zusätzlich (falls doch ein Bestwert ohne Namen da ist)', async () => {
    markCleanupDone(); // z. B. Bereinigung gescheitert – die Liste zeigt trotzdem keinen „Trainer"
    const hidden = 'ab'.repeat(16);
    insertEntryRow(hidden, 'Trainer', { points: 60 });
    insertEntryRow('cd'.repeat(16), 'Lorelei', { points: 50 });
    const res = await board(`challenge=c340&me=${hidden}`);
    expect(res.body.rows.map((r) => [r.rank, r.player])).toEqual([[1, 'Lorelei']]);
    expect(res.body.mine).toBeNull();
  });

  it('Plätze und Spielerzahl zählen nur im Index – ohne Tabellen- oder Geräte-Zugriff je Zeile', async () => {
    const t = Date.now() - HOUR;
    for (let i = 0; i < 60; i++) {
      insertEntryRow(`${i}`.padStart(32, 'e'), `Spieler ${i}`, { points: i % 40, createdAt: t + i });
    }
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await get('/api/health'); // Schema und Bereinigung vor der Messung
    const dev = newDevice();
    db.executed.length = 0;
    await playNamed(dev, 'Messung');
    expect((await board(`challenge=c340&period=today&me=${dev.deviceId}&limit=5`)).body.mine).not.toBeNull();

    const ranks = db.executed.filter((e) => e.sql.includes('AS pos'));
    const counts = db.executed.filter((e) => /SELECT COUNT\(\*\) AS n FROM best_entries/.test(e.sql));
    expect(ranks.length).toBe(3); // zwei nach dem Abschluss (Tag + Allzeit), eins für die eigene Zeile
    expect(counts).toHaveLength(1);
    for (const { sql, params } of [...ranks, ...counts]) {
      const plan = db.plan(sql, ...params);
      const detail = `${sql}\n→ ${plan.join('\n→ ')}`;
      // Jede Zählung (bessere Zeilen bzw. alle Zeilen) liest nur idx_best_entries_rank.
      const counting = plan.filter((l) => /^SEARCH (o|best_entries) /.test(l));
      expect(counting.length, detail).toBeGreaterThan(0);
      for (const l of counting) expect(l, detail).toMatch(/USING COVERING INDEX idx_best_entries_rank/);
      // Geräte höchstens einmal – für die gelieferte Zeile selbst, nicht je gezählter Zeile;
      // die Spielerzahl braucht gar keine.
      const deviceReads = plan.filter((l) => /^SEARCH (d|od|devices) /.test(l)).length;
      expect(deviceReads, detail).toBeLessThanOrEqual(sql.includes('AS pos') ? 1 : 0);
    }
  });
});

// ---------------------------------------------------------------- Bereinigung

describe('einmalige Bereinigung der Standardnamen', () => {
  /** Stand „vor dem Deploy": Standardnamen und echte Spieler, mit Tokens, Tages-Elf und Draft-Lobby. */
  function seedBeforeDeploy() {
    const day = dayKey();
    const trainer = 'aa'.repeat(16);
    const lower = 'bb'.repeat(16);
    const empty = 'cc'.repeat(16);
    const misty = 'dd'.repeat(16);
    const tEntries = [
      insertEntryRow(trainer, 'Trainer', { points: 99 }),
      insertEntryRow(trainer, 'Trainer', { points: 50, challenge: 'daily', day }),
      insertEntryRow(trainer, 'Trainer', { points: 40, day: '2026-01-01' }),
    ];
    const lEntry = insertEntryRow(lower, ' TRAINER ', { points: 98, challenge: 'c151' });
    const eEntry = insertEntryRow(empty, '', { points: 97 });
    const mEntries = [insertEntryRow(misty, 'Misty', { points: 70 }), insertEntryRow(misty, 'Misty', { points: 60, challenge: 'daily', day })];
    const tokens = {
      trainerDone: insertFinishedToken(trainer, tEntries[0]),
      mistyDone: insertFinishedToken(misty, mEntries[0]),
      trainerOpen: hex(32),
    };
    db.update(
      "INSERT INTO run_tokens (token, device_id, challenge, seed, day, created_at) VALUES (?, ?, 'c340', 7, ?, ?)",
      tokens.trainerOpen,
      trainer,
      day,
      Date.now() - HOUR,
    );
    db.update(
      `INSERT INTO draft_lobbies (code, host_device, name, host_name, region, legends, pick_seconds, teams, max_teams,
         visibility, phase, created_at, updated_at) VALUES ('ABCD', ?, 'Liga', 'Trainer', 0, 1, 60, 1, 8, 'public', 'lobby', 1, 1)`,
      trainer,
    );
    db.update("INSERT INTO meta (key, value) VALUES ('ip_salt', 'salz')");
    return { trainer, lower, empty, misty, tEntries, lEntry, eEntry, mEntries, tokens };
  }

  it('löscht beim ersten Aufruf nach dem Deploy genau die Ranglisten-Daten der Standardnamen', async () => {
    const s = seedBeforeDeploy();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const before = {
      devices: db.query('SELECT * FROM devices ORDER BY id'),
      drafts: db.query('SELECT * FROM draft_lobbies'),
    };
    expect(cleanupDone()).toBe(false);

    expect((await get('/api/health')).status).toBe(200);

    expect(cleanupDone()).toBe(true);
    // Nur noch Mistys Einträge und Bestwerte.
    expect(db.query<{ id: string }>('SELECT id FROM entries ORDER BY id').map((r) => r.id)).toEqual([...s.mEntries].sort());
    expect(db.query<{ device_id: string }>('SELECT DISTINCT device_id FROM best_entries').map((r) => r.device_id)).toEqual([s.misty]);
    expect(count('SELECT * FROM best_entries')).toBe(4);
    // Geräte, Draft-Lobby und andere meta-Werte bleiben unverändert.
    expect(db.query('SELECT * FROM devices ORDER BY id')).toEqual(before.devices);
    expect(db.query('SELECT * FROM draft_lobbies')).toEqual(before.drafts);
    expect(db.query("SELECT value FROM meta WHERE key = 'ip_salt'")).toEqual([{ value: 'salz' }]);
    // Tokens: nur der gewertete Token des gelöschten Eintrags ist weg.
    const tokens = db.query<{ token: string }>('SELECT token FROM run_tokens').map((r) => r.token);
    expect(tokens.sort()).toEqual([s.tokens.mistyDone, s.tokens.trainerOpen].sort());
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/5 Einträge, 9 Bestwerte und 1 Run-Tokens/));
  });

  it('läuft nur einmal pro Datenbank – auch nicht erneut in weiteren Isolates', async () => {
    seedBeforeDeploy();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect((await get('/api/health')).status).toBe(200);
    const [{ value }] = db.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', DEFAULT_NAMES_CLEANUP_KEY);
    expect(new Date(value).toISOString()).toBe(value);

    // Neue „Trainer"-Daten danach (z. B. ein alter Token) bleiben – sie sind nur unsichtbar.
    const late = insertEntryRow('ee'.repeat(16), 'Trainer', { points: 10 });
    const second = isolate();
    expect((await call('GET', '/api/health', undefined, { DB: second })).status).toBe(200);
    expect(second.sql.filter((q) => q.startsWith('DELETE'))).toEqual([]);
    expect(second.sql.filter((q) => q.includes('FROM meta WHERE key'))).toHaveLength(1);
    expect(count('SELECT * FROM entries WHERE id = ?', late)).toBe(1);
    // Pro Isolate nur ein Blick in meta, nicht bei jeder Anfrage.
    await call('GET', '/api/health', undefined, { DB: second });
    await call('GET', '/api/leaderboard?challenge=c340', undefined, { DB: second });
    expect(second.sql.filter((q) => q.includes('FROM meta WHERE key'))).toHaveLength(1);
    expect(await cleanupDefaultNames(db, Date.now())).toBeNull();
    expect(count('SELECT * FROM meta WHERE key = ?', DEFAULT_NAMES_CLEANUP_KEY)).toBe(1);
  });

  it('zwei Isolates gleichzeitig: Der zweite Batch löscht nichts mehr (Schlüssel wird im Batch geprüft)', async () => {
    seedBeforeDeploy();
    const first = await cleanupDefaultNames(db, Date.now());
    expect(first).toEqual({ entries: 5, bestEntries: 9, tokens: 1 });
    // Daten, die erst danach entstehen, darf ein verspäteter zweiter Batch nicht anrühren.
    const late = insertEntryRow('ee'.repeat(16), 'Trainer', { points: 10 });
    const lateToken = insertFinishedToken('ee'.repeat(16), late);
    const blind = isolate({ blindCheck: true });
    expect(await cleanupDefaultNames(blind, Date.now())).toEqual({ entries: 0, bestEntries: 0, tokens: 0 });
    expect(blind.sql.filter((q) => q.startsWith('DELETE'))).toHaveLength(3);
    expect(count('SELECT * FROM entries WHERE id = ?', late)).toBe(1);
    expect(count('SELECT * FROM best_entries WHERE entry_id = ?', late)).toBe(2);
    expect(count('SELECT * FROM run_tokens WHERE token = ?', lateToken)).toBe(1);
    expect(count('SELECT * FROM meta WHERE key = ?', DEFAULT_NAMES_CLEANUP_KEY)).toBe(1);
  });

  it('atomar: Scheitert eine Löschung, bleibt alles stehen; die API läuft weiter, der nächste Aufruf holt es nach', async () => {
    seedBeforeDeploy();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const snapshot = () => ({
      entries: count('SELECT * FROM entries'),
      best: count('SELECT * FROM best_entries'),
      tokens: count('SELECT * FROM run_tokens'),
    });
    const before = snapshot();
    const flaky = isolate({ failOn: (q) => q.startsWith('DELETE FROM entries') });
    const res = await call<LeaderboardResponse>('GET', '/api/leaderboard?challenge=c340', undefined, { DB: flaky });
    // Die ersten Löschungen liefen schon im Batch, bevor die dritte scheiterte – alles zurückgerollt.
    expect(flaky.sql.filter((q) => q.startsWith('DELETE'))).toHaveLength(3);
    // Die Anfrage selbst klappt – und zeigt trotzdem keine Standardnamen.
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => r.player)).toEqual(['Misty']);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/cleanup:default-names-v1 gescheitert/), expect.any(Error));
    expect(snapshot()).toEqual(before);
    expect(cleanupDone()).toBe(false);

    // Nächster Aufruf im selben Isolate versucht es erneut (jetzt ohne Fehler).
    flaky.opts.failOn = undefined;
    expect((await call('GET', '/api/health', undefined, { DB: flaky })).status).toBe(200);
    expect(cleanupDone()).toBe(true);
    expect(snapshot()).toEqual({ entries: 2, best: 4, tokens: 2 });
  });

  it('erkennt auch getarnte „Trainer" (unsichtbare Zusätze, Vollbreite) – andere Nicht-ASCII-Namen bleiben', async () => {
    const [vs16, wide, cgj, mueller, ball] = ['a1', 'b2', 'c3', 'd4', 'e5'].map((x) => x.repeat(16));
    const gone = [
      insertEntryRow(vs16, 'Trainer\uFE0F', { points: 90 }),
      insertEntryRow(vs16, 'Trainer\uFE0F', { points: 40, challenge: 'daily' }),
      insertEntryRow(wide, 'Ｔｒａｉｎｅｒ', { points: 80 }),
      insertEntryRow(cgj, 'T\u034Frainer', { points: 70, challenge: 'c151' }),
    ];
    const doneToken = insertFinishedToken(vs16, gone[0]);
    const kept = [insertEntryRow(mueller, 'Müller', { points: 60 }), insertEntryRow(ball, '⚽ Trainer', { points: 50 })];
    // Ohne Einträge: nichts zu löschen, das Gerät bleibt sowieso.
    db.update("INSERT INTO devices (id, secret_hash, name, created_at) VALUES (?, 'x', 'Trainer\u17B4', 1)", 'f6'.repeat(16));
    const devices = db.query('SELECT * FROM devices ORDER BY id');

    expect(await cleanupDefaultNames(db, Date.now())).toEqual({ entries: 4, bestEntries: 8, tokens: 1 });
    expect(db.query<{ id: string }>('SELECT id FROM entries ORDER BY id').map((r) => r.id)).toEqual([...kept].sort());
    expect(count('SELECT * FROM best_entries')).toBe(4);
    expect(count('SELECT * FROM run_tokens WHERE token = ?', doneToken)).toBe(0);
    expect(db.query('SELECT * FROM devices ORDER BY id')).toEqual(devices);
  });

  it('wer sich zwischen Lesen der Kandidaten und dem Batch umbenennt, behält seine Runs', async () => {
    const [quick, slow] = ['a1', 'b2'].map((x) => x.repeat(16));
    const quickEntry = insertEntryRow(quick, 'Trainer\uFE0F', { points: 90 });
    insertEntryRow(slow, 'Trainer\u034F', { points: 80 });
    // Parallele Anfrage: quick wählt genau jetzt einen eigenen Namen.
    const racing = isolate({
      afterAll: () => db.update('UPDATE devices SET name = ? WHERE id = ?', 'Blitz', quick),
    });
    expect(await cleanupDefaultNames(racing, Date.now())).toEqual({ entries: 1, bestEntries: 2, tokens: 0 });
    expect(db.query<{ id: string }>('SELECT id FROM entries').map((r) => r.id)).toEqual([quickEntry]);
    expect(count('SELECT * FROM best_entries WHERE device_id = ?', quick)).toBe(2);
  });

  it('leere Datenbank: legt das Schema an und vermerkt die Bereinigung', async () => {
    const empty = new D1Shim(false);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect((await call('GET', '/api/health', undefined, { DB: empty })).status).toBe(200);
    expect(empty.query('SELECT key FROM meta')).toEqual([{ key: DEFAULT_NAMES_CLEANUP_KEY }]);
    expect(console.log).not.toHaveBeenCalled();
    expect((await call('GET', '/api/leaderboard?challenge=daily', undefined, { DB: empty })).status).toBe(200);
  });

  it('erneut gesendeter Abschluss eines gelöschten Runs → sauberes 404, kein neuer Eintrag', async () => {
    // Echter Run vor dem Deploy, danach heißt das Gerät wieder „Trainer" (wie alle unbenannten Geräte).
    const dev = newDevice();
    const { token, state } = await playNamed(dev, 'Kurz');
    db.update('UPDATE devices SET name = ? WHERE id = ?', DEFAULT_PLAYER, dev.deviceId);
    db.update('DELETE FROM meta WHERE key = ?', DEFAULT_NAMES_CLEANUP_KEY);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await cleanupDefaultNames(db, Date.now())).toEqual({ entries: 1, bestEntries: 3, tokens: 1 });

    for (const player of ['Trainer', 'Kurz']) {
      const res = await post<ApiErrorBody>('/api/runs/finish', finishBody(dev, token, state, { player }));
      expect([res.status, res.body.error]).toEqual([404, 'not_found']);
    }
    expect(count('SELECT * FROM entries')).toBe(0);
    expect(nameOf(dev.deviceId)).toBe(DEFAULT_PLAYER);
  });

  it('gelöschte Tägliche Elf: nach dem Benennen ist sie heute noch einmal spielbar (gewollte Folge)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
    const dev = newDevice();
    await playNamed(dev, 'Einmal', 'daily');
    expect((await start(dev, 'daily')).body.error).toBe('already_played');

    db.update('UPDATE devices SET name = ? WHERE id = ?', DEFAULT_PLAYER, dev.deviceId);
    db.update('DELETE FROM meta WHERE key = ?', DEFAULT_NAMES_CLEANUP_KEY);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await cleanupDefaultNames(db, Date.now());
    expect((await start(dev, 'daily')).body.error).toBe('name_required');

    const again = await playNamed(dev, 'Zweimal', 'daily');
    expect(again.finish.day).toBe('2026-10-12');
    expect(count("SELECT * FROM entries WHERE challenge = 'daily'")).toBe(1);
  });
});
