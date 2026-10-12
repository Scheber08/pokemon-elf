/**
 * Krypto-Helfer auf Basis von Web Crypto (Workers, Browser und Node gleich).
 */

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** SHA-256 eines Textes als 64-stelliger Hex-String. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return toHex(new Uint8Array(digest));
}

/** Zufällige Bytes als Hex-String (2 Zeichen je Byte). */
export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

/** Zufälliger 31-Bit-Seed (0 … 2³¹−1) – passt zu challengeEngine und Saison. */
export function randomSeed31(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] & 0x7fffffff;
}

/** Neue, zufällige ID (UUID v4). */
export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Vergleich in konstanter Zeit (für Secret-Hashes) – die Laufzeit hängt nicht
 * davon ab, ab welchem Zeichen sich die Strings unterscheiden.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
