/**
 * Kodiert eine komplette Aufstellung kompakt in einen URL-Parameter (Base64url).
 *
 * Byte 0      Version (1)
 * Byte 1      Formation (Index in FORMATION_IDS)
 * Byte 2      Flags: Bit 0 Legendäre, Bit 1 Standardschütze, Bit 2–3 Sprite-Stil, Bit 4–7 Region
 * Byte 3–26   12 × uint16 (11 Slots + SS), 0 = leer
 * Byte 27…    Teamname (UTF-8, alle restlichen Bytes; der Builder schreibt max. 40 Bytes)
 *
 * Eigene Trikotnummern stehen in einem zweiten Parameter (`nr`, 12 Bytes je Platz, 0 = Vorgabe) –
 * so bleiben alte Links und der Code selbst unverändert. Ebenso der Kapitän (`k`, Platz 0–10).
 */
import { FORMATION_IDS } from '../config/formations';
import { cleanJerseys, isJerseyNumber, type Jerseys } from './jerseys';
import type { FormationId, RegionFilter, Slots, SpriteStyle } from '../types';

export const URL_PARAM = 'elf';
export const JERSEY_PARAM = 'nr';
export const CAPTAIN_PARAM = 'k';
const VERSION = 1;
const SPRITE_ORDER: SpriteStyle[] = ['pixel', 'retro', 'artwork'];
const MAX_NAME_BYTES = 40;

export interface SharedLineup {
  formation: FormationId;
  slots: Slots;
  ss: number | null;
  region: RegionFilter;
  legends: boolean;
  ssEnabled: boolean;
  sprite: SpriteStyle;
  teamName: string;
  /** Eigene Trikotnummern (Pokémon-ID → Nummer) – nur im Parameter `nr` */
  jerseys?: Jerseys;
  /** Kapitän (Pokémon-ID aus der Elf) – nur im Parameter `k` (als Platz) */
  captain?: number | null;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function truncateUtf8(text: string, maxBytes: number): Uint8Array {
  const enc = new TextEncoder();
  let bytes = enc.encode(text);
  let s = text;
  while (bytes.length > maxBytes && s.length) {
    s = s.slice(0, -1);
    bytes = enc.encode(s);
  }
  return bytes;
}

export interface EncodeOptions {
  /**
   * Höchstlänge des Teamnamens in UTF-8-Bytes (Standard 40 wie beim Teilen aus dem Builder).
   * decodeLineup liest alle Bytes ab Byte 27 – längere Namen bleiben also lesbar.
   */
  maxNameBytes?: number;
}

export function encodeLineup(state: SharedLineup, { maxNameBytes = MAX_NAME_BYTES }: EncodeOptions = {}): string {
  const name = truncateUtf8(state.teamName.trim(), maxNameBytes);
  const bytes = new Uint8Array(27 + name.length);
  bytes[0] = VERSION;
  bytes[1] = Math.max(0, FORMATION_IDS.indexOf(state.formation));
  bytes[2] =
    (state.legends ? 1 : 0) |
    (state.ssEnabled ? 2 : 0) |
    (Math.max(0, SPRITE_ORDER.indexOf(state.sprite)) << 2) |
    ((state.region & 0x0f) << 4);
  const ids = [...Array.from({ length: 11 }, (_, i) => state.slots[i] ?? 0), state.ss ?? 0];
  ids.forEach((id, i) => {
    bytes[3 + i * 2] = (id >> 8) & 0xff;
    bytes[4 + i * 2] = id & 0xff;
  });
  bytes.set(name, 27);
  return toBase64Url(bytes);
}

/**
 * known: höchste gültige Nummer (Standard: die 1.025 Pokémon) oder eine Prüfung – z. B. alle
 * Pokémon und Formen (Formen haben Nummern ab 10001). Unbekannte Nummern werden leere Plätze.
 */
export function decodeLineup(str: string, known: number | ((id: number) => boolean) = 1025): SharedLineup | null {
  const ok = typeof known === 'number' ? (id: number) => id >= 1 && id <= known : (id: number) => id >= 1 && known(id);
  try {
    const bytes = fromBase64Url(str.trim());
    if (bytes.length < 27 || bytes[0] !== VERSION) return null;
    const formation = FORMATION_IDS[bytes[1]];
    if (!formation) return null;
    const flags = bytes[2];
    const region = (flags >> 4) & 0x0f;
    const sprite = SPRITE_ORDER[(flags >> 2) & 0x03] ?? 'pixel';
    const ids: (number | null)[] = [];
    for (let i = 0; i < 12; i++) {
      const id = (bytes[3 + i * 2] << 8) | bytes[4 + i * 2];
      ids.push(ok(id) ? id : null);
    }
    const teamName = new TextDecoder().decode(bytes.slice(27));
    return {
      formation,
      slots: ids.slice(0, 11),
      ss: ids[11],
      region: (region <= 9 ? region : 0) as RegionFilter,
      legends: !!(flags & 1),
      ssEnabled: !!(flags & 2),
      sprite,
      teamName,
    };
  } catch {
    return null;
  }
}

/** Trikotnummern je Platz (11 Slots + SS) kodieren; null, wenn keine eigene Nummer vergeben ist. */
export function encodeJerseys(slots: Slots, ss: number | null, jerseys: Jerseys | undefined): string | null {
  const ids = [...Array.from({ length: 11 }, (_, i) => slots[i] ?? null), ss];
  const bytes = Uint8Array.from(ids, (id) => {
    const n = id != null ? jerseys?.[String(id)] : undefined;
    return isJerseyNumber(n) ? n : 0;
  });
  return bytes.some((b) => b > 0) ? toBase64Url(bytes) : null;
}

/** Gegenstück zu encodeJerseys – ungültige oder doppelte Nummern fallen weg. */
export function decodeJerseys(str: string, slots: Slots, ss: number | null): Jerseys {
  try {
    const bytes = fromBase64Url(str.trim());
    const ids = [...Array.from({ length: 11 }, (_, i) => slots[i] ?? null), ss];
    const raw: Record<string, number> = {};
    ids.forEach((id, i) => {
      if (id != null && bytes[i] && raw[String(id)] == null) raw[String(id)] = bytes[i];
    });
    return cleanJerseys(raw);
  } catch {
    return {};
  }
}

/** Kapitän aus dem Parameter `k` (Platz 0–10) – null, wenn er fehlt oder der Platz leer ist. */
export function decodeCaptain(raw: string | null, slots: Slots): number | null {
  if (raw == null || !/^\d{1,2}$/.test(raw)) return null;
  return slots[Number(raw)] ?? null;
}

export function shareUrl(state: SharedLineup): string {
  const url = new URL(window.location.href);
  url.pathname = import.meta.env.BASE_URL || '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set(URL_PARAM, encodeLineup(state));
  const nr = encodeJerseys(state.slots, state.ss, state.jerseys);
  if (nr) url.searchParams.set(JERSEY_PARAM, nr);
  const k = state.captain != null ? state.slots.indexOf(state.captain) : -1;
  if (k >= 0) url.searchParams.set(CAPTAIN_PARAM, String(k));
  return url.toString();
}
