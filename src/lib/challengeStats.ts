import type { ChallengeKey, Record3 } from '../types';
import { compareRecords } from './season';
import { load, save, STORAGE_KEYS } from './storage';

export interface ChallengeStats {
  bestScore: number | null;
  bestRecord: Record3 | null;
  runs: number;
  /** Zuletzt abgeschlossener Run (fehlt bei Daten von vor dieser Angabe) */
  last?: { score: number; record: Record3; /** Zeitpunkt (ms; fehlt bei älteren Daten) */ at?: number };
  /** Summe der Scores und Anzahl der dabei gezählten Runs (für Ø – erst seit dieser Angabe gezählt) */
  scoreSum?: number;
  scored?: number;
}

const EMPTY: ChallengeStats = { bestScore: null, bestRecord: null, runs: 0 };

export function loadStats(challenge: ChallengeKey): ChallengeStats {
  return { ...EMPTY, ...load<Partial<ChallengeStats>>(STORAGE_KEYS.stats(challenge), {}) };
}

/** Trägt einen abgeschlossenen Run ein und liefert die neuen Werte. */
export function recordRun(challenge: ChallengeKey, score: number, record: Record3, now = Date.now()): ChallengeStats {
  const prev = loadStats(challenge);
  const next: ChallengeStats = {
    runs: prev.runs + 1,
    bestScore: prev.bestScore == null ? score : Math.max(prev.bestScore, score),
    bestRecord: !prev.bestRecord || compareRecords(record, prev.bestRecord) < 0 ? record : prev.bestRecord,
    last: { score, record, at: now },
    scoreSum: (prev.scoreSum ?? 0) + score,
    scored: (prev.scored ?? 0) + 1,
  };
  save(STORAGE_KEYS.stats(challenge), next);
  return next;
}

/** Ø Score der gezählten Runs (ab zwei), sonst null */
export function averageScore(stats: ChallengeStats): number | null {
  return stats.scored && stats.scored >= 2 && stats.scoreSum != null ? Math.round(stats.scoreSum / stats.scored) : null;
}
