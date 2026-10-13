/**
 * Browser-Client (src/lib/api/client.ts) und Geräte-Identität (src/lib/device.ts) mit
 * gestubbtem fetch. Jeder Test lädt die Module frisch (Health-Cache, Geräte-Memo).
 * Node hat kein localStorage – storage.ts liest/schreibt dann nichts (wie bei blockiertem Speicher).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntryDetail, HealthResponse } from '../src/lib/api/contract';

type Client = typeof import('../src/lib/api/client');
type Device = typeof import('../src/lib/device');

const HEALTH: HealthResponse = { ok: true, version: 1, day: '2026-10-12' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Module neu laden – wie ein neuer Seitenaufruf. */
async function fresh(): Promise<{ client: Client; device: Device }> {
  vi.resetModules();
  const client = await import('../src/lib/api/client');
  const device = await import('../src/lib/device');
  return { client, device };
}

/** fetch-Stub, der Antworten der Reihe nach liefert (Funktion = wirft/antwortet selbst). */
function stubFetch(...answers: Array<Response | (() => Promise<Response>)>) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    return typeof next === 'function' ? next() : next.clone();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const offline = () => Promise.reject(new TypeError('Failed to fetch'));

/** Date.now() steuerbar machen. */
function clock(start = 1_000_000) {
  let now = start;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return { advance: (ms: number) => (now += ms) };
}

function memoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  };
  return { map, storage };
}

const blockedStorage = {
  getItem() {
    throw new DOMException('Zugriff verweigert', 'SecurityError');
  },
  setItem() {
    throw new DOMException('Zugriff verweigert', 'SecurityError');
  },
  removeItem() {
    throw new DOMException('Zugriff verweigert', 'SecurityError');
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('apiHealth / apiAvailable', () => {
  it('merkt sich einen Fehlschlag nur kurz und prüft danach neu', async () => {
    const { client } = await fresh();
    const time = clock();
    const fetch = stubFetch(offline, json(200, HEALTH));

    expect(await client.apiAvailable()).toBe(false);
    time.advance(1000);
    expect(await client.apiAvailable()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);

    time.advance(client.HEALTH_RETRY_MS);
    expect(await client.apiAvailable()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('/api/health');
  });

  it('ein Erfolg gilt für den ganzen Seitenaufruf', async () => {
    const { client } = await fresh();
    const time = clock();
    const fetch = stubFetch(json(200, HEALTH), offline);
    expect(await client.apiAvailable()).toBe(true);
    time.advance(10 * client.HEALTH_RETRY_MS);
    expect(await client.apiAvailable()).toBe(true);
    expect(await client.apiAvailable(true)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('recheck prüft einen bekannten Fehlschlag sofort neu (z. B. vor dem Start)', async () => {
    const { client } = await fresh();
    clock();
    const fetch = stubFetch(offline, json(200, HEALTH));
    expect(await client.apiAvailable()).toBe(false);
    expect(await client.apiAvailable(true)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('recheck prüft nicht doppelt, wenn der Check gerade erst läuft', async () => {
    const { client } = await fresh();
    clock();
    const fetch = stubFetch(offline);
    expect(await Promise.all([client.apiAvailable(), client.apiAvailable(true)])).toEqual([false, false]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ungültige Health-Antwort zählt als offline', async () => {
    const { client } = await fresh();
    clock();
    stubFetch(json(200, { ok: false }));
    expect(await client.apiHealth()).toBeNull();
  });

  it('onApiHealth meldet jedes neue Ergebnis; ein veralteter Check überschreibt den neueren nicht', async () => {
    const { client } = await fresh();
    clock();
    let release!: (r: Response) => void;
    const slow = () => new Promise<Response>((resolve) => (release = resolve));
    const fetch = stubFetch(slow, json(200, HEALTH));
    const seen: boolean[] = [];
    const unsubscribe = client.onApiHealth((ok) => seen.push(ok));

    const first = client.apiHealth();
    expect(await client.apiHealth(true)).toEqual(HEALTH);
    release(json(503, { error: 'server_error', message: 'kaputt' }));
    expect(await first).toBeNull();
    // Der neuere, erfolgreiche Check gilt weiter – kein neuer Request
    expect(await client.apiAvailable()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([true]);

    unsubscribe();
    await client.apiHealth(true);
    expect(seen).toEqual([true]);
  });
});

describe('Fehler-Zuordnung', () => {
  it('429 mit Server-Meldung → rate_limited mit genau dieser Meldung', async () => {
    const { client } = await fresh();
    const msg = 'Zu viele neue Geräte von dieser Verbindung – bitte in einer Stunde erneut versuchen';
    stubFetch(json(429, { error: 'rate_limited', message: msg }));
    const err = await client.startRun('c340').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(client.ApiRequestError);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', message: msg });
  });

  it('429 ohne JSON (z. B. vom CDN) → trotzdem rate_limited, deutsche Meldung', async () => {
    const { client } = await fresh();
    stubFetch(new Response('<html>Too Many Requests</html>', { status: 429, headers: { 'Content-Type': 'text/html' } }));
    const err = await client.startRun('c340').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited' });
    expect((err as Error).message).toMatch(/^Zu viele Anfragen/);
  });

  it('Netzwerkfehler → network, Status 0', async () => {
    const { client } = await fresh();
    stubFetch(offline);
    const err = await client.startRun('c340').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: 'network', message: 'Server nicht erreichbar' });
  });

  it('andere Fehler ohne JSON bleiben server_error', async () => {
    const { client } = await fresh();
    stubFetch(new Response('kaputt', { status: 502 }));
    const err = await client.startRun('c340').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'server_error', message: 'HTTP 502' });
  });
});

describe('fetchEntry (Team eines Ranglisten-Eintrags)', () => {
  const ID = '0b6f3c1e-8f0a-4c3e-9d2b-5a7e1f4c2d90';
  const DETAIL: EntryDetail = {
    entryId: ID,
    challenge: 'c340',
    day: '2026-10-12',
    player: 'Ash',
    teamName: 'Pallet Power',
    formation: '4-3-3',
    slots: [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135],
    ss: 59,
    ssEnabled: true,
    record: { w: 30, d: 2, l: 2 },
    points: 92,
    score: 812,
    createdAt: '2026-10-12T08:00:00.000Z',
  };

  it('GET /api/entries/<id> mit kodierter ID, liefert das Team unverändert', async () => {
    const { client } = await fresh();
    const fetch = stubFetch(json(200, DETAIL));
    expect(await client.fetchEntry(ID)).toEqual(DETAIL);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`/api/entries/${ID}`);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.body).toBeUndefined();

    await client.fetchEntry('a/b?c=d#e');
    expect(fetch.mock.calls[1][0]).toBe('/api/entries/a%2Fb%3Fc%3Dd%23e');
  });

  it('404 → ApiRequestError not_found (Eintrag nicht mehr in der Rangliste)', async () => {
    const { client } = await fresh();
    stubFetch(json(404, { error: 'not_found', message: 'Dieses Team ist nicht mehr in der Rangliste' }));
    const err = await client.fetchEntry(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(client.ApiRequestError);
    expect(err).toMatchObject({ status: 404, code: 'not_found', message: 'Dieses Team ist nicht mehr in der Rangliste' });
  });

  it('400, Netzwerk- und Serverfehler laufen über dieselbe Fehler-Zuordnung', async () => {
    const { client } = await fresh();
    stubFetch(json(400, { error: 'bad_request', message: 'Ungültige Eintrags-ID' }));
    expect(await client.fetchEntry('x').catch((e: unknown) => e)).toMatchObject({ status: 400, code: 'bad_request' });
    stubFetch(offline);
    expect(await client.fetchEntry(ID).catch((e: unknown) => e)).toMatchObject({ status: 0, code: 'network' });
    stubFetch(new Response('kaputt', { status: 503 }));
    expect(await client.fetchEntry(ID).catch((e: unknown) => e)).toMatchObject({ status: 503, code: 'server_error' });
  });

  it('unlesbare Antwort (ohne Formation/Slots, unbekannte Challenge, kein JSON) → server_error statt halbem Team', async () => {
    const { client } = await fresh();
    const bad: unknown[] = [
      null,
      [],
      { ...DETAIL, formation: '9-9-9' },
      { ...DETAIL, slots: 'kaputt' },
      { ...DETAIL, challenge: 'liga' },
      { ...DETAIL, entryId: 42 },
    ];
    for (const body of bad) {
      stubFetch(json(200, body));
      const err = await client.fetchEntry(ID).catch((e: unknown) => e);
      expect(err, JSON.stringify(body)).toMatchObject({ code: 'server_error', message: 'Unerwartete Antwort vom Server' });
    }
    stubFetch(new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    expect(await client.fetchEntry(ID).catch((e: unknown) => e)).toMatchObject({ code: 'server_error' });
  });

  it('Slots passend zur Formation (fehlende/ungültige → leer), ohne Standardschütze kein ss', async () => {
    const { client } = await fresh();
    stubFetch(json(200, { ...DETAIL, slots: [143, 'x', -3, 2.5, null], ss: 59, ssEnabled: false, deviceId: 'geheim' }));
    const d = await client.fetchEntry(ID);
    expect(d.slots).toEqual([143, null, null, null, null, null, null, null, null, null, null]);
    expect(d.ss).toBeNull();
    expect(d.ssEnabled).toBe(false);
    expect(d).not.toHaveProperty('deviceId');
  });
});

describe('Geräte-Identität', () => {
  it('ohne localStorage bleibt das Gerät im Seitenaufruf gleich – Start und Abschluss passen zusammen', async () => {
    const { client, device } = await fresh();
    const a = device.getDevice();
    expect(device.getDevice()).toEqual(a);

    const fetch = stubFetch(json(500, { error: 'server_error', message: 'x' }));
    await client.startRun('c340').catch(() => {});
    await client.finishRun({ token: 't', formation: '4-3-3', ssEnabled: false, picks: [], teamName: '', player: 'Ash' }).catch(() => {});
    await client.renamePlayer('Ash').catch(() => {});
    await client.fetchLeaderboard('c340', 'today').catch(() => {});

    const bodies = fetch.mock.calls.slice(0, 3).map(([, init]) => JSON.parse(String(init?.body)));
    for (const body of bodies) expect(body).toMatchObject(a);
    expect(new URL(`http://x${fetch.mock.calls[3][0]}`).searchParams.get('me')).toBe(a.deviceId);
  });

  it('blockierter localStorage (wirft): trotzdem eine stabile Identität', async () => {
    vi.stubGlobal('localStorage', blockedStorage);
    const { device } = await fresh();
    const a = device.getDevice();
    expect(a.deviceId).toBeTruthy();
    expect(a.deviceSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(device.getDevice()).toEqual(a);
    expect(device.getDevice()).toEqual(a);
  });

  it('funktionierender localStorage: gespeichert und beim nächsten Seitenaufruf wieder geladen', async () => {
    const { map, storage } = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const a = (await fresh()).device.getDevice();
    expect(JSON.parse(map.get('pokemon-elf:device')!)).toEqual(a);
    const b = (await fresh()).device.getDevice();
    expect(b).toEqual(a);
  });

  it('kaputter gespeicherter Wert → neues Gerät statt Absturz', async () => {
    const { map, storage } = memoryStorage();
    map.set('pokemon-elf:device', 'null');
    vi.stubGlobal('localStorage', storage);
    const a = (await fresh()).device.getDevice();
    expect(a.deviceId).toBeTruthy();
    expect(JSON.parse(map.get('pokemon-elf:device')!)).toEqual(a);
  });
});
