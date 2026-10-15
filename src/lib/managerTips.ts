import type { Match } from './season';
import { load, save, STORAGE_KEYS } from './storage';

/** Tipp auf das eigene Spiel eines Spieltags: Sieg, Remis, Niederlage */
export type MatchTip = 'w' | 'd' | 'l';
export const MATCH_TIPS: readonly MatchTip[] = ['w', 'd', 'l'];

/** Höchstens so viele Ligen merken (älteste fliegen raus) */
const MAX_LEAGUES = 20;

type Store = Record<string, Record<number, MatchTip>>;

/** Tipps einer Liga (Spieltag → Tipp) – nur auf diesem Gerät */
export function loadTips(code: string): Record<number, MatchTip> {
  return load<Store>(STORAGE_KEYS.managerTips, {})[code] ?? {};
}

export function saveTip(code: string, round: number, tip: MatchTip): Record<number, MatchTip> {
  const all = load<Store>(STORAGE_KEYS.managerTips, {});
  const mine = { ...(all[code] ?? {}), [round]: tip };
  const { [code]: _old, ...rest } = all;
  const kept = Object.entries(rest).slice(-(MAX_LEAGUES - 1));
  save(STORAGE_KEYS.managerTips, { ...Object.fromEntries(kept), [code]: mine });
  return mine;
}

/** Ausgang eines Spiels aus Sicht von team (null: nicht beteiligt) */
export function outcomeFor(m: Match, team: number): MatchTip | null {
  if (m.home !== team && m.away !== team) return null;
  const own = m.home === team ? m.hg : m.ag;
  const other = m.home === team ? m.ag : m.hg;
  return own > other ? 'w' : own < other ? 'l' : 'd';
}

/**
 * Trefferbilanz der Tipps für gespielte Spieltage (bis played), der zuletzt getippte gespielte Spieltag und die
 * aktuelle Serie richtiger Tipps (zählt über ungetippte Spieltage hinweg, ein falscher Tipp beendet sie).
 */
export function tipScore(
  tips: Record<number, MatchTip>,
  matches: readonly Match[],
  team: number,
  played: number,
): { hits: number; total: number; last: { round: number; hit: boolean } | null; streak: number } {
  let hits = 0;
  let total = 0;
  let last: { round: number; hit: boolean } | null = null;
  let streak = 0;
  const rounds = Object.keys(tips)
    .map(Number)
    .filter((r) => r <= played)
    .sort((a, b) => a - b);
  for (const round of rounds) {
    const m = matches.find((x) => x.round === round && (x.home === team || x.away === team));
    const out = m ? outcomeFor(m, team) : null;
    if (!out) continue;
    total++;
    const hit = out === tips[round];
    if (hit) hits++;
    streak = hit ? streak + 1 : 0;
    last = { round, hit };
  }
  return { hits, total, last, streak };
}
