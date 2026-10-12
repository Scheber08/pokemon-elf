/**
 * Abschluss eines Challenge-Runs – online gewertet oder lokal.
 *
 * Mit Token (Run wurde online gestartet) reicht finishRun das Zug-Protokoll beim
 * Server ein; der Server prüft es, zieht den Saison-Seed und speichert die Wertung.
 * Ohne Token oder ohne Server läuft alles lokal (ungewertet). In beiden Fällen
 * wird die Saison im Browser mit demselben Seed simuliert.
 */
import type { ChallengeKey, Pokemon } from '../types';
import { ApiRequestError, apiAvailable, finishRun as apiFinishRun, renamePlayer } from './api/client';
import { recordRun as recordStats, type ChallengeStats } from './challengeStats';
import type { RunState } from './challengeEngine';
import { dailySeasonSeed } from './daily';
import type { Scale } from './fit';
import { leaderboard } from './leaderboard';
import { randomSeed } from './rng';
import { computeRun, type ComputedRun, type FinishedRunInput } from './runCompute';
import { load, save, STORAGE_KEYS } from './storage';

export { computeRun, type ComputedRun, type FinishedRunInput } from './runCompute';

export const DEFAULT_PLAYER = 'Trainer';

export function playerName(): string {
  return load<string>(STORAGE_KEYS.playerName, '') || DEFAULT_PLAYER;
}

export interface RunRanking {
  /** ranked = online gewertet, offline = kein Server, rejected = Server hat abgelehnt */
  status: 'ranked' | 'offline' | 'rejected';
  entryId: string | null;
  rankToday: number | null;
  rankAllTime: number | null;
  /** Tag der Wertung (Europe/Berlin) */
  day: string | null;
  /** Anzeigbarer Hinweis (z. B. Ablehnungsgrund) */
  message: string | null;
}

export interface FinishOutcome {
  input: FinishedRunInput;
  computed: ComputedRun;
  ranking: RunRanking;
  stats: ChallengeStats;
  /** Eintrag in der lokalen Run-Historie */
  localEntryId: string | null;
}

export interface FinishOptions {
  state: RunState;
  teamName: string;
  /** Token aus /api/runs/start – null bei lokal gestarteten Runs */
  token: string | null;
  /** Tag des Runs (für die Tages-Challenge) */
  day: string | null;
  byId: Map<number, Pokemon>;
  scale: Scale;
}

const offline = (message: string | null, day: string | null): RunRanking => ({
  status: 'offline',
  entryId: null,
  rankToday: null,
  rankAllTime: null,
  day,
  message,
});

export async function finishRun(o: FinishOptions): Promise<FinishOutcome> {
  const { config } = o.state;
  const challenge: ChallengeKey = config.challenge;
  let seasonSeed: number | null = null;
  let expectedScore: number | null = null;
  let ranking: RunRanking = offline(o.token ? null : 'Offline gespielt – nicht gewertet', o.day);

  if (o.token) {
    try {
      const res = await apiFinishRun({
        token: o.token,
        formation: config.formation,
        ssEnabled: config.ssEnabled,
        picks: o.state.picks,
        teamName: o.teamName,
        player: playerName(),
      });
      seasonSeed = res.seasonSeed;
      expectedScore = res.score;
      ranking = {
        status: 'ranked',
        entryId: res.entryId,
        rankToday: res.rankToday,
        rankAllTime: res.rankAllTime,
        day: res.day,
        message: null,
      };
    } catch (e) {
      const err = e as ApiRequestError;
      ranking =
        err instanceof ApiRequestError && err.status >= 400 && err.status < 500
          ? { ...offline(err.message, o.day), status: 'rejected' }
          : offline('Server nicht erreichbar – Run nicht gewertet', o.day);
    }
  }

  if (seasonSeed == null) {
    seasonSeed = challenge === 'daily' && (ranking.day ?? o.day) ? dailySeasonSeed((ranking.day ?? o.day)!) : randomSeed();
  }

  const input: FinishedRunInput = {
    formation: config.formation,
    slots: o.state.slots,
    ss: config.ssEnabled ? o.state.ss : undefined,
    teamName: o.teamName,
    seed: seasonSeed,
  };
  const computed = computeRun(input, o.byId, o.scale);
  if (expectedScore != null && expectedScore !== computed.evaluation.score) {
    console.warn(`Score weicht vom Server ab (Server ${expectedScore}, lokal ${computed.evaluation.score})`);
  }

  const stats = recordStats(challenge, computed.evaluation.score, computed.season.record);
  let localEntryId: string | null = null;
  try {
    const entry = await leaderboard.submit({
      challenge,
      player: playerName(),
      record: computed.season.record,
      points: computed.season.points,
      score: computed.evaluation.score,
      formation: config.formation,
      lineup: [...o.state.slots, ...(config.ssEnabled ? [o.state.ss] : [])],
      teamName: o.teamName,
    });
    localEntryId = entry.id;
  } catch {
    /* lokale Historie ist optional */
  }
  return { input, computed, ranking, stats, localEntryId };
}

/** Speichert den Spielernamen lokal und – falls erreichbar – online fürs Gerät. */
export async function savePlayerName(name: string, localEntryId: string | null): Promise<{ online: boolean }> {
  const clean = name.trim().slice(0, 24) || DEFAULT_PLAYER;
  save(STORAGE_KEYS.playerName, clean);
  if (localEntryId) await leaderboard.rename(localEntryId, clean);
  if (!(await apiAvailable())) return { online: false };
  try {
    await renamePlayer(clean);
    return { online: true };
  } catch {
    return { online: false };
  }
}

/**
 * @deprecated Übergangslösung für die alten Challenge-Seiten – wird beim Umbau
 * auf challengeEngine/finishRun entfernt.
 */
export async function recordFinishedRun(
  challenge: ChallengeKey,
  input: FinishedRunInput,
  run: ComputedRun,
): Promise<{ stats: ChallengeStats; entryId: string | null }> {
  const stats = recordStats(challenge, run.evaluation.score, run.season.record);
  const entry = await leaderboard.submit({
    challenge,
    player: playerName(),
    record: run.season.record,
    points: run.season.points,
    score: run.evaluation.score,
    formation: input.formation,
    lineup: [...input.slots, ...(input.ss !== undefined ? [input.ss] : [])],
    teamName: input.teamName,
  });
  return { stats, entryId: entry.id };
}
