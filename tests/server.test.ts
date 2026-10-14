/**
 * Ende-zu-Ende-Tests des Cloudflare-Backends: echte Requests durch handleApi,
 * D1 simuliert mit node:sqlite (tests/d1shim.ts), Runs gespielt mit derselben
 * challengeEngine wie im Browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORMATION_IDS } from '../src/config/formations';
import {
  API_VERSION,
  isDefaultPlayerName,
  LIMITS,
  type ApiErrorBody,
  type DeviceAuth,
  type FinishRunResponse,
  type LeaderboardResponse,
  type PlayerProfile,
  type StartRunResponse,
} from '../src/lib/api/contract';
import {
  applyReroll,
  canReroll,
  candidates,
  createEngineData,
  isComplete,
  isFreeSlot,
  legendBlocked,
  MODE_RULES,
  place,
  SS_SLOT,
  startRun,
  type PickLog,
  type RerollKind,
  type RunConfig,
  type RunState,
} from '../src/lib/challengeEngine';
import { dailyRunSeed, dailySeasonSeed, dayKey, weekKey } from '../src/lib/daily';
import { buildScale, type Scale } from '../src/lib/fit';
import { computeRun } from '../src/lib/runCompute';
import type { ChallengeKey, FormationId } from '../src/types';
import { normalizeIp } from '../server/auth';
import { ALL_TIME_SCOPE, deleteStaleTokens, UPSERT_BEST_SQL } from '../server/db';
import { ORPHAN_GRACE_MS, STALE_TOKEN_MS } from '../server/endpoints';
import { handleApi, type Env } from '../server/handler';
import { profilePageMeta, profilePreview } from '../server/preview';
import { cleanText, MAX_BODY_BYTES, parsePlayerName, parseTeamName } from '../server/validate';
import { D1Shim } from './d1shim';
import { ALL } from './helpers';

const DATA = createEngineData(ALL);
const SCALES: Record<'all' | 'gen1', Scale> = {
  all: buildScale(ALL, 'all'),
  gen1: buildScale(
    ALL.filter((p) => p.gen === 1),
    'gen1',
  ),
};
const HOUR = 3_600_000;

let db: D1Shim;
let env: Env;

beforeEach(() => {
  db = new D1Shim();
  env = { DB: db };
});

// ---------------------------------------------------------------- Helfer

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

function newDevice(): DeviceAuth {
  return { deviceId: crypto.randomUUID(), deviceSecret: hex(32) };
}

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
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await handleApi(new Request(`http://localhost${path}`, init), e);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers, text };
}

const post = <T = unknown>(path: string, body: unknown, headers?: Record<string, string>) =>
  call<T>('POST', path, body, headers);
const get = <T = unknown>(path: string, headers?: Record<string, string>) => call<T>('GET', path, undefined, headers);

interface PlayOptions {
  /** Diese Reroll-Arten werden genutzt, sobald es möglich ist */
  rerolls?: RerollKind[];
  /** Standardschützen zuerst besetzen */
  ssFirst?: boolean;
  /** n-te gültige Wahl statt der ersten (für unterschiedliche Teams) */
  choice?: number;
}

/** Spielt einen Run automatisch: erster wählbarer Kandidat, erster freier Slot. */
function autoPlay(config: RunConfig, opts: PlayOptions = {}): RunState {
  let s = startRun(config, DATA);
  while (!isComplete(s)) {
    for (const kind of opts.rerolls ?? []) {
      if (canReroll(s, kind, DATA)) s = applyReroll(s, kind, DATA);
    }
    const options = candidates(s, DATA).filter((p) => !legendBlocked(s, p, DATA));
    const pick = options[Math.min(opts.choice ?? 0, options.length - 1)];
    let slot = s.slots.findIndex((_, i) => isFreeSlot(s, i));
    if (slot < 0 || (opts.ssFirst && isFreeSlot(s, SS_SLOT))) slot = SS_SLOT;
    s = place(s, pick.id, slot, DATA);
  }
  return s;
}

interface RunSpec extends PlayOptions {
  challenge?: ChallengeKey;
  formation?: FormationId;
  ssEnabled?: boolean;
  teamName?: string;
  player?: string;
}

/** Name, den startOnline unbenannten Geräten gibt (wie der Standard-Spieler in finishBody). */
const TEST_PLAYER = 'Ash';

/**
 * Gewertete Runs brauchen einen eigenen Namen: Ein noch unbekanntes oder unbenanntes Gerät
 * bekommt vorher per POST /api/player den Namen TEST_PLAYER – mit denselben Headern, damit
 * es (wie bisher beim Start) mit seiner IP registriert wird.
 */
async function ensureNamed(dev: DeviceAuth, headers?: Record<string, string>) {
  const [row] = db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', dev.deviceId.toLowerCase());
  if (row && !isDefaultPlayerName(row.name)) return;
  await post('/api/player', { ...dev, player: TEST_PLAYER }, headers);
}

/** Start eines gewerteten Runs (benennt das Gerät vorher, falls nötig). */
async function startOnline(dev: DeviceAuth, challenge: ChallengeKey = 'c340', headers?: Record<string, string>) {
  await ensureNamed(dev, headers);
  return startUnnamed(dev, challenge, headers);
}

/** Start ohne vorheriges Benennen – für Tests mit Standardnamen. */
function startUnnamed(dev: DeviceAuth, challenge: ChallengeKey = 'c340', headers?: Record<string, string>) {
  return post<StartRunResponse>('/api/runs/start', { ...dev, challenge }, headers);
}

function finishBody(dev: DeviceAuth, token: string, state: RunState, spec: RunSpec = {}) {
  return {
    ...dev,
    token,
    formation: state.config.formation,
    ssEnabled: state.config.ssEnabled,
    picks: state.picks,
    teamName: spec.teamName ?? 'Test-Elf',
    player: spec.player ?? 'Ash',
  };
}

/** Kompletter Online-Run: start → lokal spielen → finish. */
async function playOnline(dev: DeviceAuth, spec: RunSpec = {}) {
  const challenge = spec.challenge ?? 'c340';
  const start = await startOnline(dev, challenge);
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = autoPlay(
    { challenge, formation: spec.formation ?? '4-3-3', ssEnabled: spec.ssEnabled ?? false, seed: start.body.seed },
    spec,
  );
  const finish = await post<FinishRunResponse & ApiErrorBody>(
    '/api/runs/finish',
    finishBody(dev, start.body.token, state, spec),
  );
  return { start, state, finish };
}

/** Erwartetes Ergebnis – dieselbe Rechnung wie im Browser. */
function expected(state: RunState, seasonSeed: number, teamName = 'Test-Elf') {
  const { config } = state;
  return computeRun(
    {
      formation: config.formation,
      slots: state.slots,
      ss: config.ssEnabled ? state.ss : undefined,
      teamName,
      seed: seasonSeed,
    },
    DATA.byId,
    SCALES[MODE_RULES[config.challenge].scale],
  );
}

function expectMatches(res: FinishRunResponse, state: RunState, teamName?: string) {
  const run = expected(state, res.seasonSeed, teamName);
  expect(res.score).toBe(run.evaluation.score);
  expect(res.record).toEqual(run.season.record);
  expect(res.points).toBe(run.season.points);
  expect(res.record.w + res.record.d + res.record.l).toBe(34);
  expect(res.points).toBe(res.record.w * 3 + res.record.d);
}

let synthCounter = 0;
/** Fügt einen Eintrag direkt in die DB ein – samt Bestwerten wie insertEntry (für Sortier-Tests). */
function insertSynthetic(
  deviceId: string,
  e: { points: number; score: number; createdAt: number; day?: string; challenge?: ChallengeKey; name?: string },
): string {
  db.update(
    'INSERT OR IGNORE INTO devices (id, secret_hash, name, ip_hash, created_at) VALUES (?, ?, ?, NULL, ?)',
    deviceId,
    hex(32),
    e.name ?? `Spieler ${deviceId.slice(0, 4)}`,
    e.createdAt,
  );
  const id = `synthetic-${++synthCounter}`;
  db.update(
    `INSERT INTO entries (id, device_id, challenge, day, formation, ss_enabled, picks_json, lineup_json, team_name,
       score, wins, draws, losses, points, season_seed, created_at)
     VALUES (?, ?, ?, ?, '4-3-3', 0, '[]', '[]', 'Synth', ?, 10, 4, 20, ?, 1, ?)`,
    id,
    deviceId,
    e.challenge ?? 'c340',
    e.day ?? dayKey(),
    e.score,
    e.points,
    e.createdAt,
  );
  for (const scope of [ALL_TIME_SCOPE, e.day ?? dayKey()]) {
    db.update(UPSERT_BEST_SQL, e.challenge ?? 'c340', scope, deviceId, id, e.points, e.score, e.createdAt);
  }
  return id;
}

// ---------------------------------------------------------------- Health & Routing

describe('health & routing', () => {
  it('GET /api/health meldet ok, Version und heutigen Tag', async () => {
    const res = await get<{ ok: boolean; version: number; day: string }>('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: API_VERSION, day: dayKey() });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('akzeptiert einen abschließenden Slash', async () => {
    expect((await get('/api/health/')).status).toBe(200);
  });

  it('ohne D1-Binding meldet auch health einen Serverfehler', async () => {
    const res = await call<ApiErrorBody>('GET', '/api/health', undefined, {}, {} as Env);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server_error');
  });

  it('unbekannte Routen → 404', async () => {
    const entryId = crypto.randomUUID();
    for (const path of ['/api/nope', '/api/runs', '/api', '/api/runs/start/extra', '/api/entries', `/api/entries/${entryId}/x`]) {
      const res = await get<ApiErrorBody>(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error).toBe('not_found');
      expect(res.body.message).toMatch(/API-Pfad/);
    }
  });

  it('falsche Methode → 405 mit Allow-Header', async () => {
    const a = await get<ApiErrorBody>('/api/runs/start');
    expect(a.status).toBe(405);
    expect(a.body.error).toBe('method_not_allowed');
    expect(a.headers.get('allow')).toBe('POST');
    const b = await post<ApiErrorBody>('/api/health', {});
    expect(b.status).toBe(405);
    expect(b.headers.get('allow')).toBe('GET');
    expect((await call('DELETE', '/api/player')).status).toBe(405);
    expect((await post('/api/leaderboard', {})).status).toBe(405);
    const c = await post<ApiErrorBody>(`/api/entries/${crypto.randomUUID()}`, {});
    expect(c.status).toBe(405);
    expect(c.headers.get('allow')).toBe('GET');
  });

  it('unerwartete Fehler → 500 mit deutscher Meldung, ohne Details', async () => {
    const broken: Env = {
      DB: {
        prepare: () => {
          throw new Error('geheimes Detail');
        },
        batch: async () => [],
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call<ApiErrorBody>('POST', '/api/runs/start', { ...newDevice(), challenge: 'c340' }, {}, broken);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server_error');
    expect(res.body.message).toMatch(/Serverfehler/);
    expect(res.text).not.toContain('geheimes Detail');
  });
});

// ---------------------------------------------------------------- CORS

describe('CORS', () => {
  it('ohne ALLOWED_ORIGINS keine CORS-Header (nur same-origin)', async () => {
    const res = await get('/api/health', { Origin: 'https://evil.example' });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await call('OPTIONS', '/api/runs/start', undefined, { Origin: 'https://evil.example' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('beantwortet Preflights für eingetragene Origins', async () => {
    const e: Env = { DB: db, ALLOWED_ORIGINS: 'https://elf.example, https://andere.example/' };
    const pre = await call('OPTIONS', '/api/runs/finish', undefined, { Origin: 'https://andere.example' }, e);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://andere.example');
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect(pre.headers.get('access-control-allow-methods')).toContain('GET');
    expect(pre.headers.get('access-control-allow-headers')).toContain('Content-Type');
    expect(pre.headers.get('vary')).toContain('Origin');

    const okGet = await call('GET', '/api/health', undefined, { Origin: 'https://elf.example' }, e);
    expect(okGet.status).toBe(200);
    expect(okGet.headers.get('access-control-allow-origin')).toBe('https://elf.example');

    const err = await call('GET', '/api/nope', undefined, { Origin: 'https://elf.example' }, e);
    expect(err.status).toBe(404);
    expect(err.headers.get('access-control-allow-origin')).toBe('https://elf.example');

    const other = await call('OPTIONS', '/api/runs/finish', undefined, { Origin: 'https://evil.example' }, e);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect(other.headers.get('access-control-allow-methods')).toBeNull();
  });
});

// ---------------------------------------------------------------- Runs

describe('Runs: start → finish', () => {
  it('start vergibt Token, Seed und Tag', async () => {
    const dev = newDevice();
    const res = await startOnline(dev, 'c340');
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.challenge).toBe('c340');
    expect(Number.isInteger(res.body.seed) && res.body.seed >= 0 && res.body.seed < 2 ** 31).toBe(true);
    expect(res.body.day).toBe(dayKey());
    const [row] = db.query<{ secret_hash: string; name: string }>('SELECT * FROM devices WHERE id = ?', dev.deviceId);
    expect(row.name).toBe(TEST_PLAYER);
    expect(row.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.secret_hash).not.toBe(dev.deviceSecret);
  });

  it('gültige 34–0-Runs: alle Formationen, mit/ohne Standardschütze, mit Rerolls', async () => {
    const dev = newDevice();
    let i = 0;
    for (const formation of FORMATION_IDS) {
      for (const ssEnabled of [false, true]) {
        const spec: RunSpec = {
          formation,
          ssEnabled,
          rerolls: i % 2 ? ['type', 'region'] : [],
          ssFirst: i % 3 === 0,
          teamName: `Elf ${i}`,
        };
        const { state, finish } = await playOnline(dev, spec);
        expect(finish.status, JSON.stringify(finish.body)).toBe(200);
        expect(finish.body.challenge).toBe('c340');
        expect(finish.body.day).toBe(dayKey());
        expect(finish.body.entryId).toBeTruthy();
        expect(finish.body.rankToday).toBe(1);
        expect(finish.body.rankAllTime).toBe(1);
        expectMatches(finish.body, state, spec.teamName);
        const [entry] = db.query<{ lineup_json: string; picks_json: string; ss_enabled: number; team_name: string }>(
          'SELECT * FROM entries WHERE id = ?',
          finish.body.entryId,
        );
        expect(JSON.parse(entry.lineup_json)).toEqual(ssEnabled ? [...state.slots, state.ss] : state.slots);
        expect(JSON.parse(entry.picks_json)).toEqual(state.picks);
        expect(entry.ss_enabled).toBe(ssEnabled ? 1 : 0);
        expect(entry.team_name).toBe(spec.teamName);
        i++;
      }
    }
    expect(db.query('SELECT * FROM entries')).toHaveLength(FORMATION_IDS.length * 2);
  });

  it('Rerolls werden im Protokoll mitgeprüft', async () => {
    const { state, finish } = await playOnline(newDevice(), { rerolls: ['type', 'region'] });
    expect(state.picks.flatMap((p) => p.rerolls).sort()).toEqual(['region', 'type']);
    expect(finish.status).toBe(200);
    expectMatches(finish.body, state);
  });

  it('Retro 34–0 und 151 Challenge (Gen-1-Normalisierung)', async () => {
    const dev = newDevice();
    const retro = await playOnline(dev, { challenge: 'retro340', formation: '4-4-2', ssEnabled: true, rerolls: ['type'] });
    expect(retro.finish.status, JSON.stringify(retro.finish.body)).toBe(200);
    expect(retro.finish.body.challenge).toBe('retro340');
    expectMatches(retro.finish.body, retro.state);
    expect(retro.state.picks.every((p) => DATA.byId.get(p.pokemonId)!.gen === 1)).toBe(true);

    const c151 = await playOnline(dev, { challenge: 'c151', formation: '3-5-2', ssEnabled: true, rerolls: ['pokemon'] });
    expect(c151.finish.status, JSON.stringify(c151.finish.body)).toBe(200);
    expect(c151.finish.body.challenge).toBe('c151');
    expect(c151.state.picks.flatMap((p) => p.rerolls)).toHaveLength(MODE_RULES.c151.rerolls.pokemon);
    expectMatches(c151.finish.body, c151.state);
  });

  it('speichert den Spielernamen fürs Gerät', async () => {
    const dev = newDevice();
    await playOnline(dev, { player: '  Misty  ' });
    expect(db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', dev.deviceId)[0].name).toBe('Misty');
  });

  it('erneuter Abschluss eines gewerteten Tokens (Antwort verloren) → dasselbe Ergebnis, kein zweiter Eintrag', async () => {
    const dev = newDevice();
    const { start, state, finish } = await playOnline(dev);
    expect(finish.status).toBe(200);
    const again = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(again.status).toBe(200);
    expect(again.body).toEqual(finish.body);

    // Unabhängig vom Body: andere Züge, anderer Team- und Spielername ändern nichts.
    const other = await post<FinishRunResponse>('/api/runs/finish', {
      ...finishBody(dev, start.body.token, state, { teamName: 'Andere Elf', player: 'Brock' }),
      picks: state.picks.slice(0, 3),
    });
    expect(other.status).toBe(200);
    expect(other.body).toEqual(finish.body);
    expect(db.query('SELECT * FROM entries')).toHaveLength(1);
    expect(db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', dev.deviceId)[0].name).toBe('Ash');

    // Fremde Geräte erfahren weiterhin nichts über den Token.
    const foreign = await post<ApiErrorBody>('/api/runs/finish', finishBody(newDevice(), start.body.token, state));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe('not_found');

    // Plätze werden frisch berechnet …
    insertSynthetic('ee'.repeat(16), { points: 102, score: 9999, createdAt: Date.now() - HOUR });
    const later = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(later.body).toEqual({ ...finish.body, rankToday: 2, rankAllTime: 2 });

    // … und auch das Stundenlimit für Abschlüsse verhindert die Wiederholung nicht.
    for (let i = 0; i < LIMITS.finishesPerHour; i++) {
      db.update(
        "INSERT INTO run_tokens (token, device_id, challenge, seed, day, created_at, finished_at) VALUES (?, ?, 'c340', 1, ?, ?, ?)",
        hex(32),
        dev.deviceId,
        dayKey(),
        Date.now() - HOUR,
        Date.now() - 1000,
      );
    }
    const limited = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(limited.status).toBe(200);
    expect(limited.body.entryId).toBe(finish.body.entryId);
  });

  it('der Token merkt sich beim Abschluss seinen Eintrag', async () => {
    const dev = newDevice();
    const { start, finish } = await playOnline(dev);
    const [token] = db.query<{ finished_at: number | null; entry_id: string | null }>(
      'SELECT finished_at, entry_id FROM run_tokens WHERE token = ?',
      start.body.token,
    );
    expect(token.finished_at).toBeTypeOf('number');
    expect(token.entry_id).toBe(finish.body.entryId);
  });

  it('parallele Abschlüsse desselben Tokens: genau ein Eintrag, beide Antworten passen dazu', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    const body = finishBody(dev, start.body.token, state);
    const results = await Promise.all([
      post<FinishRunResponse & ApiErrorBody>('/api/runs/finish', body),
      post<FinishRunResponse & ApiErrorBody>('/api/runs/finish', body),
    ]);
    const entries = db.query<{ id: string }>('SELECT id FROM entries');
    expect(entries).toHaveLength(1);
    expect(results.some((r) => r.status === 200)).toBe(true);
    for (const r of results) {
      // Entweder dasselbe Ergebnis – oder (solange der andere noch speichert) 409 token_used.
      if (r.status === 200) expect(r.body.entryId).toBe(entries[0].id);
      else expect([r.status, r.body.error]).toEqual([409, 'token_used']);
    }
  });

  it('Token gerade in Wertung (Eintrag noch nicht sichtbar) → 409 token_used', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    db.update('UPDATE run_tokens SET finished_at = ?, entry_id = ? WHERE token = ?', Date.now(), crypto.randomUUID(), start.body.token);
    const res = await post<ApiErrorBody>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('token_used');
  });

  it('scheitert das Speichern, wird der Token wieder freigegeben', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    const broken: Env = {
      DB: {
        prepare: (q) => db.prepare(q),
        batch: async (statements) => {
          if (statements.some((s) => (s as unknown as { sql: string }).sql.includes('INSERT INTO entries'))) {
            throw new Error('D1 nicht erreichbar');
          }
          return db.batch(statements);
        },
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await call<ApiErrorBody>('POST', '/api/runs/finish', finishBody(dev, start.body.token, state), {}, broken);
    spy.mockRestore();
    expect(failed.status).toBe(500);
    expect(db.query('SELECT finished_at, entry_id FROM run_tokens WHERE token = ?', start.body.token)).toEqual([
      { finished_at: null, entry_id: null },
    ]);
    expect(db.query('SELECT * FROM entries')).toHaveLength(0);
    const ok = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(ok.status).toBe(200);
    expectMatches(ok.body, state);
  });

  it('ein Fehler bei der Platzberechnung macht den gespeicherten Run nicht zum 500', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    const flaky: Env = {
      DB: {
        prepare: (q) => db.prepare(q),
        batch: async (statements) => {
          if (statements.some((s) => (s as unknown as { sql: string }).sql.includes('AS pos FROM best_entries'))) {
            throw new Error('D1 überlastet');
          }
          return db.batch(statements);
        },
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call<FinishRunResponse>('POST', '/api/runs/finish', finishBody(dev, start.body.token, state), {}, flaky);
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body.rankToday).toBeNull();
    expect(res.body.rankAllTime).toBeNull();
    expectMatches(res.body, state);
    expect(db.query('SELECT id FROM entries')).toEqual([{ id: res.body.entryId }]);
    // Erneut gesendet (normale DB): dasselbe Ergebnis, jetzt mit Plätzen.
    const again = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(again.body).toEqual({ ...res.body, rankToday: 1, rankAllTime: 1 });
  });

  it('manipulierte Züge → 422 invalid_run (Token bleibt nutzbar)', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    const good = finishBody(dev, start.body.token, state);
    const legend = ALL.find((p) => p.leg && p.types.includes('dragon'))!;
    const tampered: [string, PickLog[]][] = [
      ['anderes Pokémon', state.picks.map((p, i) => (i === 3 ? { ...p, pokemonId: legend.id } : p))],
      ['unbekanntes Pokémon', state.picks.map((p, i) => (i === 0 ? { ...p, pokemonId: 99_999 } : p))],
      ['doppelter Slot', state.picks.map((p, i) => (i === 1 ? { ...p, slot: state.picks[0].slot } : p))],
      ['Standardschütze ohne SS', state.picks.map((p, i) => (i === 2 ? { ...p, slot: SS_SLOT } : p))],
      ['zu wenige Züge', state.picks.slice(0, 10)],
      ['erfundener Reroll', state.picks.map((p, i) => (i === 0 ? { ...p, rerolls: ['magic' as RerollKind] } : p))],
      [
        'zu viele Rerolls',
        state.picks.map((p, i) => (i === 0 ? { ...p, rerolls: ['type', 'type'] as RerollKind[] } : p)),
      ],
      ['Pokémon-Reroll in 34–0', state.picks.map((p, i) => (i === 0 ? { ...p, rerolls: ['pokemon' as RerollKind] } : p))],
    ];
    for (const [label, picks] of tampered) {
      const res = await post<ApiErrorBody>('/api/runs/finish', { ...good, picks });
      expect(res.status, label).toBe(422);
      expect(res.body.error, label).toBe('invalid_run');
      expect(res.body.message, label).toMatch(/^Ungültiger Run/);
    }
    // Falsche Formation zum selben Protokoll fällt ebenfalls auf (andere Slots).
    const wrongSs = await post<ApiErrorBody>('/api/runs/finish', { ...good, ssEnabled: true });
    expect(wrongSs.status).toBe(422);

    const ok = await post<FinishRunResponse>('/api/runs/finish', good);
    expect(ok.status).toBe(200);
    expectMatches(ok.body, state);
  });

  it('Züge mit fremdem Seed sind ungültig', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: (start.body.seed + 1) % 2 ** 31 });
    const res = await post<ApiErrorBody>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(res.status).toBe(422);
  });

  it('falscher Geräte-Schlüssel → 401', async () => {
    const dev = newDevice();
    const { start, state } = await (async () => {
      const s = await startOnline(dev);
      return {
        start: s,
        state: autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: s.body.seed }),
      };
    })();
    const thief = { ...dev, deviceSecret: hex(32) };
    const a = await startOnline(thief);
    expect(a.status).toBe(401);
    expect((a.body as unknown as ApiErrorBody).error).toBe('unauthorized');
    const b = await post<ApiErrorBody>('/api/runs/finish', finishBody(thief, start.body.token, state));
    expect(b.status).toBe(401);
    const c = await post<ApiErrorBody>('/api/player', { ...thief, player: 'Dieb' });
    expect(c.status).toBe(401);
    expect(db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', dev.deviceId)[0].name).toBe(TEST_PLAYER);
  });

  it('Geräte-ID ist unabhängig von Groß-/Kleinschreibung', async () => {
    const dev = newDevice();
    expect((await startOnline(dev)).status).toBe(200);
    expect((await startOnline({ ...dev, deviceId: dev.deviceId.toUpperCase() })).status).toBe(200);
    expect(db.query('SELECT * FROM devices')).toHaveLength(1);
  });

  it('unbekannter oder fremder Token → 404', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    const unknown = await post<ApiErrorBody>('/api/runs/finish', finishBody(dev, hex(32), state));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe('not_found');
    const other = newDevice();
    const foreign = await post<ApiErrorBody>('/api/runs/finish', finishBody(other, start.body.token, state));
    expect(foreign.status).toBe(404);
  });

  it('abgelaufener Token → 410', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    db.update(
      'UPDATE run_tokens SET created_at = ? WHERE token = ?',
      Date.now() - (LIMITS.tokenTtlHours + 1) * HOUR,
      start.body.token,
    );
    const res = await post<ApiErrorBody>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('token_expired');
    // Knapp innerhalb der Gültigkeit klappt es noch.
    db.update(
      'UPDATE run_tokens SET created_at = ? WHERE token = ?',
      Date.now() - (LIMITS.tokenTtlHours - 1) * HOUR,
      start.body.token,
    );
    expect((await post('/api/runs/finish', finishBody(dev, start.body.token, state))).status).toBe(200);
  });

  it('bereinigt alte, nie abgeschlossene Tokens', async () => {
    const dev = newDevice();
    const now = Date.now();
    const tokens = await Promise.all([1, 2, 3].map(() => startOnline(dev)));
    const [old, oldFinished, fresh] = tokens.map((t) => t.body.token);
    db.update('UPDATE run_tokens SET created_at = ? WHERE token IN (?, ?)', now - STALE_TOKEN_MS - HOUR, old, oldFinished);
    db.update('UPDATE run_tokens SET finished_at = ? WHERE token = ?', now - STALE_TOKEN_MS, oldFinished);
    expect(await deleteStaleTokens(db, now - STALE_TOKEN_MS)).toBe(1);
    const left = db.query<{ token: string }>('SELECT token FROM run_tokens').map((r) => r.token);
    expect(left.sort()).toEqual([oldFinished, fresh].sort());
  });

  it('räumt bei einem kleinen Anteil der Starts automatisch auf', async () => {
    const dev = newDevice();
    const first = await startOnline(dev);
    db.update('UPDATE run_tokens SET created_at = ? WHERE token = ?', Date.now() - STALE_TOKEN_MS - HOUR, first.body.token);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    await startOnline(dev);
    spy.mockRestore();
    expect(db.query('SELECT * FROM run_tokens WHERE token = ?', first.body.token)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- Tägliche Elf

describe('Tägliche Elf', () => {
  const DAY = '2026-10-12';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${DAY}T10:00:00Z`));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Seed des Tages, deterministischer Saison-Seed', async () => {
    const dev = newDevice();
    const { start, state, finish } = await playOnline(dev, { challenge: 'daily', ssEnabled: true, rerolls: ['region'] });
    expect(start.body.day).toBe(DAY);
    expect(start.body.seed).toBe(dailyRunSeed(DAY));
    expect(finish.status, JSON.stringify(finish.body)).toBe(200);
    expect(finish.body.day).toBe(DAY);
    expect(finish.body.seasonSeed).toBe(dailySeasonSeed(DAY));
    expectMatches(finish.body, state);
  });

  it('nur ein gewerteter Versuch pro Gerät und Tag', async () => {
    const dev = newDevice();
    const early = await startOnline(dev, 'daily');
    const { finish } = await playOnline(dev, { challenge: 'daily' });
    expect(finish.status).toBe(200);

    const again = await startOnline(dev, 'daily');
    expect(again.status).toBe(409);
    expect((again.body as unknown as ApiErrorBody).error).toBe('already_played');
    expect((again.body as unknown as ApiErrorBody).message).toMatch(/12\.10\.2026/);

    // Ein vor dem ersten Abschluss gestarteter Token zählt auch nicht mehr.
    const state = autoPlay({ challenge: 'daily', formation: '4-4-2', ssEnabled: false, seed: early.body.seed });
    const late = await post<ApiErrorBody>('/api/runs/finish', finishBody(dev, early.body.token, state));
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('already_played');

    // Andere Challenges bleiben frei, am nächsten Tag geht es weiter.
    expect((await startOnline(dev, 'c340')).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    const tomorrow = await startOnline(dev, 'daily');
    expect(tomorrow.status).toBe(200);
    expect(tomorrow.body.day).toBe('2026-10-13');
    expect(tomorrow.body.seed).toBe(dailyRunSeed('2026-10-13'));
  });

  it('erneut gesendeter Tages-Abschluss → gespeichertes Ergebnis statt „schon gespielt"', async () => {
    const dev = newDevice();
    const { start, state, finish } = await playOnline(dev, { challenge: 'daily' });
    expect(finish.status).toBe(200);
    const again = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(again.status).toBe(200);
    expect(again.body).toEqual(finish.body);
    expect(again.body.seasonSeed).toBe(dailySeasonSeed(DAY));
    expect(db.query('SELECT * FROM entries')).toHaveLength(1);
  });

  it('parallele Abschlüsse zweier Tages-Tokens: nur einer wird gewertet', async () => {
    const dev = newDevice();
    const [a, b] = await Promise.all([startOnline(dev, 'daily'), startOnline(dev, 'daily')]);
    const state = autoPlay({ challenge: 'daily', formation: '4-3-3', ssEnabled: false, seed: a.body.seed });
    const results = await Promise.all([
      post<ApiErrorBody>('/api/runs/finish', finishBody(dev, a.body.token, state)),
      post<ApiErrorBody>('/api/runs/finish', finishBody(dev, b.body.token, state)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error).toBe('already_played');
    expect(db.query('SELECT * FROM entries')).toHaveLength(1);
    // Der unterlegene Token bleibt offen; erneut gesendet heißt es weiterhin „schon gespielt".
    const loser = [a, b][results.findIndex((r) => r.status === 409)].body.token;
    expect(db.query('SELECT finished_at, entry_id FROM run_tokens WHERE token = ?', loser)).toEqual([
      { finished_at: null, entry_id: null },
    ]);
    const retry = await post<ApiErrorBody>('/api/runs/finish', finishBody(dev, loser, state));
    expect([retry.status, retry.body.error]).toEqual([409, 'already_played']);
  });

  it('zweiter Tages-Eintrag scheitert am UNIQUE-Index → „schon gespielt", Token wieder frei', async () => {
    const dev = newDevice();
    const [a, b] = [await startOnline(dev, 'daily'), await startOnline(dev, 'daily')];
    const state = autoPlay({ challenge: 'daily', formation: '4-3-3', ssEnabled: false, seed: a.body.seed });
    expect((await post('/api/runs/finish', finishBody(dev, a.body.token, state))).status).toBe(200);
    // Vorabprüfung ausblenden, damit erst der UNIQUE-Index greift.
    const blind: Env = {
      DB: {
        prepare: (q) => db.prepare(q.startsWith('SELECT 1 AS x FROM entries') ? `${q.replace(' LIMIT 1', '')} AND 0` : q),
        batch: (statements) => db.batch(statements),
      },
    };
    const res = await call<ApiErrorBody>('POST', '/api/runs/finish', finishBody(dev, b.body.token, state), {}, blind);
    expect([res.status, res.body.error]).toEqual([409, 'already_played']);
    // Der Token war schon beansprucht und wurde wieder freigegeben.
    expect(db.executed.filter((e) => e.sql.startsWith('UPDATE run_tokens SET finished_at = NULL'))).toHaveLength(1);
    expect(db.query('SELECT finished_at, entry_id FROM run_tokens WHERE token = ?', b.body.token)).toEqual([
      { finished_at: null, entry_id: null },
    ]);
    expect(db.query('SELECT * FROM entries')).toHaveLength(1);
    // Allzeit, Tag und Woche
    expect(db.query('SELECT * FROM best_entries')).toHaveLength(3);
  });

  it('gleiche Elf → gleiches Ergebnis für alle', async () => {
    const one = await playOnline(newDevice(), { challenge: 'daily', formation: '5-3-2', ssEnabled: true, teamName: 'A' });
    const two = await playOnline(newDevice(), { challenge: 'daily', formation: '5-3-2', ssEnabled: true, teamName: 'B' });
    expect(one.finish.status).toBe(200);
    expect(two.finish.status).toBe(200);
    expect(two.state.picks).toEqual(one.state.picks);
    expect(two.finish.body.seasonSeed).toBe(one.finish.body.seasonSeed);
    expect(two.finish.body.score).toBe(one.finish.body.score);
    expect(two.finish.body.record).toEqual(one.finish.body.record);
    expect(two.finish.body.points).toBe(one.finish.body.points);
  });

  it('ein über Mitternacht gespielter Tages-Run zählt für seinen Starttag', async () => {
    const dev = newDevice();
    const start = await startOnline(dev, 'daily');
    vi.setSystemTime(new Date('2026-10-12T22:30:00Z')); // 00:30 in Berlin am 13.10.
    const state = autoPlay({ challenge: 'daily', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    const res = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(res.status).toBe(200);
    expect(res.body.day).toBe(DAY);
    expect(res.body.seasonSeed).toBe(dailySeasonSeed(DAY));
    expect(res.body.rankToday).toBeNull();
    expect(res.body.rankAllTime).toBe(1);
  });
});

// ---------------------------------------------------------------- Rangliste

describe('Rangliste', () => {
  const board = (q: string) => get<LeaderboardResponse>(`/api/leaderboard?${q}`);

  it('leere Wertung', async () => {
    const res = await board('challenge=c340&period=today');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: 'c340', period: 'today', day: dayKey(), players: 0, rows: [], mine: null });
  });

  it('bester Run je Gerät, sortiert nach Punkten, Score, Zeitpunkt', async () => {
    const t = Date.now() - 10 * HOUR;
    const [a, b, c, d] = ['aa', 'bb', 'cc', 'dd'].map((x) => x.repeat(16));
    insertSynthetic(a, { points: 70, score: 600, createdAt: t, name: 'Anna' });
    const aBest = insertSynthetic(a, { points: 80, score: 500, createdAt: t + 1, name: 'Anna' });
    insertSynthetic(a, { points: 80, score: 400, createdAt: t + 2, name: 'Anna' });
    const bBest = insertSynthetic(b, { points: 80, score: 700, createdAt: t + 3, name: 'Ben' });
    const cBest = insertSynthetic(c, { points: 80, score: 500, createdAt: t - 5, name: 'Cleo' });
    const dBest = insertSynthetic(d, { points: 90, score: 100, createdAt: t + 4, name: 'Dora' });
    insertSynthetic(d, { points: 99, score: 999, createdAt: t, challenge: 'c151', name: 'Dora' });

    const res = await board('challenge=c340&period=all');
    expect(res.status).toBe(200);
    expect(res.body.players).toBe(4);
    expect(res.body.rows.map((r) => [r.rank, r.player, r.entryId])).toEqual([
      [1, 'Dora', dBest],
      [2, 'Ben', bBest],
      [3, 'Cleo', cBest],
      [4, 'Anna', aBest],
    ]);
    const row = res.body.rows[3];
    expect(row).toMatchObject({ points: 80, score: 500, formation: '4-3-3', teamName: 'Synth', me: false });
    expect(row.record).toEqual({ w: 10, d: 4, l: 20 });
    expect(row.createdAt).toBe(new Date(t + 1).toISOString());
    expect(res.body.mine).toBeNull();

    const c151 = await board('challenge=c151&period=all');
    expect(c151.body.rows).toHaveLength(1);
    expect(c151.body.rows[0].points).toBe(99);
  });

  it('heute vs. allzeit', async () => {
    const now = Date.now();
    const [a, b] = ['a1', 'b2'].map((x) => x.repeat(16));
    insertSynthetic(a, { points: 50, score: 500, createdAt: now - 1000 });
    insertSynthetic(b, { points: 90, score: 500, createdAt: now - 2 * 86_400_000, day: '2000-01-01' });
    insertSynthetic(a, { points: 95, score: 500, createdAt: now - 3 * 86_400_000, day: '2000-01-02' });

    const today = await board('challenge=c340&period=today');
    expect(today.body.day).toBe(dayKey());
    expect(today.body.players).toBe(1);
    expect(today.body.rows.map((r) => r.points)).toEqual([50]);

    const all = await board('challenge=c340&period=all');
    expect(all.body.players).toBe(2);
    expect(all.body.rows.map((r) => r.points)).toEqual([95, 90]);
    expect(all.body.rows[0].day).toBe('2000-01-02');
  });

  it('echte Runs: me-Markierung, eigene Zeile außerhalb des Limits, Ränge nach finish', async () => {
    const t = Date.now() - HOUR;
    for (let i = 0; i < 5; i++) insertSynthetic(`${i}`.repeat(32), { points: 102 - i, score: 999, createdAt: t + i });
    const dev = newDevice();
    const { finish } = await playOnline(dev, { player: 'Rocko' });
    expect(finish.status).toBe(200);
    expect(finish.body.rankToday).toBe(6);
    expect(finish.body.rankAllTime).toBe(6);

    const res = await board(`challenge=c340&period=today&limit=3&me=${dev.deviceId}`);
    expect(res.body.rows).toHaveLength(3);
    expect(res.body.rows.every((r) => !r.me)).toBe(true);
    expect(res.body.players).toBe(6);
    expect(res.body.mine).toMatchObject({ rank: 6, player: 'Rocko', me: true, entryId: finish.body.entryId });
    expect(res.body.mine!.points).toBe(finish.body.points);

    const full = await board(`challenge=c340&period=all&me=${dev.deviceId.toUpperCase()}`);
    expect(full.body.rows).toHaveLength(6);
    expect(full.body.rows[5]).toMatchObject({ rank: 6, me: true });
    expect(full.body.mine).toEqual(full.body.rows[5]);

    const stranger = await board(`challenge=c340&period=all&me=${newDevice().deviceId}`);
    expect(stranger.body.mine).toBeNull();
    expect(stranger.body.rows.some((r) => r.me)).toBe(false);
  });

  it('zeigt den aktuellen Namen nach Umbenennung', async () => {
    const dev = newDevice();
    await playOnline(dev, { player: 'Alt' });
    const rename = await post<{ ok: boolean }>('/api/player', { ...dev, player: '  Neuer\u0007 Name\u202E ' });
    expect(rename.status).toBe(200);
    expect(rename.body).toEqual({ ok: true });
    const res = await board(`challenge=c340&period=all&me=${dev.deviceId}`);
    expect(res.body.rows[0].player).toBe('Neuer Name');
    expect(res.body.mine!.player).toBe('Neuer Name');
  });

  it('verrät keine Geräte-IDs, Schlüssel oder Hashes', async () => {
    const dev = newDevice();
    await playOnline(dev);
    const [device] = db.query<{ secret_hash: string; ip_hash: string | null }>('SELECT * FROM devices WHERE id = ?', dev.deviceId);
    for (const period of ['today', 'all']) {
      const res = await board(`challenge=c340&period=${period}&me=${dev.deviceId}`);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(dev.deviceId);
      expect(res.text).not.toContain(dev.deviceSecret);
      expect(res.text).not.toContain(device.secret_hash);
      expect(res.text.toLowerCase()).not.toContain('device');
      expect(res.text.toLowerCase()).not.toContain('secret');
    }
  });

  it('Limit und Standardwerte', async () => {
    const t = Date.now() - HOUR;
    for (let i = 0; i < 60; i++) insertSynthetic(`d${i}`.padEnd(32, 'f'), { points: i, score: 1, createdAt: t });
    expect((await board('challenge=c340')).body.rows).toHaveLength(50);
    expect((await board('challenge=c340')).body.period).toBe('all');
    expect((await board('challenge=c340&limit=7')).body.rows.map((r) => r.points)).toEqual([59, 58, 57, 56, 55, 54, 53]);
    expect((await board(`challenge=c340&limit=${LIMITS.leaderboardMax}`)).body.rows).toHaveLength(60);
  });

  it('Bestwerte ergeben dieselbe Wertung wie die Auswertung aller Runs (auch bei Gleichstand)', async () => {
    // Kleiner deterministischer Zufall mit vielen Gleichständen bei Punkten, Score und Zeitpunkt.
    let x = 12345;
    const rnd = (n: number) => {
      x = (x * 1103515245 + 12345) % 2 ** 31;
      return x % n;
    };
    const today = dayKey();
    const t = Date.now() - 10 * HOUR;
    const devices = Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(32, 'a'));
    interface Synth {
      id: string;
      device: string;
      points: number;
      score: number;
      createdAt: number;
      day: string;
    }
    const all: Synth[] = [];
    for (let n = 0; n < 160; n++) {
      const device = devices[rnd(devices.length)];
      const e = { points: 60 + rnd(4), score: 500 + rnd(3), createdAt: t + rnd(5), day: rnd(3) ? today : '2000-01-01' };
      all.push({ ...e, device, id: insertSynthetic(device, e) });
    }
    // Referenz wie früher: bester Run je Gerät, dann Punkte ↓, Score ↓, Zeitpunkt ↑, ID ↑.
    const order = (a: Synth, b: Synth) =>
      b.points - a.points || b.score - a.score || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const reference = (period: 'today' | 'all') => {
      const best = new Map<string, Synth>();
      for (const e of all) {
        if (period === 'today' && e.day !== today) continue;
        const cur = best.get(e.device);
        if (!cur || order(e, cur) < 0) best.set(e.device, e);
      }
      return [...best.values()].sort(order);
    };
    for (const period of ['today', 'all'] as const) {
      const ref = reference(period);
      const res = await board(`challenge=c340&period=${period}&limit=${LIMITS.leaderboardMax}`);
      expect(res.body.players).toBe(ref.length);
      expect(res.body.rows.map((r) => [r.rank, r.entryId])).toEqual(ref.map((e, i) => [i + 1, e.id]));
      for (const [i, e] of ref.entries()) {
        const mine = await board(`challenge=c340&period=${period}&limit=3&me=${e.device}`);
        expect(mine.body.mine, `${period} ${e.device}`).toMatchObject({ rank: i + 1, entryId: e.id, me: true });
      }
    }
  });

  it('Rangliste und Plätze lesen über Indizes – kein Durchlauf aller Runs, keine Sortierung', async () => {
    const t = Date.now() - HOUR;
    for (let i = 0; i < 300; i++) {
      const device = `${i}`.padStart(32, 'c');
      for (let k = 0; k < 3; k++) {
        insertSynthetic(device, {
          points: (i * 7 + k) % 90,
          score: (i * 13 + k) % 700,
          createdAt: t + k,
          day: k ? dayKey() : '2000-01-01',
        });
      }
    }
    const dev = newDevice();
    // Schema und einmalige Bereinigung (darf als Einmal-Aufgabe alles lesen) vor der Messung.
    await get('/api/health');
    db.executed.length = 0;
    const { finish } = await playOnline(dev);
    expect(finish.status).toBe(200);
    expect(finish.body.rankAllTime).toBeGreaterThan(0);
    for (const period of ['today', 'all']) {
      const res = await board(`challenge=c340&period=${period}&me=${dev.deviceId}`);
      expect(res.status).toBe(200);
      expect(res.body.mine).not.toBeNull();
    }
    const statements = db.executed.filter((e) => /^\s*(SELECT|UPDATE|DELETE|INSERT)/i.test(e.sql));
    expect(statements.some((e) => e.sql.includes('ORDER BY b.points DESC'))).toBe(true);
    expect(statements.some((e) => e.sql.includes('AS pos FROM best_entries'))).toBe(true);
    for (const { sql, params } of statements) {
      const plan = db.plan(sql, ...params);
      const bad = plan.filter((l) => /^SCAN /.test(l) || l.includes('TEMP B-TREE'));
      expect(bad, `${sql}\n→ ${plan.join('\n→ ')}`).toEqual([]);
    }
    const top = statements.find((e) => e.sql.includes('ORDER BY b.points DESC'))!;
    expect(db.plan(top.sql, ...top.params)[0]).toMatch(/^SEARCH b USING INDEX idx_best_entries_rank \(challenge=\? AND scope=\?\)/);
  });

  it('nur der beste Run je Gerät steht in den Bestwerten (Allzeit, Tag und Woche)', async () => {
    const dev = newDevice();
    for (let choice = 0; choice < 3; choice++) expect((await playOnline(dev, { choice })).finish.status).toBe(200);
    const [best] = db.query<{ id: string }>(
      'SELECT id FROM entries WHERE device_id = ? ORDER BY points DESC, score DESC, created_at, id LIMIT 1',
      dev.deviceId,
    );
    const rows = db.query<{ scope: string; entry_id: string }>(
      'SELECT scope, entry_id FROM best_entries WHERE device_id = ? ORDER BY scope',
      dev.deviceId,
    );
    expect(rows).toEqual([
      { scope: dayKey(), entry_id: best.id },
      { scope: weekKey(dayKey()), entry_id: best.id },
      { scope: ALL_TIME_SCOPE, entry_id: best.id },
    ]);
    expect(db.query('SELECT * FROM entries')).toHaveLength(3);
  });

  it('ungültige Abfragen → 400', async () => {
    for (const q of [
      '',
      'challenge=xyz',
      'challenge=c340&period=month',
      'challenge=c340&limit=0',
      'challenge=c340&limit=101',
      'challenge=c340&limit=abc',
      'challenge=c340&limit=5.5',
      'challenge=c340&me=nicht-gueltig',
    ]) {
      const res = await board(q);
      expect(res.status, q).toBe(400);
      expect((res.body as unknown as ApiErrorBody).error, q).toBe('bad_request');
    }
  });
});

// ---------------------------------------------------------------- Spielername

describe('POST /api/player', () => {
  it('registriert ein neues Gerät und setzt den Namen', async () => {
    const dev = newDevice();
    const res = await post('/api/player', { ...dev, player: 'Gary' });
    expect(res.status).toBe(200);
    expect(db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', dev.deviceId)[0].name).toBe('Gary');
  });

  it('prüft den Namen vor der Anmeldung', async () => {
    const dev = newDevice();
    for (const player of ['', '   ', '\u0000\u0001', 'x'.repeat(LIMITS.playerMax + 1), 42, null]) {
      const res = await post<ApiErrorBody>('/api/player', { ...dev, player });
      expect(res.status, String(player)).toBe(400);
    }
    expect(db.query('SELECT * FROM devices')).toHaveLength(0);
    // Emoji zählen als ein Zeichen.
    expect((await post('/api/player', { ...dev, player: '⚽'.repeat(LIMITS.playerMax) })).status).toBe(200);
  });

  it('unsichtbare oder leer aussehende Namen → 400', async () => {
    const dev = newDevice();
    const invisible = [
      '\u200B', // Nullbreite-Leerzeichen
      '\u2060', // Wortverbinder
      '\u3164', // Hangul-Filler
      '\u2800', // leere Braille-Zelle
      '\u00AD', // weiches Trennzeichen
      '\u200D', // ZWJ ohne Emoji
      '\uFEFF ',
      '\u202E\u2066',
      '\u0301\u0301', // nur Akzente
      '-_-', // nichts Sichtbares außer Satzzeichen
    ];
    for (const player of invisible) {
      const res = await post<ApiErrorBody>('/api/player', { ...dev, player });
      expect(res.status, JSON.stringify(player)).toBe(400);
      // Was gesäubert leer ist, gilt als fehlender (Standard-)Name; der Rest hat nichts Sichtbares.
      expect(res.body.error, JSON.stringify(player)).toBe(cleanText(player) ? 'bad_request' : 'bad_name');
    }
    expect(db.query('SELECT * FROM devices')).toHaveLength(0);
    const res = await post<ApiErrorBody>('/api/player', { ...dev, player: '-_-' });
    expect(res.body.message).toMatch(/Buchstaben, eine Ziffer oder ein Emoji/);
  });

  it('speichert Namen gesäubert: NFC, ohne Formatzeichen, Akzente begrenzt, Emoji-Sequenzen bleiben', async () => {
    const dev = newDevice();
    const cases: [string, string][] = [
      ['Ash\u200B', 'Ash'],
      ['\u3164Ash\u3164', 'Ash'],
      ['A\u2800\u2800sh', 'A sh'],
      ['A\u00ADsh\u2060', 'Ash'],
      [`a${'\u0301'.repeat(23)}`, 'á\u0301\u0301'],
      ['Zoe\u0308', 'Zoë'],
      ['\u{1F469}\u200D\u{1F4BB} Dev', '\u{1F469}\u200D\u{1F4BB} Dev'],
      ['\u{1F469}\u{1F3FD}\u200D\u{1F4BB}', '\u{1F469}\u{1F3FD}\u200D\u{1F4BB}'],
      ['❤\uFE0F\u200D\u{1F525}', '❤\uFE0F\u200D\u{1F525}'],
      ['a\u200Db', 'ab'],
      [`${'x'.repeat(LIMITS.playerMax)}${'\u200B'.repeat(10)}`, 'x'.repeat(LIMITS.playerMax)],
    ];
    for (const [player, stored] of cases) {
      const res = await post('/api/player', { ...dev, player });
      expect(res.status, JSON.stringify(player)).toBe(200);
      expect(db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', dev.deviceId)[0].name).toBe(stored);
    }
  });
});

describe('Namen säubern', () => {
  it('cleanText', () => {
    expect(cleanText('  Neuer\u0007 Name\u202E ')).toBe('Neuer Name');
    expect(cleanText('\uD800Ash')).toBe('Ash'); // einzelnes Surrogat
    expect(cleanText('Ash\u{E0041}')).toBe('Ash'); // Tag-Zeichen (unsichtbar)
    expect(cleanText('\u{1F44D}\u200D\u200D\u{1F44D}')).toBe('\u{1F44D}\u200D\u{1F44D}');
    expect(cleanText(`ก${'\u0E31\u0E49'.repeat(5)}`)).toBe('ก\u0E31\u0E49'); // Thai: Grundzeichen + 2 Zeichen
  });

  it('Teamname ohne Sichtbares wird leer, Spielername wird abgelehnt', () => {
    expect(parseTeamName('\u200B\u3164')).toBe('');
    expect(parseTeamName('---')).toBe('');
    expect(parseTeamName(' Elf\u200B 11 ')).toBe('Elf 11');
    expect(() => parsePlayerName('\u2800')).toThrow(/leer/);
    expect(() => parsePlayerName('\u0301 ?')).toThrow(/Buchstaben/);
    expect(parsePlayerName('7')).toBe('7');
    expect(parsePlayerName('⚽')).toBe('⚽');
  });

  it('beim Abschluss: unsichtbarer Spielername lässt den Namen stehen, der Run zählt', async () => {
    const dev = newDevice();
    expect((await post('/api/player', { ...dev, player: 'Misty' })).status).toBe(200);
    const { finish } = await playOnline(dev, { player: '\u200B\u3164', teamName: ' Elf\u200B 11 ' });
    expect(finish.status, JSON.stringify(finish.body)).toBe(200);
    expect(db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', dev.deviceId)[0].name).toBe('Misty');
    expect(db.query<{ team_name: string }>('SELECT team_name FROM entries')[0].team_name).toBe('Elf 11');
  });
});

// ---------------------------------------------------------------- Eingaben

describe('ungültige Eingaben → 400', () => {
  it('start', async () => {
    const dev = newDevice();
    const cases: [string, unknown][] = [
      ['unbekannte Challenge', { ...dev, challenge: 'c999' }],
      ['fehlende Challenge', { ...dev }],
      ['Secret zu kurz', { ...dev, deviceSecret: 'abc', challenge: 'c340' }],
      ['Secret groß geschrieben', { ...dev, deviceSecret: dev.deviceSecret.toUpperCase(), challenge: 'c340' }],
      ['Secret kein Hex', { ...dev, deviceSecret: 'g'.repeat(64), challenge: 'c340' }],
      ['Geräte-ID ungültig', { ...dev, deviceId: 'hallo', challenge: 'c340' }],
      ['Geräte-ID fehlt', { deviceSecret: dev.deviceSecret, challenge: 'c340' }],
      ['kein Objekt', [1, 2, 3]],
      ['null', null],
    ];
    for (const [label, body] of cases) {
      const res = await post<ApiErrorBody>('/api/runs/start', body);
      expect(res.status, label).toBe(400);
      expect(res.body.error, label).toBe('bad_request');
      expect(res.body.message.length, label).toBeGreaterThan(5);
    }
    const notJson = await post<ApiErrorBody>('/api/runs/start', '{"deviceId": kaputt');
    expect(notJson.status).toBe(400);
    expect(notJson.body.message).toMatch(/JSON/);
    const huge = await post<ApiErrorBody>('/api/runs/start', { ...dev, challenge: 'c340', pad: 'x'.repeat(20_000) });
    expect(huge.status).toBe(400);
    expect(db.query('SELECT * FROM devices')).toHaveLength(0);
  });

  it('finish', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    const good = finishBody(dev, start.body.token, state);
    const cases: [string, Record<string, unknown>][] = [
      ['Teamname zu lang', { teamName: 'x'.repeat(LIMITS.teamNameMax + 1) }],
      ['Teamname kein Text', { teamName: 5 }],
      ['Formation unbekannt', { formation: '4-6-0' }],
      ['ssEnabled kein Boolean', { ssEnabled: 'ja' }],
      ['Token ungültig', { token: 'abc' }],
      ['Spieler fehlt', { player: undefined }],
      ['Spieler zu lang', { player: 'y'.repeat(LIMITS.playerMax + 1) }],
      ['picks kein Array', { picks: 'alle' }],
      ['zu viele picks', { picks: [...state.picks, state.picks[0], state.picks[0]] }],
      ['pick kein Objekt', { picks: [1, ...state.picks.slice(1)] }],
      ['pokemonId Kommazahl', { picks: [{ ...state.picks[0], pokemonId: 1.5 }, ...state.picks.slice(1)] }],
      ['pokemonId Text', { picks: [{ ...state.picks[0], pokemonId: '25' }, ...state.picks.slice(1)] }],
      ['slot außerhalb', { picks: [{ ...state.picks[0], slot: 12 }, ...state.picks.slice(1)] }],
      ['rerolls kein Array', { picks: [{ ...state.picks[0], rerolls: 'type' }, ...state.picks.slice(1)] }],
      ['rerolls keine Texte', { picks: [{ ...state.picks[0], rerolls: [1] }, ...state.picks.slice(1)] }],
      ['Secret falsches Format', { deviceSecret: 'nope' }],
    ];
    for (const [label, patch] of cases) {
      const res = await post<ApiErrorBody>('/api/runs/finish', { ...good, ...patch });
      expect(res.status, label).toBe(400);
      expect(res.body.error, label).toBe('bad_request');
    }
    // Nichts davon hat den Token verbraucht.
    const ok = await post<FinishRunResponse>('/api/runs/finish', { ...good, teamName: '  Kontroll\u0000\u202Ename ' });
    expect(ok.status).toBe(200);
    const [entry] = db.query<{ team_name: string }>('SELECT team_name FROM entries');
    expect(entry.team_name).toBe('Kontrollname');
  });

  it('leerer Teamname → 400 team_name_required, der Token bleibt nutzbar', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    for (const teamName of ['', '   ', '​ㅤ', '⠀', '---', null]) {
      const res = await post<ApiErrorBody>('/api/runs/finish', { ...finishBody(dev, start.body.token, state), teamName });
      expect([res.status, res.body.error], JSON.stringify(teamName)).toEqual([400, 'team_name_required']);
      expect(res.body.message).toMatch(/Teamnamen/);
    }
    expect(db.query('SELECT * FROM entries')).toHaveLength(0);
    expect(db.query('SELECT finished_at FROM run_tokens WHERE token = ?', start.body.token)).toEqual([{ finished_at: null }]);
    const ok = await post<FinishRunResponse>(
      '/api/runs/finish',
      finishBody(dev, start.body.token, state, { teamName: '  Team​  Rakete ' }),
    );
    expect(ok.status).toBe(200);
    expectMatches(ok.body, state, 'Team Rakete');
    expect(db.query<{ team_name: string }>('SELECT team_name FROM entries')[0].team_name).toBe('Team Rakete');
  });
});

// ---------------------------------------------------------------- Body-Größe

describe('Body-Limit', () => {
  const streamed = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/player', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);

  it('gilt auch ohne Content-Length (gestreamt) – gelesen wird nur bis zum Limit', async () => {
    let pulls = 0;
    const chunk = new Uint8Array(1024).fill(0x20); // Leerzeichen
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        if (pulls > 30 * 1024) c.close(); // 30 MB, falls alles gelesen würde
        else c.enqueue(chunk);
      },
    });
    const req = streamed(body);
    expect(req.headers.get('content-length')).toBeNull();
    const res = await handleApi(req, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).message).toBe('Anfrage ist zu groß');
    expect(pulls).toBeLessThan(MAX_BODY_BYTES / 1024 + 5);
    expect(db.query('SELECT * FROM devices')).toHaveLength(0);
  });

  it('angekündigte Länge über dem Limit → 400, ohne den Body zu lesen', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(new Uint8Array(1024));
      },
    });
    const res = await handleApi(streamed(body, { 'Content-Length': String(MAX_BODY_BYTES + 1) }), env);
    expect(res.status).toBe(400);
    expect(pulls).toBeLessThanOrEqual(1);
  });

  it('gestreamter Body unter dem Limit wird vollständig gelesen (auch geteilte UTF-8-Zeichen)', async () => {
    const dev = newDevice();
    const bytes = new TextEncoder().encode(JSON.stringify({ ...dev, player: 'Jürgen ⚽' }));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    const res = await handleApi(streamed(body), env);
    expect(res.status).toBe(200);
    expect(db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', dev.deviceId)[0].name).toBe('Jürgen ⚽');
  });

  it('genau MAX_BODY_BYTES Bytes sind erlaubt, ein Byte mehr nicht', async () => {
    const dev = newDevice();
    const base = JSON.stringify({ ...dev, player: 'Ok', pad: '' });
    const exact = JSON.stringify({ ...dev, player: 'Ok', pad: 'x'.repeat(MAX_BODY_BYTES - base.length) });
    expect(new TextEncoder().encode(exact).length).toBe(MAX_BODY_BYTES);
    expect((await post('/api/player', exact)).status).toBe(200);
    const over = JSON.stringify({ ...dev, player: 'Ok', pad: 'x'.repeat(MAX_BODY_BYTES - base.length + 1) });
    expect((await post('/api/player', over)).status).toBe(400);
  });
});

// ---------------------------------------------------------------- Limits

describe('Rate-Limits → 429', () => {
  it('Starts pro Gerät und Stunde', async () => {
    const dev = newDevice();
    for (let i = 0; i < LIMITS.startsPerHour; i++) expect((await startOnline(dev)).status).toBe(200);
    const res = await startOnline(dev);
    expect(res.status).toBe(429);
    expect((res.body as unknown as ApiErrorBody).error).toBe('rate_limited');
    expect(res.headers.get('retry-after')).toBe('3600');
    // Ältere Starts zählen nicht mehr.
    db.update('UPDATE run_tokens SET created_at = created_at - ?', HOUR + 1000);
    expect((await startOnline(dev)).status).toBe(200);
    // Andere Geräte sind nicht betroffen.
    expect((await startOnline(newDevice())).status).toBe(200);
  });

  it('Abschlüsse pro Gerät und Stunde', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    const now = Date.now();
    for (let i = 0; i < LIMITS.finishesPerHour; i++) {
      db.update(
        "INSERT INTO run_tokens (token, device_id, challenge, seed, day, created_at, finished_at) VALUES (?, ?, 'c340', 1, ?, ?, ?)",
        hex(32),
        dev.deviceId,
        dayKey(),
        now - 2 * HOUR,
        now - 1000,
      );
    }
    const res = await post<ApiErrorBody>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    db.update('UPDATE run_tokens SET finished_at = ? WHERE finished_at IS NOT NULL', now - 2 * HOUR);
    expect((await post('/api/runs/finish', finishBody(dev, start.body.token, state))).status).toBe(200);
  });

  it('neue Geräte pro IP und Stunde – gespeichert wird nur ein Hash der IP', async () => {
    const ip = { 'CF-Connecting-IP': '203.0.113.7' };
    const devices = Array.from({ length: LIMITS.devicesPerIpPerHour }, newDevice);
    for (const dev of devices) expect((await startOnline(dev, 'c340', ip)).status).toBe(200);
    const blocked = await startOnline(newDevice(), 'c340', ip);
    expect(blocked.status).toBe(429);
    expect((blocked.body as unknown as ApiErrorBody).error).toBe('rate_limited');
    // Bekannte Geräte derselben IP dürfen weiter spielen, andere IPs neue Geräte anlegen.
    expect((await startOnline(devices[0], 'c340', ip)).status).toBe(200);
    expect((await startOnline(newDevice(), 'c340', { 'CF-Connecting-IP': '198.51.100.1' })).status).toBe(200);

    const rows = db.query<{ ip_hash: string }>('SELECT ip_hash FROM devices');
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.ip_hash))).toBe(true);
    const dump = JSON.stringify(db.query('SELECT * FROM devices'));
    expect(dump).not.toContain('203.0.113.7');
  });

  it('IPv6: neue Geräte zählen pro /64-Präfix (wechselnde Adressen helfen nicht)', async () => {
    for (let i = 1; i <= LIMITS.devicesPerIpPerHour; i++) {
      const res = await startOnline(newDevice(), 'c340', { 'CF-Connecting-IP': `2001:db8:1:2::${i.toString(16)}` });
      expect(res.status).toBe(200);
    }
    const blocked = await startOnline(newDevice(), 'c340', { 'CF-Connecting-IP': '2001:0DB8:1:2:ffff:eeee:dddd:cccc' });
    expect(blocked.status).toBe(429);
    // Ein anderes /64 ist ein anderer Anschluss.
    expect((await startOnline(newDevice(), 'c340', { 'CF-Connecting-IP': '2001:db8:1:3::1' })).status).toBe(200);
  });

  it('IPv4-mapped IPv6 zählt wie die IPv4-Adresse', async () => {
    const [a, b] = [newDevice(), newDevice()];
    expect((await startOnline(a, 'c340', { 'CF-Connecting-IP': '198.51.100.9' })).status).toBe(200);
    expect((await startOnline(b, 'c340', { 'CF-Connecting-IP': '::ffff:198.51.100.9' })).status).toBe(200);
    const hashes = db.query<{ ip_hash: string }>('SELECT ip_hash FROM devices WHERE id IN (?, ?)', a.deviceId, b.deviceId);
    expect(hashes).toHaveLength(2);
    expect(hashes[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[0].ip_hash).toBe(hashes[1].ip_hash);
  });

  it('normalizeIp: IPv4 vollständig, IPv6 als /64, IPv4-mapped als IPv4', () => {
    const cases: [string, string][] = [
      ['203.0.113.7', '203.0.113.7'],
      [' 203.0.113.7 ', '203.0.113.7'],
      ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
      ['2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
      ['2001:db8::1', '2001:db8:0:0::/64'],
      ['2001:db8:1:2:3::', '2001:db8:1:2::/64'],
      ['1:2:3:4:5:6:7::', '1:2:3:4::/64'],
      ['::1', '0:0:0:0::/64'],
      ['::', '0:0:0:0::/64'],
      ['fe80::1%eth0', 'fe80:0:0:0::/64'],
      ['[2001:db8::1]', '2001:db8:0:0::/64'],
      ['::ffff:203.0.113.7', '203.0.113.7'],
      ['::FFFF:cb00:7107', '203.0.113.7'],
      ['0:0:0:0:0:ffff:203.0.113.7', '203.0.113.7'],
      ['64:ff9b::203.0.113.7', '64:ff9b:0:0::/64'],
      // Ungültiges bleibt (klein geschrieben) unverändert.
      ['1::2::3', '1::2::3'],
      ['1:2:3:4:5:6:7::8', '1:2:3:4:5:6:7::8'],
      ['1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8:9'],
      ['::ffff:300.1.1.1', '::ffff:300.1.1.1'],
      ['12345::1', '12345::1'],
      ['Kein-IP', 'kein-ip'],
    ];
    for (const [raw, want] of cases) expect(normalizeIp(raw), raw).toBe(want);
  });
});

// ---------------------------------------------------------------- Datenschutz

describe('IP-Hash wird nach einer Stunde gelöscht', () => {
  const ipHash = (dev: DeviceAuth) =>
    db.query<{ ip_hash: string | null }>('SELECT ip_hash FROM devices WHERE id = ?', dev.deviceId)[0].ip_hash;

  it('beim nächsten Zugriff eines Geräts (auch bekannter Geräte)', async () => {
    const ip = { 'CF-Connecting-IP': '203.0.113.7' };
    const [old, recent, fresh] = [newDevice(), newDevice(), newDevice()];
    await startOnline(old, 'c340', ip);
    await startOnline(recent, 'c340', ip);
    db.update('UPDATE devices SET created_at = ? WHERE id = ?', Date.now() - HOUR - 1000, old.deviceId);
    db.update('UPDATE devices SET created_at = ? WHERE id = ?', Date.now() - HOUR + 60_000, recent.deviceId);
    expect(ipHash(old)).toMatch(/^[0-9a-f]{64}$/);
    // Schon der Zugriff eines bekannten Geräts räumt abgelaufene Hashes ab …
    await startOnline(recent, 'c340', ip);
    expect(ipHash(old)).toBeNull();
    // … jüngere bleiben, und neue Geräte derselben Verbindung bekommen denselben (gesalzenen) Hash.
    expect((await startOnline(fresh, 'c340', ip)).status).toBe(200);
    expect(ipHash(recent)).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash(fresh)).toBe(ipHash(recent));
    // Gelöscht wird über den Teil-Index – ohne alle Geräte zu lesen.
    const purge = db.executed.find((e) => e.sql.startsWith('UPDATE devices SET ip_hash = NULL'))!;
    expect(db.plan(purge.sql, ...purge.params)).toEqual([expect.stringMatching(/^SEARCH devices USING INDEX idx_devices_ip_expiry/)]);
  });

  it('beim gelegentlichen Aufräumen nach einem Start', async () => {
    const known = newDevice();
    await startOnline(known);
    const old = newDevice();
    await startOnline(old, 'c340', { 'CF-Connecting-IP': '203.0.113.8' });
    db.update('UPDATE devices SET created_at = ? WHERE id = ?', Date.now() - 2 * HOUR, old.deviceId);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    await startOnline(known);
    spy.mockRestore();
    expect(ipHash(old)).toBeNull();
  });

  it('das Limit neuer Geräte zählt weiter alle Geräte der letzten Stunde', async () => {
    const ip = { 'CF-Connecting-IP': '203.0.113.9' };
    for (let i = 0; i < LIMITS.devicesPerIpPerHour; i++) expect((await startOnline(newDevice(), 'c340', ip)).status).toBe(200);
    db.update('UPDATE devices SET created_at = created_at - ?', HOUR - 60_000);
    expect((await startOnline(newDevice(), 'c340', ip)).status).toBe(429);
    db.update('UPDATE devices SET created_at = created_at - ?', 120_000);
    expect((await startOnline(newDevice(), 'c340', ip)).status).toBe(200);
    expect(db.query('SELECT * FROM devices WHERE ip_hash IS NOT NULL')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- Nachträge aus der Prüfung

describe('Nachträge: Emoji-Namen, verwaiste Tokens, IP-Salz', () => {
  it('Flaggen und Keycaps zählen als sichtbare Namen', async () => {
    for (const player of ['🇩🇪', '#️⃣', '🇦🇹 Wien']) {
      const res = await post('/api/player', { ...newDevice(), player });
      expect(res.status, player).toBe(200);
    }
  });

  it('verwaister Token (Eintrag fehlt, Schonfrist vorbei) wird freigegeben und neu gewertet', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    // Zustand nach „Speichern UND Freigeben gescheitert": beansprucht, aber ohne Eintrag
    db.update(
      'UPDATE run_tokens SET finished_at = ?, entry_id = ? WHERE token = ?',
      Date.now() - ORPHAN_GRACE_MS - 1000,
      'verloren',
      start.body.token,
    );
    const res = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expectMatches(res.body, state);
    expect(db.query('SELECT id FROM entries')).toHaveLength(1);
    // Erneut gesendet → dasselbe Ergebnis
    const again = await post<FinishRunResponse>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(again.status).toBe(200);
    expect(again.body.entryId).toBe(res.body.entryId);
  });

  it('innerhalb der Schonfrist bleibt ein Token ohne Eintrag „wird gerade gewertet"', async () => {
    const dev = newDevice();
    const start = await startOnline(dev);
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.body.seed });
    db.update('UPDATE run_tokens SET finished_at = ?, entry_id = ? WHERE token = ?', Date.now(), 'gleich', start.body.token);
    const res = await post<ApiErrorBody>('/api/runs/finish', finishBody(dev, start.body.token, state));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('token_used');
  });

  it('ohne IP_SALT wird ein zufälliges Salz einmal in der Datenbank angelegt', async () => {
    const ip = { 'CF-Connecting-IP': '198.51.100.23' };
    await startOnline(newDevice(), 'c340', ip);
    await startOnline(newDevice(), 'c340', ip);
    const salts = db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'ip_salt'");
    expect(salts).toHaveLength(1);
    expect(salts[0].value).toMatch(/^[0-9a-f]{64}$/);
    // Beide Geräte derselben Verbindung → derselbe Hash (Limit greift weiter)
    const hashes = db.query<{ ip_hash: string }>('SELECT ip_hash FROM devices');
    expect(new Set(hashes.map((h) => h.ip_hash)).size).toBe(1);
  });
});

describe('Spielerprofil (GET /api/entries/:id/player)', () => {
  it('Runs und Bestwert je Wertung, letzte Runs zuerst – ohne Geräte-IDs', async () => {
    const dev = newDevice();
    const a = await playOnline(dev, { teamName: 'Erste Elf' });
    const b = await playOnline(dev, { teamName: 'Zweite Elf' });
    const c = await playOnline(dev, { challenge: 'c151', teamName: 'Retro Elf' });
    for (const r of [a, b, c]) expect(r.finish.status).toBe(200);
    const res = await get<PlayerProfile>(`/api/entries/${c.finish.body.entryId}/player`);
    expect(res.status).toBe(200);
    expect(res.body.player).toBe(TEST_PLAYER);
    expect(res.body.runs).toBe(3);
    expect(res.body.challenges.map((x) => [x.challenge, x.runs])).toEqual([
      ['c340', 2],
      ['c151', 1],
    ]);
    const best340 = res.body.challenges[0].best!;
    expect([a.finish.body.entryId, b.finish.body.entryId]).toContain(best340.entryId);
    expect(res.body.recent.map((r) => r.teamName)).toEqual(['Retro Elf', 'Zweite Elf', 'Erste Elf']);
    expect(JSON.stringify(res.body)).not.toContain(dev.deviceId.toLowerCase());
    // Link-Vorschau des Profils (worker/index.ts): Name, Runs, bester Platz
    const preview = await profilePreview(db, c.finish.body.entryId, Date.now());
    expect(preview).toEqual({ player: TEST_PLAYER, runs: 3, best: { challenge: 'c340', place: 1, players: 1 } });
    const meta = profilePageMeta(c.finish.body.entryId, preview, 'https://elf.example');
    expect(meta.title).toBe(`Profil von ${TEST_PLAYER} · Pokémon Elf`);
    expect(meta.description).toContain('3 gewertete Runs · bester Platz: 1 von 1 (34–0 Challenge)');
    expect(await profilePreview(db, crypto.randomUUID(), Date.now())).toBeNull();
    // Aktueller Allzeit-Platz je Wertung (einziger Spieler → Platz 1 von 1)
    expect(res.body.challenges.map((x) => [x.place, x.players])).toEqual([
      [1, 1],
      [1, 1],
    ]);
    // Der Bestwert ist selbst ein Ranglisten-Eintrag
    expect((await get(`/api/entries/${best340.entryId}`)).status).toBe(200);
    // Perfekte Saisons je Wertung
    expect(res.body.challenges.every((x) => Number.isInteger(x.perfect))).toBe(true);
    db.update('UPDATE entries SET wins = 34, draws = 0, losses = 0 WHERE id = ?', a.finish.body.entryId);
    const again = await get<PlayerProfile>(`/api/entries/${c.finish.body.entryId}/player`);
    const before = res.body.challenges[0].perfect;
    expect(again.body.challenges[0].perfect).toBe(before + (a.finish.body.record.d === 0 && a.finish.body.record.l === 0 ? 0 : 1));
  });

  it('unbekannt bzw. nicht in der Rangliste → 404, ungültige ID → 400', async () => {
    expect((await get(`/api/entries/${crypto.randomUUID()}/player`)).status).toBe(404);
    expect((await get('/api/entries/nicht-gueltig/player')).status).toBe(400);
  });
});
