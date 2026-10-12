/**
 * Geräte-Identität für die Online-Rangliste – kein Account nötig.
 * deviceId ist öffentlich (markiert „deine" Zeile), deviceSecret beweist,
 * dass Einträge/Umbenennungen von diesem Gerät kommen. Der Server speichert
 * nur einen Hash des Secrets.
 */
import type { DeviceAuth } from './api/contract';
import { load, save } from './storage';

const KEY = 'device';

/**
 * Identität dieses Seitenaufrufs. Einmal geladen bzw. erzeugt, bleibt sie im Speicher –
 * auch wenn localStorage blockiert ist und das Speichern scheitert. Sonst bekäme jeder
 * Aufruf ein neues Gerät (Start und Abschluss eines Runs passten nicht zusammen).
 */
let current: DeviceAuth | null = null;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : randomHex(16);
}

export function getDevice(): DeviceAuth {
  if (current) return current;
  const stored: Partial<DeviceAuth> = load<Partial<DeviceAuth> | null>(KEY, null) ?? {};
  const { deviceId, deviceSecret } = stored;
  if (typeof deviceId === 'string' && deviceId && typeof deviceSecret === 'string' && deviceSecret) {
    current = { deviceId, deviceSecret };
  } else {
    current = { deviceId: newId(), deviceSecret: randomHex(32) };
    save(KEY, current);
  }
  return current;
}
