/**
 * Team eines Ranglisten-Eintrags (EntryDetail) – gemeinsame Form für die Online-Rangliste
 * (GET /api/entries/:id, siehe src/lib/api/client.ts fetchEntry) und die Runs dieses Geräts
 * (LeaderboardEntry aus localStorage). Dazu der Link, der das Team im Builder öffnet.
 */
import { FORMATIONS } from '../../config/formations';
import type { ChallengeKey, FormationId, Pokemon, Record3, RegionFilter, Slots, SpriteStyle } from '../../types';
import { LIMITS, type EntryDetail } from '../api/contract';
import { dayKey, isDayKey } from '../daily';
import { encodeLineup, URL_PARAM } from '../urlState';
import type { LeaderboardEntry } from './types';

const CHALLENGES: readonly ChallengeKey[] = ['c340', 'daily', 'retro340', 'c151'];

/**
 * Höchstlänge des Teamnamens im Builder-Link: Ranglisten-Teamnamen haben bis zu
 * LIMITS.teamNameMax Zeichen (Codepoints, je höchstens 4 UTF-8-Bytes) – sie passen also immer
 * ganz hinein. decodeLineup liest den Namen bis zum Ende, egal wie lang.
 */
export const LINK_NAME_BYTES = 4 * LIMITS.teamNameMax;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const isFormationId = (v: unknown): v is FormationId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(FORMATIONS, v);

const isChallenge = (v: unknown): v is ChallengeKey => typeof v === 'string' && (CHALLENGES as readonly string[]).includes(v);

/** Pokémon-ID (ganze Zahl ≥ 1) oder null für leer/Unsinn */
const idOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null);

/** Endliche Zahl ≥ 0, sonst 0 */
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

const record3 = (v: unknown): Record3 => (isRecord(v) ? { w: count(v.w), d: count(v.d), l: count(v.l) } : { w: 0, d: 0, l: 0 });

/**
 * Prüft und vereinheitlicht ein EntryDetail: Pflicht sind ID, Challenge, eine bekannte Formation
 * und die Slots als Liste. Die Slots haben danach genau so viele Einträge wie die Formation
 * (fehlende/ungültige IDs → null), ohne Standardschützen ist ss null. null = nicht lesbar.
 */
export function parseEntryDetail(raw: unknown): EntryDetail | null {
  if (!isRecord(raw)) return null;
  const { entryId, challenge, formation, slots } = raw;
  if (typeof entryId !== 'string' || entryId === '') return null;
  if (!isChallenge(challenge) || !isFormationId(formation) || !Array.isArray(slots)) return null;
  const ssEnabled = raw.ssEnabled === true;
  const day = text(raw.day);
  return {
    entryId,
    challenge,
    day: isDayKey(day) ? day : '',
    player: text(raw.player),
    teamName: text(raw.teamName),
    formation,
    slots: FORMATIONS[formation].slots.map((_, i) => idOrNull(slots[i])),
    ss: ssEnabled ? idOrNull(raw.ss) : null,
    ssEnabled,
    record: record3(raw.record),
    points: count(raw.points),
    score: count(raw.score),
    createdAt: text(raw.createdAt),
  };
}

/** Berliner Tag eines Zeitstempels (wie die Tageswertung) – '' bei kaputtem Zeitstempel */
function dayOf(iso: unknown): string {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dayKey(d);
}

/**
 * Team eines Runs dieses Geräts. Die lokale Historie speichert die 11 Slots und – nur mit
 * Standardschütze – dessen ID als 12. Eintrag (src/lib/runFinish.ts). null = nicht lesbar.
 */
export function localEntryDetail(e: LeaderboardEntry): EntryDetail | null {
  if (!isRecord(e) || !isFormationId(e.formation) || !Array.isArray(e.lineup)) return null;
  const n = FORMATIONS[e.formation].slots.length;
  const ssEnabled = e.lineup.length > n;
  return parseEntryDetail({
    entryId: e.id,
    challenge: e.challenge,
    day: dayOf(e.createdAt),
    player: e.player,
    teamName: e.teamName,
    formation: e.formation,
    slots: e.lineup.slice(0, n),
    ss: ssEnabled ? e.lineup[n] : null,
    ssEnabled,
    record: e.record,
    points: e.points,
    score: e.score,
    createdAt: e.createdAt,
  });
}

/** Text auf höchstens maxBytes UTF-8-Bytes kürzen – ganze Zeichen, keine halben Emojis. */
function fitBytes(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  let out = '';
  let bytes = 0;
  for (const ch of s.trim()) {
    const len = enc.encode(ch).length;
    if (bytes + len > maxBytes) break;
    out += ch;
    bytes += len;
  }
  return out;
}

type MonInfo = Pick<Pokemon, 'gen' | 'leg' | 'myth'>;

/**
 * Suchteil („?elf=…") für den Builder: dieselbe Formation, dieselben Slots und derselbe
 * Standardschütze, der Teamname und der Sprite-Stil des Nutzers (der Builder übernimmt ihn).
 * Region: die gemeinsame Generation aller Spieler, sonst alle; Legendäre an, wenn welche im Team sind.
 */
export function builderSearch(d: EntryDetail, sprite: SpriteStyle, byId: ReadonlyMap<number, MonInfo>): string {
  const slots: Slots = FORMATIONS[d.formation].slots.map((_, i) => d.slots[i] ?? null);
  const ss = d.ssEnabled ? d.ss : null;
  const mons = [...slots, ss].flatMap((id) => {
    const p = id != null ? byId.get(id) : undefined;
    return p ? [p] : [];
  });
  const gens = new Set(mons.map((p) => p.gen));
  const gen = gens.size === 1 ? [...gens][0] : 0;
  const region = (Number.isInteger(gen) && gen >= 1 && gen <= 9 ? gen : 0) as RegionFilter;
  const code = encodeLineup(
    {
      formation: d.formation,
      slots,
      ss,
      region,
      legends: mons.some((p) => !!p.leg || !!p.myth),
      ssEnabled: d.ssEnabled,
      sprite,
      // Ganze Zeichen (keine halben Emojis); Namen bis LIMITS.teamNameMax Zeichen bleiben vollständig
      teamName: fitBytes(d.teamName, LINK_NAME_BYTES),
    },
    { maxNameBytes: LINK_NAME_BYTES },
  );
  return `?${new URLSearchParams({ [URL_PARAM]: code })}`;
}
