import type { ChallengeKey, Record3 } from '../types';
import { compareRecords } from './season';
import { load, save, STORAGE_KEYS } from './storage';

export interface ChallengeStats {
  bestScore: number | null;
  bestRecord: Record3 | null;
  runs: number;
  /** Zuletzt abgeschlossener Run (fehlt bei Daten von vor dieser Angabe) */
  last?: { score: number; record: Record3 };
}

const EMPTY: ChallengeStats = { bestScore: null, bestRecord: null, runs: 0 };

export function loadStats(challenge: ChallengeKey): ChallengeStats {
  return { ...EMPTY, ...load<Partial<ChallengeStats>>(STORAGE_KEYS.stats(challenge), {}) };
}

/** Trägt einen abgeschlossenen Run ein und liefert die neuen Werte. */
export function recordRun(challenge: ChallengeKey, score: number, record: Record3): ChallengeStats {
  const prev = loadStats(challenge);
  const next: ChallengeStats = {
    runs: prev.runs + 1,
    bestScore: prev.bestScore == null ? score : Math.max(prev.bestScore, score),
    bestRecord: !prev.bestRecord || compareRecords(record, prev.bestRecord) < 0 ? record : prev.bestRecord,
    last: { score, record },
  };
  save(STORAGE_KEYS.stats(challenge), next);
  return next;
}
