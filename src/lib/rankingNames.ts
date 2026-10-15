/**
 * Ligagegner mit Namen aus den Online-Ranglisten: Teamnamen (sonst Spielernamen) der Bestenlisten,
 * auf dem Gerät zwischengespeichert. Ohne Server oder Cache bleiben die Fantasie-Vereinsnamen.
 * Die Auswahl ist rein (Seed) – Stärken und Ergebnisse der Saisons hängen nie an den Namen.
 */
import { CLUB_NAMES } from '../config/season';
import type { LeaderboardRow } from './api/contract';
import { hashSeed, shuffle, createRng } from './rng';
import { load, save, STORAGE_KEYS } from './storage';

/** Längster übernommener Name (wie Teamnamen im Online-Draft) */
export const RANKING_NAME_MAX = 28;
/** So lange gilt der Cache, bevor neu geladen wird */
const REFRESH_MS = 6 * 60 * 60 * 1000;

interface Cached {
  at: number;
  names: string[];
}

/** Namen aus Ranglisten-Zeilen: Teamname (sonst Spieler), ohne eigene Zeilen, ohne Doppelte (Groß/klein egal) */
export function namesFromRows(rows: readonly Pick<LeaderboardRow, 'teamName' | 'player' | 'me'>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (r.me) continue;
    const name = Array.from((r.teamName || r.player || '').trim()).slice(0, RANKING_NAME_MAX).join('').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Zwischengespeicherte Ranglisten-Namen (leer, solange nie geladen) */
export function rankingNames(): string[] {
  const c = load<Cached | null>(STORAGE_KEYS.rankingNames, null);
  return Array.isArray(c?.names) ? c.names.filter((n) => typeof n === 'string' && n.trim()) : [];
}

/**
 * `n` Gegnernamen für eine Liga, deterministisch aus `seed`: zuerst Ranglisten-Namen, der Rest
 * Vereinsnamen. `exclude` (z. B. eigene Teamnamen) kommt nicht vor, kein Name doppelt.
 */
export function opponentNames(n: number, seed: number, pool: readonly string[] = rankingNames(), exclude: readonly string[] = []): string[] {
  const taken = new Set(exclude.map((x) => x.trim().toLowerCase()));
  const rng = createRng(hashSeed('ranking-names', seed));
  const out: string[] = [];
  for (const name of [...shuffle(rng, pool), ...shuffle(rng, CLUB_NAMES)]) {
    if (out.length >= n) break;
    const key = name.trim().toLowerCase();
    if (!key || taken.has(key)) continue;
    taken.add(key);
    out.push(name.trim());
  }
  return out;
}

/** Namen im Hintergrund auffrischen (höchstens alle 6 Stunden): Allzeit-Bestenlisten von 34–0 und 151 */
export async function refreshRankingNames(
  fetchRows: (challenge: 'c340' | 'c151') => Promise<readonly LeaderboardRow[]>,
  now = Date.now(),
): Promise<string[]> {
  const c = load<Cached | null>(STORAGE_KEYS.rankingNames, null);
  if (c && now - c.at < REFRESH_MS && c.names?.length) return c.names;
  try {
    const lists = await Promise.all((['c340', 'c151'] as const).map((ch) => fetchRows(ch).catch(() => [] as LeaderboardRow[])));
    const names = namesFromRows(lists.flat());
    if (names.length) save(STORAGE_KEYS.rankingNames, { at: now, names } satisfies Cached);
    return names.length ? names : rankingNames();
  } catch {
    return rankingNames();
  }
}
