/**
 * Geräte-Identität für die Online-Rangliste – kein Account nötig.
 * deviceId ist öffentlich (markiert „deine" Zeile), deviceSecret beweist,
 * dass Einträge/Umbenennungen von diesem Gerät kommen. Der Server speichert
 * nur einen Hash des Secrets.
 */
import type { DeviceAuth } from './api/contract';
import { load, save } from './storage';

const KEY = 'device';

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : randomHex(16);
}

export function getDevice(): DeviceAuth {
  const stored = load<Partial<DeviceAuth>>(KEY, {});
  if (stored.deviceId && stored.deviceSecret) return { deviceId: stored.deviceId, deviceSecret: stored.deviceSecret };
  const device = { deviceId: newId(), deviceSecret: randomHex(32) };
  save(KEY, device);
  return device;
}
