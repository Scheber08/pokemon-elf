/**
 * Browser-Client (src/lib/api/client.ts) und Geräte-Identität (src/lib/device.ts) mit
 * gestubbtem fetch. Jeder Test lädt die Module frisch (Health-Cache, Geräte-Memo).
 * Node hat kein localStorage – storage.ts liest/schreibt dann nichts (wie bei blockiertem Speicher).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HealthResponse } from '../src/lib/api/contract';

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
