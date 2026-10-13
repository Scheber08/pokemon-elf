/**
 * Geräte-Authentifizierung ohne Accounts: Die erste Anfrage einer unbekannten
 * Geräte-ID registriert sie (gespeichert wird nur der SHA-256 des Schlüssels),
 * danach muss der Schlüssel immer passen.
 */
import { LIMITS, type DeviceAuth } from '../src/lib/api/contract';
import { randomHex, sha256Hex, timingSafeEqual } from './crypto';
import { countDevicesByIp, expireIpHashes, getDevice, insertDevice, metaValue } from './db';
import type { Env } from './env';
import { ApiError } from './http';

export const DEFAULT_PLAYER = 'Trainer';
export const HOUR_MS = 3_600_000;
/** So lange wird der IP-Hash eines neuen Geräts gebraucht (Fenster des Limits) – danach gelöscht. */
export const IP_HASH_TTL_MS = HOUR_MS;

const unauthorized = () =>
  new ApiError(401, 'unauthorized', 'Gerät nicht erkannt – der Geräte-Schlüssel passt nicht zu dieser Geräte-ID');

export const rateLimited = (message: string) =>
  new ApiError(429, 'rate_limited', message, { 'Retry-After': String(HOUR_MS / 1000) });

/** IPv4 als vier Oktette – sonst null. */
function parseIpv4(s: string): number[] | null {
  const parts = s.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const octets = parts.map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** IPv6 als acht 16-Bit-Gruppen („::" aufgelöst, IPv4 am Ende erlaubt) – sonst null. */
function parseIpv6(s: string): number[] | null {
  let addr = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  if (!addr.includes(':')) return null;
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    addr = `${addr.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const split = (h: string) => (h === '' ? [] : h.split(':'));
  const head = split(halves[0]);
  const rest = halves.length === 2 ? split(halves[1]) : [];
  let groups = head;
  if (halves.length === 2) {
    // „::" steht für mindestens eine Null-Gruppe.
    if (head.length + rest.length > 7) return null;
    groups = [...head, ...Array<string>(8 - head.length - rest.length).fill('0'), ...rest];
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * Normalisiert die Client-IP fürs Limit neuer Geräte: IPv4 vollständig, IPv6 nur
 * das /64-Präfix (so viele Adressen hat praktisch jeder Anschluss und kann sie frei
 * wechseln), IPv4-mapped IPv6 (::ffff:a.b.c.d) als IPv4. Unbekanntes bleibt, wie es ist.
 */
export function normalizeIp(raw: string): string {
  const ip = raw.trim().toLowerCase();
  const v4 = parseIpv4(ip);
  if (v4) return v4.join('.');
  const v6 = parseIpv6(ip);
  if (!v6) return ip;
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
    return [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff].join('.');
  }
  return `${v6
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/** Was die Geräteprüfung vom Env braucht (auch im Draft-Raum vorhanden). */
type DeviceEnv = Pick<Env, 'DB' | 'IP_SALT'>;

const salts = new WeakMap<Env['DB'], Promise<string>>();

/**
 * Salz für IP-Hashes: IP_SALT, falls gesetzt – sonst ein zufälliger Wert, der beim ersten
 * Bedarf in der Datenbank angelegt wird. So sind die Hashes ohne Konfiguration nicht per
 * Durchprobieren aller IPv4-Adressen umkehrbar.
 */
function ipSalt(env: DeviceEnv): Promise<string> {
  if (env.IP_SALT) return Promise.resolve(env.IP_SALT);
  let salt = salts.get(env.DB);
  if (!salt) {
    salt = metaValue(env.DB, 'ip_salt', randomHex(32));
    salt.catch(() => salts.delete(env.DB));
    salts.set(env.DB, salt);
  }
  return salt;
}

/**
 * Hash der (normalisierten) Client-IP, gesalzen – die IP selbst wird nie gespeichert,
 * der Hash nach IP_HASH_TTL_MS gelöscht.
 */
export function ipHashOf(request: Request, env: Env): Promise<string | null> {
  return ipHashFor(request.headers.get('CF-Connecting-IP'), env);
}

/** Wie ipHashOf, nur mit der rohen IP (z. B. aus dem WebSocket-Upgrade eines Draft-Raums). */
export async function ipHashFor(rawIp: string | null | undefined, env: DeviceEnv): Promise<string | null> {
  const ip = rawIp?.trim();
  return ip ? sha256Hex(`pokemon-elf|ip|${await ipSalt(env)}|${normalizeIp(ip)}`) : null;
}

/** Prüft (bzw. registriert) das Gerät; wirft 401 bei falschem Schlüssel, 429 bei zu vielen neuen Geräten. */
export function authenticate(request: Request, env: Env, auth: DeviceAuth, now: number): Promise<void> {
  return authenticateDevice(env, auth, now, request.headers.get('CF-Connecting-IP'));
}

/**
 * Wie authenticate, nur mit der rohen Client-IP statt der Anfrage – für das hello im
 * Draft-Raum (die IP stammt aus dem WebSocket-Upgrade). Ohne IP greift das Limit nicht.
 */
export async function authenticateDevice(
  env: DeviceEnv,
  auth: DeviceAuth,
  now: number,
  rawIp: string | null | undefined,
): Promise<void> {
  const db = env.DB;
  const secretHash = await sha256Hex(auth.deviceSecret);
  // Bei jedem Zugriff mit Gerät: IP-Hashes außerhalb des Limit-Fensters löschen (Partial-Index, billig).
  await expireIpHashes(db, now - IP_HASH_TTL_MS);
  let device = await getDevice(db, auth.deviceId);
  if (!device) {
    const ipHash = await ipHashFor(rawIp, env);
    // Ohne CF-Connecting-IP (nur außerhalb von Cloudflare) greift das IP-Limit nicht.
    if (ipHash && (await countDevicesByIp(db, ipHash, now - HOUR_MS)) >= LIMITS.devicesPerIpPerHour) {
      throw rateLimited('Zu viele neue Geräte von dieser Verbindung – bitte in einer Stunde erneut versuchen');
    }
    if (await insertDevice(db, { id: auth.deviceId, secretHash, name: DEFAULT_PLAYER, ipHash, now })) return;
    // Parallel registriert: wie ein bekanntes Gerät prüfen.
    device = await getDevice(db, auth.deviceId);
    if (!device) throw new Error('Gerät konnte nicht angelegt werden');
  }
  if (!timingSafeEqual(device.secret_hash, secretHash)) throw unauthorized();
}
