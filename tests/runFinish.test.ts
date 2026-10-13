/**
 * Abschluss eines Runs (src/lib/runFinish.ts) mit gestubbtem fetch: 429 bleibt nachsendbar,
 * „bereits gewertet" erfindet nie eine Saison – plus die Start-Entscheidung des Hooks
 * (useChallengeRun.startFailure) und ein Ende-zu-Ende-Lauf mit blockiertem localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  apiEverOnline,
  apiHealth,
  fetchLeaderboard,
  renamePlayer,
  startRun as apiStartRun,
} from '../src/lib/api/client';
import type { ApiErrorBody, FinishRunResponse } from '../src/lib/api/contract';
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
import { dailyRunSeed, dailySeasonSeed } from '../src/lib/daily';
import { buildScale } from '../src/lib/fit';
import {
  finishErrorMessage,
  finishRun,
  isAlreadyRanked,
  isRateLimited,
  isRetryable,
  type FinishOptions,
} from '../src/lib/runFinish';
import { startFailure } from '../src/state/useChallengeRun';
import { handleApi, type Env } from '../server/handler';
import { D1Shim } from './d1shim';
import { ALL } from './helpers';

const DATA = createEngineData(ALL);
const SCALE = buildScale(ALL, 'all');
const DAY = '2026-10-12';

/** Spielt einen Run automatisch: erster wählbarer Kandidat, erster freier Slot. */
function autoPlay(config: RunConfig): RunState {
  let s = startRun(config, DATA);
  while (!isComplete(s)) {
    const pick = candidates(s, DATA).filter((p) => !legendBlocked(s, p, DATA))[0];
    let slot = s.slots.findIndex((_, i) => isFreeSlot(s, i));
    if (slot < 0) slot = SS_SLOT;
    s = place(s, pick.id, slot, DATA);
  }
  return s;
}

const C340 = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: 12345 });
const DAILY = autoPlay({ challenge: 'daily', formation: '4-4-2', ssEnabled: false, seed: dailyRunSeed(DAY) });

const opts = (over: Partial<FinishOptions> = {}): FinishOptions => ({
  state: C340,
  teamName: 'Test-Elf',
  token: 'tok',
  day: null,
  byId: DATA.byId,
  scale: SCALE,
  networkFallback: false,
  ...over,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, error: ApiErrorBody['error'], message: string) =>
  json(status, { error, message } satisfies ApiErrorBody);

const RATE_MSG = 'Zu viele gewertete Runs in kurzer Zeit – bitte später erneut versuchen';
const USED_MSG = 'Dieser Run wurde bereits gewertet';

/** Lokaler Speicher zum Nachsehen, ob Statistik/Historie geschrieben wurden. */
let stored: Map<string, string>;
const savedKeys = () => [...stored.keys()].filter((k) => /stats:|leaderboard/.test(k));

function stubFetch(answer: Response | (() => Promise<Response>)) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    typeof answer === 'function' ? answer() : answer.clone(),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Fehler-Einordnung', () => {
  it('isRetryable: Netzwerk, 5xx und 429 ja – andere 4xx nein', () => {
    expect(isRetryable(new ApiRequestError('Server nicht erreichbar', 0, 'network'))).toBe(true);
    expect(isRetryable(new ApiRequestError('kaputt', 503, 'server_error'))).toBe(true);
    expect(isRetryable(new ApiRequestError(RATE_MSG, 429, 'rate_limited'))).toBe(true);
    expect(isRetryable(new ApiRequestError(USED_MSG, 409, 'token_used'))).toBe(false);
    expect(isRetryable(new ApiRequestError('Run nicht gefunden', 404, 'not_found'))).toBe(false);
    expect(isRetryable(new ApiRequestError('Ungültiger Run', 422, 'invalid_run'))).toBe(false);
    expect(isRetryable(new Error('irgendwas'))).toBe(false);
  });

  it('finishErrorMessage: 429 zeigt die Server-Meldung, nicht „nicht erreichbar"', () => {
    const msg = finishErrorMessage(new ApiRequestError(RATE_MSG, 429, 'rate_limited'));
    expect(msg.startsWith(`${RATE_MSG}.`)).toBe(true);
    expect(msg).toMatch(/noch nicht gewertet/);
    expect(msg).not.toMatch(/nicht erreichbar/);
    expect(finishErrorMessage(new ApiRequestError('Server nicht erreichbar', 0, 'network'))).toMatch(
      /^Server nicht erreichbar/,
    );
    expect(finishErrorMessage(new ApiRequestError(USED_MSG, 409, 'token_used'))).toMatch(/schon gewertet/);
    expect(finishErrorMessage(new Error('Boom'))).toBe('Auswertung fehlgeschlagen: Boom');
  });
});

describe('finishRun', () => {
  it('200: Saison mit dem Seed des Servers, Wertung ranked', async () => {
    const res: FinishRunResponse = {
      entryId: 'e1',
      challenge: 'c340',
      day: DAY,
      seasonSeed: 4242,
      score: 0,
      record: { w: 0, d: 0, l: 34 },
      points: 0,
      rankToday: 3,
      rankAllTime: 7,
    };
    const fetch = stubFetch(json(200, res));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await finishRun(opts());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out.input.seed).toBe(4242);
    expect(out.ranking).toMatchObject({ status: 'ranked', entryId: 'e1', rankToday: 3, rankAllTime: 7, day: DAY });
    expect(savedKeys().length).toBe(2);
  });

  it('429 (networkFallback false): wird geworfen und ist nachsendbar – nichts gespeichert', async () => {
    stubFetch(apiError(429, 'rate_limited', RATE_MSG));
    const err = await finishRun(opts()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(isRateLimited(err)).toBe(true);
    expect(isRetryable(err)).toBe(true);
    expect(finishErrorMessage(err)).toContain(RATE_MSG);
    expect(savedKeys()).toEqual([]);
  });

  it('429 mit networkFallback: offline (nicht „abgelehnt") mit der Server-Meldung', async () => {
    stubFetch(apiError(429, 'rate_limited', RATE_MSG));
    const out = await finishRun(opts({ networkFallback: undefined }));
    expect(out.ranking.status).toBe('offline');
    expect(out.ranking.message).toBe(`${RATE_MSG} – Run nicht gewertet`);
  });

  it('token_used: immer geworfen – keine Zufalls-Saison, keine Statistik, keine Historie', async () => {
    for (const networkFallback of [false, true, undefined]) {
      for (const state of [C340, DAILY]) {
        stubFetch(apiError(409, 'token_used', USED_MSG));
        const err = await finishRun(opts({ state, networkFallback, day: DAY })).catch((e: unknown) => e);
        expect(isAlreadyRanked(err)).toBe(true);
        expect(isRetryable(err)).toBe(false);
      }
    }
    expect(savedKeys()).toEqual([]);
  });

  it('Netzwerkfehler (networkFallback false): geworfen, Meldung „nicht erreichbar"', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const err = await finishRun(opts()).catch((e: unknown) => e);
    expect(isRetryable(err)).toBe(true);
    expect(finishErrorMessage(err)).toMatch(/^Server nicht erreichbar/);
    expect(savedKeys()).toEqual([]);
  });

  it('andere 4xx bleiben eine Ablehnung (Tages-Challenge: Saison des Tages)', async () => {
    stubFetch(apiError(422, 'invalid_run', 'Ungültiger Run'));
    const out = await finishRun(opts({ state: DAILY, day: DAY }));
    expect(out.ranking).toMatchObject({ status: 'rejected', message: 'Ungültiger Run' });
    expect(out.input.seed).toBe(dailySeasonSeed(DAY));
  });

  it('ohne Token: lokal, ohne Server', async () => {
    const fetch = stubFetch(json(500, {}));
    const out = await finishRun(opts({ token: null }));
    expect(fetch).not.toHaveBeenCalled();
    expect(out.ranking).toMatchObject({ status: 'offline', message: 'Offline gespielt – nicht gewertet' });
  });
});

describe('Ende zu Ende mit blockiertem localStorage', () => {
  it('Start und Abschluss nutzen dasselbe Gerät → der Run wird gewertet', async () => {
    const blocked = () => {
      throw new DOMException('Zugriff verweigert', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    const env: Env = { DB: new D1Shim() };
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      handleApi(new Request(`http://localhost${url}`, init), env),
    );
    vi.resetModules();
    const client = await import('../src/lib/api/client');
    const rf = await import('../src/lib/runFinish');

    // Ohne eigenen Namen startet kein gewerteter Run
    await expect(client.startRun('c340')).rejects.toMatchObject({ status: 400, code: 'name_required' });
    await client.renamePlayer('Ash');
    const start = await client.startRun('c340');
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.seed });
    const out = await rf.finishRun(opts({ state, token: start.token, day: start.day }));
    expect(out.ranking.status).toBe('ranked');
    expect(out.ranking.entryId).toBeTruthy();
  });

  it('Antwort verloren → erneut senden zeigt genau die gewertete Saison des Servers', async () => {
    const env: Env = { DB: new D1Shim() };
    let dropResponse = false;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const res = await handleApi(new Request(`http://localhost${url}`, init), env);
      if (dropResponse) {
        dropResponse = false;
        throw new TypeError('Failed to fetch');
      }
      return res;
    });
    await renamePlayer('Ash');
    const start = await apiStartRun('c340');
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: start.seed });
    const o = opts({ state, token: start.token, day: start.day });

    dropResponse = true; // Server wertet, die Antwort geht unterwegs verloren
    const err = await finishRun(o).catch((e: unknown) => e);
    expect(isRetryable(err)).toBe(true);
    expect(savedKeys()).toEqual([]);

    const out = await finishRun(o);
    expect(out.ranking.status).toBe('ranked');
    const board = await fetchLeaderboard('c340', 'all');
    expect(board.mine?.record).toEqual(out.computed.season.record);
    expect(board.mine?.points).toBe(out.computed.season.points);
    expect(board.mine?.score).toBe(out.computed.evaluation.score);
  });
});

describe('useChallengeRun – Start-Fehler (startFailure)', () => {
  const rate = new ApiRequestError(
    'Zu viele neue Geräte von dieser Verbindung – bitte in einer Stunde erneut versuchen',
    429,
    'rate_limited',
  );

  it('nur already_played stoppt hart', () => {
    const played = new ApiRequestError('Schon gespielt – morgen gibt’s eine neue!', 409, 'already_played');
    expect(startFailure(played, 'auto')).toEqual({ kind: 'stop', error: played.message });
    expect(startFailure(played, 'ask')).toEqual({ kind: 'stop', error: played.message });
  });

  it("429 blockiert nie: 'auto' → offline mit Server-Meldung, 'ask' → Fehler + Offline-Angebot", () => {
    expect(startFailure(rate, 'auto')).toEqual({
      kind: 'offline',
      notice: `${rate.message}. Dieser Run läuft offline und wird nicht gewertet.`,
    });
    expect(startFailure(rate, 'ask')).toEqual({ kind: 'ask', error: rate.message });
  });

  it('Backend weg / Netzwerk / 5xx: ohne je erreichbares Backend still offline, sonst mit Hinweis', async () => {
    const errors = [
      new ApiRequestError('Server nicht erreichbar', 0, 'network'),
      new ApiRequestError('kaputt', 500, 'server_error'),
    ];
    // Noch nie erreichbar (statisches Hosting, `npm run dev`): Setup zeigte schon „Offline" → kein Hinweis
    expect(apiEverOnline()).toBe(false);
    for (const e of errors) expect(startFailure(e, 'auto')).toEqual({ kind: 'offline', notice: null });
    // Einmal erreichbar gewesen, jetzt weg → Hinweis
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ ok: true, version: 1, day: '2026-10-12' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await apiHealth(true)).not.toBeNull();
    expect(apiEverOnline()).toBe(true);
    for (const e of errors) {
      expect(startFailure(e, 'auto')).toEqual({
        kind: 'offline',
        notice: 'Server nicht erreichbar – dieser Run läuft offline und wird nicht gewertet.',
      });
      const ask = startFailure(e, 'ask');
      expect(ask.kind).toBe('ask');
      expect(ask.kind === 'ask' && ask.error).toMatch(/^Keine Verbindung zum Server – dein Run wurde noch nicht gestartet/);
    }
  });

  it('andere 4xx: Server-Meldung, nie ein harter Stopp', () => {
    const e = new ApiRequestError('Gerät nicht erkannt', 401, 'unauthorized');
    expect(startFailure(e, 'auto').kind).toBe('offline');
    expect(startFailure(e, 'ask')).toEqual({ kind: 'ask', error: e.message });
  });
});
