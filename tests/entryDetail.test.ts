/**
 * GET /api/entries/:id – das Team eines Ranglisten-Eintrags. Echte Requests durch handleApi,
 * D1 simuliert mit node:sqlite (tests/d1shim.ts), Runs gespielt mit derselben challengeEngine
 * wie im Browser.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORMATIONS, FORMATION_IDS } from '../src/config/formations';
import type {
  ApiErrorBody,
  DeviceAuth,
  EntryDetail,
  FinishRunResponse,
  LeaderboardResponse,
  StartRunResponse,
} from '../src/lib/api/contract';
import {
  candidates,
  createEngineData,
  isComplete,
  isFreeSlot,
  legendBlocked,
  place,
  SS_SLOT,
  startRun,
  type RunConfig,
  type RunState,
} from '../src/lib/challengeEngine';
import { dayKey } from '../src/lib/daily';
import type { ChallengeKey, FormationId } from '../src/types';
import {
  ALL_TIME_SCOPE,
  ENTRY_DAY_GRACE_MS,
  ENTRY_DETAIL_SQL,
  entryScopes,
  UPSERT_BEST_SQL,
  type EntryDetailRow,
} from '../server/db';
import { ENTRY_CACHE_CONTROL, parseStoredLineup, toEntryDetail } from '../server/endpoints';
import { handleApi, type Env } from '../server/handler';
import { ENTRY_ID_RE, parseEntryId } from '../server/validate';
import { D1Shim } from './d1shim';
import { ALL } from './helpers';

const DATA = createEngineData(ALL);
const HOUR = 3_600_000;

/** Alle Felder von EntryDetail – die Antwort enthält genau diese. */
const DETAIL_KEYS: (keyof EntryDetail)[] = [
  'challenge',
  'createdAt',
  'day',
  'entryId',
  'formation',
  'player',
  'points',
  'record',
  'score',
  'slots',
  'ss',
  'ssEnabled',
  'teamName',
];

let db: D1Shim;
let env: Env;

beforeEach(() => {
  db = new D1Shim();
  env = { DB: db };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- Helfer

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

const newDevice = (): DeviceAuth => ({ deviceId: crypto.randomUUID(), deviceSecret: hex(32) });

interface Res<T> {
  status: number;
  body: T;
  headers: Headers;
  text: string;
}

async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  e: Env = env,
): Promise<Res<T>> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await handleApi(new Request(`http://localhost${path}`, init), e);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers, text };
}

const post = <T = unknown>(path: string, body: unknown) => call<T>('POST', path, body);
const get = <T = unknown>(path: string, headers?: Record<string, string>) => call<T>('GET', path, undefined, headers);
const entry = (id: string, headers?: Record<string, string>) =>
  get<EntryDetail & ApiErrorBody>(`/api/entries/${id}`, headers);
const board = (q: string) => get<LeaderboardResponse>(`/api/leaderboard?${q}`);

/** Spielt einen Run automatisch: erste wählbare Wahl, erster freier Slot, Standardschütze zuletzt. */
function autoPlay(config: RunConfig): RunState {
  let s = startRun(config, DATA);
  while (!isComplete(s)) {
    const pick = candidates(s, DATA).filter((p) => !legendBlocked(s, p, DATA))[0];
    const free = s.slots.findIndex((_, i) => isFreeSlot(s, i));
    s = place(s, pick.id, free < 0 ? SS_SLOT : free, DATA);
  }
  return s;
}

interface RunSpec {
  challenge?: ChallengeKey;
  formation?: FormationId;
  ssEnabled?: boolean;
  teamName?: string;
  player?: string;
}

/** Kompletter gewerteter Run: Namen setzen → start → lokal spielen → finish. */
async function playOnline(dev: DeviceAuth, spec: RunSpec = {}) {
  const challenge = spec.challenge ?? 'c340';
  const player = spec.player ?? 'Ash';
  expect((await post('/api/player', { ...dev, player })).status).toBe(200);
  const start = await post<StartRunResponse>('/api/runs/start', { ...dev, challenge });
  expect(start.status, start.text).toBe(200);
  const state = autoPlay({
    challenge,
    formation: spec.formation ?? '4-3-3',
    ssEnabled: spec.ssEnabled ?? false,
    seed: start.body.seed,
  });
  const finish = await post<FinishRunResponse>('/api/runs/finish', {
    ...dev,
    token: start.body.token,
    formation: state.config.formation,
    ssEnabled: state.config.ssEnabled,
    picks: state.picks,
    teamName: spec.teamName ?? 'Test-Elf',
    player,
  });
  expect(finish.status, finish.text).toBe(200);
  return { state, finish: finish.body };
}

/** Elf (bzw. zwölf) echte Pokémon-IDs für direkt eingefügte Einträge. */
const IDS = ALL.slice(0, 12).map((p) => p.id);

interface SynthEntry {
  points?: number;
  score?: number;
  createdAt?: number;
  day?: string;
  challenge?: string;
  formation?: string;
  ssEnabled?: number;
  lineupJson?: string;
  name?: string;
  /** Bestwerte wie insertEntry setzen (Allzeit + Tag) – false: Eintrag zählt nirgends */
  ranked?: boolean;
}

/** Fügt einen Eintrag (UUID wie newId) direkt in die DB ein – samt Gerät und ggf. Bestwerten. */
function insertSynthetic(deviceId: string, e: SynthEntry = {}): string {
  const createdAt = e.createdAt ?? Date.now() - HOUR;
  const day = e.day ?? dayKey();
  const challenge = e.challenge ?? 'c340';
  const points = e.points ?? 60;
  const score = e.score ?? 500;
  db.update(
    'INSERT OR IGNORE INTO devices (id, secret_hash, name, ip_hash, created_at) VALUES (?, ?, ?, NULL, ?)',
    deviceId,
    hex(32),
    e.name ?? `Spieler ${deviceId.slice(0, 4)}`,
    createdAt,
  );
  const id = crypto.randomUUID();
  db.update(
    `INSERT INTO entries (id, device_id, challenge, day, formation, ss_enabled, picks_json, lineup_json, team_name,
       score, wins, draws, losses, points, season_seed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 'Synth', ?, 18, 6, 10, ?, 12345, ?)`,
    id,
    deviceId,
    challenge,
    day,
    e.formation ?? '4-3-3',
    e.ssEnabled ?? 0,
    e.lineupJson ?? JSON.stringify(IDS.slice(0, 11)),
    score,
    points,
    createdAt,
  );
  if (e.ranked ?? true) {
    for (const scope of [ALL_TIME_SCOPE, day]) {
      db.update(UPSERT_BEST_SQL, challenge, scope, deviceId, id, points, score, createdAt);
    }
  }
  return id;
}

/** Schema und einmalige Bereinigung (Standardnamen) vorab, damit Tests danach Namen umsetzen können. */
const warmUp = async () => expect((await get('/api/health')).status).toBe(200);

const expectNotFound = (res: Res<ApiErrorBody>, what = '') => {
  expect(res.status, `${what} ${res.text}`).toBe(404);
  expect(res.body.error, what).toBe('not_found');
  expect(res.body.message, what).toMatch(/nicht mehr in der Rangliste/);
  expect(res.headers.get('cache-control'), what).toBe('no-store');
};

// ---------------------------------------------------------------- Antwort

describe('GET /api/entries/:id – Antwort', () => {
  it('liefert das Team eines Ranglisten-Eintrags mit genau den Feldern des Vertrags', async () => {
    const dev = newDevice();
    const { state, finish } = await playOnline(dev, {
      formation: '4-4-2',
      ssEnabled: true,
      teamName: 'Blitz-Elf ⚡',
      player: 'Misty',
    });
    const row = (await board('challenge=c340&period=all')).body.rows[0];
    expect(row.entryId).toBe(finish.entryId);

    const res = await entry(finish.entryId);
    expect(res.status, res.text).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(ENTRY_CACHE_CONTROL).toBe('public, max-age=60');
    expect(Object.keys(res.body).sort()).toEqual([...DETAIL_KEYS].sort());
    const expected: EntryDetail = {
      entryId: finish.entryId,
      challenge: 'c340',
      day: dayKey(),
      player: 'Misty',
      teamName: 'Blitz-Elf ⚡',
      formation: '4-4-2',
      slots: state.slots,
      ss: state.ss,
      ssEnabled: true,
      record: finish.record,
      points: finish.points,
      score: finish.score,
      createdAt: row.createdAt,
    };
    expect(res.body).toEqual(expected);
    // Dieselben Werte wie die Zeile der Rangliste
    expect(res.body).toMatchObject({
      player: row.player,
      teamName: row.teamName,
      record: row.record,
      points: row.points,
      score: row.score,
      formation: row.formation,
      day: row.day,
    });
    expect(res.body.slots).toHaveLength(11);
    expect(res.body.slots.every((id) => typeof id === 'number')).toBe(true);
    expect(typeof res.body.ss).toBe('number');
  });

  it('alle Formationen, mit und ohne Standardschütze: Slots in Formations-Reihenfolge (11), ss passend', async () => {
    for (const formation of FORMATION_IDS) {
      for (const ssEnabled of [false, true]) {
        const { state, finish } = await playOnline(newDevice(), { formation, ssEnabled });
        const res = await entry(finish.entryId);
        expect(res.status, `${formation} ${ssEnabled} ${res.text}`).toBe(200);
        expect(FORMATIONS[formation].slots).toHaveLength(11);
        expect(res.body.formation).toBe(formation);
        expect(res.body.slots).toEqual(state.slots);
        expect(res.body.slots).toHaveLength(11);
        expect(res.body.ssEnabled).toBe(ssEnabled);
        expect(res.body.ss).toBe(ssEnabled ? state.ss : null);
        if (ssEnabled) expect(res.body.ss).not.toBeNull();
      }
    }
  });

  it('auch für die Tägliche Elf und die 151 Challenge', async () => {
    for (const challenge of ['daily', 'c151'] as ChallengeKey[]) {
      const { finish } = await playOnline(newDevice(), { challenge });
      const res = await entry(finish.entryId);
      expect(res.status, res.text).toBe(200);
      expect(res.body.challenge).toBe(challenge);
      expect(res.body.day).toBe(dayKey());
    }
  });

  it('verrät keine Geräte-ID, Schlüssel, Züge, Token oder Seeds', async () => {
    const dev = newDevice();
    const { finish } = await playOnline(dev);
    const [device] = db.query<{ secret_hash: string }>('SELECT secret_hash FROM devices WHERE id = ?', dev.deviceId);
    const [token] = db.query<{ token: string }>('SELECT token FROM run_tokens WHERE entry_id = ?', finish.entryId);
    const res = await entry(finish.entryId);
    expect(res.status).toBe(200);
    for (const secret of [dev.deviceId, dev.deviceSecret, device.secret_hash, token.token]) {
      expect(res.text).not.toContain(secret);
    }
    for (const word of ['device', 'secret', 'seed', 'pick', 'reroll', 'token', 'ip']) {
      expect(Object.keys(res.body).some((k) => k.toLowerCase().includes(word)), word).toBe(false);
    }
    expect(res.text).not.toContain(String(finish.seasonSeed));
  });

  it('zeigt den aktuellen Namen des Geräts nach einer Umbenennung', async () => {
    const dev = newDevice();
    const { finish } = await playOnline(dev, { player: 'Alt' });
    expect((await entry(finish.entryId)).body.player).toBe('Alt');
    expect((await post('/api/player', { ...dev, player: 'Neu' })).status).toBe(200);
    expect((await entry(finish.entryId)).body.player).toBe('Neu');
  });

  it('akzeptiert einen abschließenden Slash und gibt CORS-Header für eingetragene Origins', async () => {
    const id = insertSynthetic('ab'.repeat(16));
    expect((await entry(`${id}/`)).status).toBe(200);
    const e: Env = { DB: db, ALLOWED_ORIGINS: 'https://elf.example' };
    const res = await call<EntryDetail>('GET', `/api/entries/${id}`, undefined, { Origin: 'https://elf.example' }, e);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://elf.example');
    expect(res.headers.get('vary')).toContain('Origin');
    expect(res.headers.get('cache-control')).toBe(ENTRY_CACHE_CONTROL);
  });
});

// ---------------------------------------------------------------- Nur Ranglisten-Einträge

describe('GET /api/entries/:id – nur, was in einer Rangliste steht', () => {
  it('jede Zeile der Rangliste (heute und allzeit, auch die eigene) lässt sich als Team öffnen', async () => {
    const t = Date.now() - 10 * HOUR;
    for (let i = 0; i < 8; i++) {
      const device = `${i}`.padStart(32, 'e');
      insertSynthetic(device, { points: 40 + i, createdAt: t + i, day: i % 2 ? dayKey() : '2000-01-01' });
      insertSynthetic(device, { points: 30 + i, createdAt: t + i });
    }
    const dev = newDevice();
    const { finish } = await playOnline(dev, { player: 'Rocko' });
    for (const period of ['today', 'all']) {
      const res = await board(`challenge=c340&period=${period}&limit=3&me=${dev.deviceId}`);
      const rows = [...res.body.rows, res.body.mine!];
      expect(res.body.mine?.entryId).toBe(finish.entryId);
      for (const row of rows) {
        const detail = await entry(row.entryId);
        expect(detail.status, `${period} ${row.entryId}`).toBe(200);
        expect(detail.body).toMatchObject({
          entryId: row.entryId,
          player: row.player,
          teamName: row.teamName,
          points: row.points,
          score: row.score,
          record: row.record,
          createdAt: row.createdAt,
          day: row.day,
        });
      }
    }
  });

  it('unbekannte (aber gültige) ID → 404 not_found, nicht zwischengespeichert', async () => {
    expectNotFound(await entry(crypto.randomUUID()));
  });

  it('ersetzte Bestwerte → 404; 200 nur, solange der Allzeit- oder der heutige Bestwert auf den Eintrag zeigt', async () => {
    const dev = 'cd'.repeat(16);
    const t = Date.now() - 10 * HOUR;
    // Bester Run des 1.1.2000 und zunächst auch Allzeit-Bestwert
    const old = insertSynthetic(dev, { points: 50, createdAt: t, day: '2000-01-01' });
    expect((await entry(old)).status).toBe(200);
    // Heute besser: Allzeit-Bestwert wechselt. Der Tages-Bestwert vom 1.1.2000 zeigt zwar weiter
    // auf `old`, diese Wertung liefert GET /api/leaderboard aber nicht mehr (nur heute/allzeit).
    const better = insertSynthetic(dev, { points: 60, createdAt: t + 1 });
    expect(db.query('SELECT scope FROM best_entries WHERE entry_id = ?', old)).toEqual([{ scope: '2000-01-01' }]);
    expectNotFound(await entry(old), 'nur noch Bestwert eines vergangenen Tages');
    expect((await entry(better)).status).toBe(200);
    // … und `old` steht tatsächlich in keiner abrufbaren Rangliste
    for (const period of ['today', 'all']) {
      const res = await board(`challenge=c340&period=${period}&limit=100&me=${dev}`);
      const ids = [...res.body.rows, ...(res.body.mine ? [res.body.mine] : [])].map((r) => r.entryId);
      expect(ids, period).not.toContain(old);
      expect(ids, period).toContain(better);
    }
    // Schlechterer Run: nie ein Bestwert
    const worse = insertSynthetic(dev, { points: 40, createdAt: t + 2 });
    expectNotFound(await entry(worse), 'schlechterer Run');
    // Besserer Run am 1.1.2000 ersetzt beide Bestwerte von `old` und wird Allzeit-Bestwert
    const best = insertSynthetic(dev, { points: 70, createdAt: t + 3, day: '2000-01-01' });
    expectNotFound(await entry(old), 'ersetzt');
    expect((await entry(best)).status).toBe(200);
    // `better` ist noch Bestwert von heute (aber nicht mehr allzeit)
    expect(db.query('SELECT scope FROM best_entries WHERE entry_id = ?', better)).toEqual([{ scope: dayKey() }]);
    expect((await entry(better)).status).toBe(200);
    expect(
      db.query('SELECT 1 FROM best_entries WHERE entry_id = ?', old),
      'old zeigt in keiner Wertung mehr',
    ).toEqual([]);
  });

  it('Tageswechsel (Berlin): der heutige Bestwert bleibt nach Mitternacht nur während der Schonfrist abrufbar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 15.1.2026, 23:58 in Berlin (MEZ = UTC+1); Mitternacht = 23:00 UTC
    const midnight = Date.UTC(2026, 0, 15, 23, 0, 0);
    vi.setSystemTime(midnight - 2 * 60_000);
    expect(dayKey()).toBe('2026-01-15');
    const dev = 'ab'.repeat(16);
    // Allzeit-Bestwert von einem früheren Tag, heute nur ein schwächerer Run
    const allTime = insertSynthetic(dev, { points: 90, createdAt: Date.UTC(2026, 0, 10, 12), day: '2026-01-10' });
    const today = insertSynthetic(dev, { points: 50, createdAt: midnight - 5 * 60_000, day: '2026-01-15' });
    const todayBoard = await board(`challenge=c340&period=today&limit=100&me=${dev}`);
    expect(todayBoard.body.rows.map((r) => r.entryId)).toEqual([today]);
    expect((await entry(today)).status).toBe(200);

    // Kurz nach Mitternacht: Die Tageswertung ist schon die vom 16., die Zeile von gestern lässt sich noch öffnen
    vi.setSystemTime(midnight + 5 * 60_000);
    expect(dayKey()).toBe('2026-01-16');
    expect((await board('challenge=c340&period=today&limit=100')).body.rows).toEqual([]);
    expect((await entry(today)).status).toBe(200);
    // Grenze: bis 1 ms vor Ende der Schonfrist 200, danach 404
    vi.setSystemTime(midnight + ENTRY_DAY_GRACE_MS - 1);
    expect((await entry(today)).status).toBe(200);
    vi.setSystemTime(midnight + ENTRY_DAY_GRACE_MS);
    expectNotFound(await entry(today), 'nach der Schonfrist');
    vi.setSystemTime(midnight + 3 * HOUR);
    expectNotFound(await entry(today), 'Stunden später');
    // Der Allzeit-Bestwert bleibt abrufbar
    expect((await entry(allTime)).status).toBe(200);
  });

  it('entryScopes: allzeit, heute und – nur kurz nach Mitternacht – gestern', () => {
    const midnight = Date.UTC(2026, 6, 1, 22, 0, 0); // 2.7.2026 00:00 in Berlin (MESZ = UTC+2)
    expect(ENTRY_DAY_GRACE_MS).toBeGreaterThanOrEqual(60_000);
    expect(ENTRY_DAY_GRACE_MS).toBeLessThanOrEqual(30 * 60_000);
    expect(entryScopes(midnight - 1)).toEqual([ALL_TIME_SCOPE, '2026-07-01', '2026-07-01']);
    expect(entryScopes(midnight)).toEqual([ALL_TIME_SCOPE, '2026-07-02', '2026-07-01']);
    expect(entryScopes(midnight + ENTRY_DAY_GRACE_MS - 1)).toEqual([ALL_TIME_SCOPE, '2026-07-02', '2026-07-01']);
    expect(entryScopes(midnight + ENTRY_DAY_GRACE_MS)).toEqual([ALL_TIME_SCOPE, '2026-07-02', '2026-07-02']);
  });

  it('echter Run, der nicht der beste des Geräts ist → 404', async () => {
    const dev = newDevice();
    const first = await playOnline(dev);
    const second = await playOnline(dev);
    const ids = db.query<{ entry_id: string }>('SELECT DISTINCT entry_id FROM best_entries WHERE device_id = ?', dev.deviceId);
    expect(ids).toHaveLength(1);
    const [bestId] = ids.map((r) => r.entry_id);
    const other = [first.finish.entryId, second.finish.entryId].find((id) => id !== bestId);
    expect((await entry(bestId)).status).toBe(200);
    // Allzeit- und Tages-Bestwert zeigen auf denselben Run (bei Gleichstand der frühere) – der andere fehlt.
    expect(other).toBeDefined();
    expectNotFound(await entry(other!), 'nicht bester Run');
  });

  it('Eintrag ohne Bestwert-Zeile (z. B. Abschluss eines unbenannten Geräts) → 404', async () => {
    const id = insertSynthetic('ef'.repeat(16), { ranked: false });
    expectNotFound(await entry(id));
  });

  it('Bestwert-Zeile, die auf einen anderen Eintrag desselben Geräts zeigt, zählt nicht', async () => {
    const dev = '12'.repeat(16);
    const id = insertSynthetic(dev, { ranked: false });
    const other = insertSynthetic(dev, { points: 90 });
    expectNotFound(await entry(id));
    expect((await entry(other)).status).toBe(200);
  });

  it('Gerät mit Standardnamen („Trainer", leer, auch nur von isDefaultPlayerName erkannt) → 404', async () => {
    const dev = newDevice();
    const { finish } = await playOnline(dev, { player: 'Brock' });
    await warmUp();
    expect((await entry(finish.entryId)).status).toBe(200);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Standardnamen, die schon die Abfrage ausfiltert …
    for (const name of ['Trainer', 'trainer', ' TRAINER ', '']) {
      db.update('UPDATE devices SET name = ? WHERE id = ?', name, dev.deviceId);
      expectNotFound(await entry(finish.entryId), JSON.stringify(name));
    }
    expect(warn).not.toHaveBeenCalled();
    // … und Varianten, die erst isDefaultPlayerName im Endpunkt erkennt.
    for (const name of ['Ｔｒａｉｎｅｒ', 'Trainer​', 'Tr­ainer']) {
      db.update('UPDATE devices SET name = ? WHERE id = ?', name, dev.deviceId);
      expectNotFound(await entry(finish.entryId), JSON.stringify(name));
    }
    expect(warn).toHaveBeenCalledTimes(3);
    db.update('UPDATE devices SET name = ? WHERE id = ?', 'Brock', dev.deviceId);
    expect((await entry(finish.entryId)).status).toBe(200);
  });
});

// ---------------------------------------------------------------- Beschädigte Daten

describe('GET /api/entries/:id – beschädigte Daten → 404, nie 500', () => {
  const eleven = IDS.slice(0, 11);
  const unknownId = Math.max(...ALL.map((p) => p.id)) + 1;

  const corrupt: [string, SynthEntry][] = [
    ['kein JSON', { lineupJson: 'kein json' }],
    ['leerer Text', { lineupJson: '' }],
    ['abgeschnittenes JSON', { lineupJson: JSON.stringify(eleven).slice(0, -1) }],
    ['Objekt', { lineupJson: '{}' }],
    ['null', { lineupJson: 'null' }],
    ['Text', { lineupJson: '"4-3-3"' }],
    ['Zahl', { lineupJson: '42' }],
    ['leeres Array', { lineupJson: '[]' }],
    ['zu kurz', { lineupJson: JSON.stringify(eleven.slice(0, 10)) }],
    ['zu lang ohne Standardschütze', { lineupJson: JSON.stringify(IDS) }],
    ['Standardschütze fehlt', { lineupJson: JSON.stringify(eleven), ssEnabled: 1 }],
    ['Texte statt IDs', { lineupJson: JSON.stringify(eleven.map(String)) }],
    ['Kommazahl', { lineupJson: JSON.stringify([1.5, ...eleven.slice(1)]) }],
    ['negative ID', { lineupJson: JSON.stringify([-1, ...eleven.slice(1)]) }],
    ['ID 0', { lineupJson: JSON.stringify([0, ...eleven.slice(1)]) }],
    ['unbekanntes Pokémon', { lineupJson: JSON.stringify([unknownId, ...eleven.slice(1)]) }],
    ['unbekannter Standardschütze', { lineupJson: JSON.stringify([...eleven, unknownId]), ssEnabled: 1 }],
    ['verschachtelt', { lineupJson: JSON.stringify([[1], ...eleven.slice(1)]) }],
    ['Wahrheitswert', { lineupJson: JSON.stringify([true, ...eleven.slice(1)]) }],
    ['unendlich', { lineupJson: `[1e400,${eleven.slice(1).join(',')}]` }],
    ['unbekannte Formation', { formation: '9-9-9' }],
    ['unbekannte Challenge', { challenge: 'xyz' }],
    ['ss_enabled weder 0 noch 1', { ssEnabled: 2, lineupJson: JSON.stringify(IDS) }],
    ['Zeitstempel außerhalb des Datumsbereichs', { createdAt: 9e15 }],
  ];

  it.each(corrupt)('%s', async (_what, e) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const id = insertSynthetic(crypto.randomUUID(), e);
    expect(db.query('SELECT 1 FROM best_entries WHERE entry_id = ?', id)).toHaveLength(2);
    expectNotFound(await entry(id));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('leere Slots (null) sind erlaubt – nur Werte, die weder leer noch ein Pokémon sind, nicht', async () => {
    const lineup = [null, ...IDS.slice(1, 11), null];
    const id = insertSynthetic(crypto.randomUUID(), { lineupJson: JSON.stringify(lineup), ssEnabled: 1 });
    const res = await entry(id);
    expect(res.status, res.text).toBe(200);
    expect(res.body.slots).toEqual(lineup.slice(0, 11));
    expect(res.body.ss).toBeNull();
    expect(res.body.ssEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------- Ungültige IDs und Routing

describe('GET /api/entries/:id – IDs und Routing', () => {
  it('erkennt genau das Format, das der Server vergibt (crypto.randomUUID)', () => {
    for (let i = 0; i < 200; i++) {
      const id = crypto.randomUUID();
      expect(ENTRY_ID_RE.test(id), id).toBe(true);
      expect(parseEntryId(id)).toBe(id);
    }
  });

  it('ungültige IDs → 400 bad_request, ohne Abfrage der Einträge', async () => {
    await warmUp();
    db.executed.length = 0;
    const valid = crypto.randomUUID();
    const bad = [
      'abc',
      valid.toUpperCase(),
      valid.replace(/-/g, ''),
      `${valid}a`,
      valid.slice(1),
      `{${valid}}`,
      '0b9f6c1e-1d2b-11ee-be56-0242ac120002', // UUID v1
      `${valid.slice(0, 19)}c${valid.slice(20)}`, // falsche Variante
      `${valid.slice(0, 14)}5${valid.slice(15)}`, // falsche Version
      'synthetic-1',
      encodeURIComponent(` ${valid}`),
      encodeURIComponent(`${valid}\n`),
      encodeURIComponent("' OR 1=1 --"),
      '%00',
      encodeURIComponent('ä'),
      'x'.repeat(5000),
    ];
    for (const id of bad) {
      const res = await entry(id);
      expect(res.status, id).toBe(400);
      expect(res.body.error, id).toBe('bad_request');
      expect(res.body.message, id).toMatch(/Eintrags-ID/);
      expect(() => parseEntryId(decodeURIComponent(id))).toThrow();
    }
    expect(db.executed.filter((s) => s.sql.includes('FROM entries'))).toEqual([]);
  });

  it('ohne ID oder mit Unterpfad → 404 (kein API-Pfad), andere Methoden → 405', async () => {
    const id = insertSynthetic('34'.repeat(16));
    for (const path of ['/api/entries', '/api/entries/', `/api/entries/${id}/team`, `/api/entries//${id}`]) {
      const res = await get<ApiErrorBody>(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error, path).toBe('not_found');
      expect(res.body.message, path).toMatch(/API-Pfad/);
    }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await call<ApiErrorBody>(method, `/api/entries/${id}`, method === 'POST' ? {} : undefined);
      expect(res.status, method).toBe(405);
      expect(res.body.error).toBe('method_not_allowed');
      expect(res.headers.get('allow')).toBe('GET');
    }
  });
});

// ---------------------------------------------------------------- Abfrageplan

describe('GET /api/entries/:id – eine Abfrage über Primärschlüssel', () => {
  it('liest genau ein Statement – Punktzugriffe, kein Durchlauf, keine Sortierung', async () => {
    const t = Date.now() - HOUR;
    let target = '';
    let pastDayBest = '';
    for (let i = 0; i < 300; i++) {
      const device = `${i}`.padStart(32, 'c');
      for (let k = 0; k < 3; k++) {
        const id = insertSynthetic(device, {
          points: (i * 7 + k) % 90,
          score: (i * 13 + k) % 700,
          createdAt: t + k,
          day: k ? dayKey() : '2000-01-01',
        });
        if (i === 150 && k === 2) target = id; // Allzeit- und heutiger Bestwert des Geräts
        if (i === 150 && k === 0) pastDayBest = id; // nur noch Bestwert des 1.1.2000
      }
    }
    await warmUp();
    for (const [id, status] of [
      [target, 200],
      [pastDayBest, 404],
      [crypto.randomUUID(), 404],
    ] as const) {
      db.executed.length = 0;
      const res = await entry(id);
      expect(res.status, res.text).toBe(status);
      const statements = db.executed.filter((e) => /^\s*(SELECT|UPDATE|DELETE|INSERT)/i.test(e.sql));
      expect(statements.map((s) => s.sql)).toEqual([ENTRY_DETAIL_SQL]);
      const { sql, params } = statements[0];
      expect(params[0]).toBe(id);
      expect(params.slice(1)).toEqual([ALL_TIME_SCOPE, dayKey(), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
      const plan = db.plan(sql, ...params);
      const bad = plan.filter((l) => /^SCAN /.test(l) || l.includes('TEMP B-TREE'));
      expect(bad, plan.join('\n')).toEqual([]);
      expect(plan).toContainEqual(expect.stringMatching(/^SEARCH e USING INDEX sqlite_autoindex_entries_1 \(id=\?\)/));
      expect(plan).toContainEqual(expect.stringMatching(/^SEARCH d USING INDEX sqlite_autoindex_devices_1 \(id=\?\)/));
      expect(plan).toContainEqual(
        expect.stringMatching(
          /^SEARCH b USING INDEX sqlite_autoindex_best_entries_1 \(challenge=\? AND scope=\? AND device_id=\?\)/,
        ),
      );
    }
  });
});

// ---------------------------------------------------------------- Vertrag

describe('EntryDetail im Vertrag (src/lib/api/contract.ts)', () => {
  const contract = readFileSync(fileURLToPath(new URL('../src/lib/api/contract.ts', import.meta.url)), 'utf8');
  const start = contract.indexOf('export interface EntryDetail');
  /** Rumpf des Interfaces bis zur schließenden Klammer */
  const body = contract.slice(start, start + contract.slice(start).search(/\r?\n\}/));
  /** JSDoc direkt über dem Interface */
  const doc = contract.slice(contract.lastIndexOf('/**', start), start);

  it('ss ist der Standardschütze (wie in src/types.ts) – kein „Super-Sub"', () => {
    const ssDoc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*ss: number \| null;/.exec(body)?.[1] ?? '';
    expect(ssDoc).toMatch(/Standardschütze/);
    expect(ssDoc).toMatch(/null/);
    expect(contract).not.toMatch(/Super-?Sub/i);
  });

  it('beschreibt die Regeln des Endpunkts: nur abrufbare Ranglisten (allzeit/heute), Cache für player', () => {
    expect(doc).toMatch(/allzeit oder heute/);
    expect(doc).toMatch(/vergangenen Tages/);
    expect(doc).toMatch(/max-age=60/);
  });
});

// ---------------------------------------------------------------- Bausteine

describe('parseStoredLineup und toEntryDetail', () => {
  const eleven = IDS.slice(0, 11);

  it('liest, was finishRun schreibt: Slots, mit Standardschütze dahinter', () => {
    expect(parseStoredLineup(JSON.stringify(eleven), '4-3-3', false)).toEqual({ slots: eleven, ss: null });
    expect(parseStoredLineup(JSON.stringify(IDS), '3-5-2', true)).toEqual({ slots: eleven, ss: IDS[11] });
    expect(parseStoredLineup(JSON.stringify([...eleven, null]), '5-3-2', true)).toEqual({ slots: eleven, ss: null });
  });

  it('null für alles andere', () => {
    for (const raw of [undefined, null, 42, '', 'x', '{}', '[]', JSON.stringify(IDS), JSON.stringify(eleven.map(String))]) {
      expect(parseStoredLineup(raw, '4-3-3', false), String(raw)).toBeNull();
    }
    expect(parseStoredLineup(JSON.stringify(eleven), '4-3-3', true)).toBeNull();
  });

  const row = (over: Partial<EntryDetailRow> = {}): EntryDetailRow => ({
    id: crypto.randomUUID(),
    challenge: 'c340',
    day: '2026-10-13',
    formation: '4-2-3-1',
    ss_enabled: 0,
    lineup_json: JSON.stringify(eleven),
    team_name: 'Elf',
    score: 777,
    wins: 20,
    draws: 5,
    losses: 9,
    points: 65,
    created_at: Date.UTC(2026, 9, 13, 12),
    player: 'Ash',
    ...over,
  });

  it('baut die Antwort nur aus den Feldern des Vertrags', () => {
    const r = row();
    expect(toEntryDetail({ ...r, device_id: 'geheim', season_seed: 1 } as EntryDetailRow)).toEqual({
      entryId: r.id,
      challenge: 'c340',
      day: '2026-10-13',
      player: 'Ash',
      teamName: 'Elf',
      formation: '4-2-3-1',
      slots: eleven,
      ss: null,
      ssEnabled: false,
      record: { w: 20, d: 5, l: 9 },
      points: 65,
      score: 777,
      createdAt: '2026-10-13T12:00:00.000Z',
    });
  });

  it('null bei beschädigten Zeilen oder Standardnamen', () => {
    for (const over of [
      { challenge: 'xyz' },
      { formation: '1-1-1' },
      { ss_enabled: 3 },
      { lineup_json: 'kaputt' },
      { created_at: Number.NaN },
      { created_at: 9e15 },
      { player: 'Trainer' },
      { player: 'Ｔｒａｉｎｅｒ' },
      { player: '' },
    ] as Partial<EntryDetailRow>[]) {
      expect(toEntryDetail(row(over)), JSON.stringify(over)).toBeNull();
    }
  });
});
