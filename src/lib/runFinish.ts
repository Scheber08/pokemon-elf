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
  /**
   * false: Ist der Server bei einem Online-Run nicht erreichbar (Netzwerk/5xx) oder bremst er
   * (429), wird der Fehler geworfen statt offline auszuwerten – so kann der Aufrufer erneut
   * senden lassen. „Bereits gewertet" (token_used) wird immer geworfen.
   */
  networkFallback?: boolean;
}

const FINISH_FAILED =
  'Server nicht erreichbar – dein Run ist noch nicht gewertet. Sende ihn gleich noch einmal oder werte ihn offline aus (dann ohne Wertung).';
const ALREADY_RANKED =
  'Dieser Run ist auf dem Server schon gewertet, das Ergebnis ist hier aber noch nicht angekommen. Sende ihn gleich noch einmal, um dein gewertetes Ergebnis zu laden.';

/** Meldung als Satz: ergänzt den Punkt, falls kein Satzzeichen am Ende steht. */
const sentence = (msg: string) => (/[.!?…]$/.test(msg) ? msg : `${msg}.`);

/** 429 – der Server bremst nur; der Token bleibt gültig, später erneut senden klappt. */
export function isRateLimited(e: unknown): boolean {
  return e instanceof ApiRequestError && (e.status === 429 || e.code === 'rate_limited');
}

/** Netzwerkfehler, Serverfehler (5xx) oder 429 – ein erneuter Versuch kann klappen. */
export function isRetryable(e: unknown): boolean {
  return (
    e instanceof ApiRequestError && (e.code === 'network' || e.status === 0 || e.status >= 500 || isRateLimited(e))
  );
}

/**
 * 409 token_used: Der Server hat diesen Run schon gewertet (Antwort verloren, zweiter Tab …).
 * Dann nie eine eigene Zufalls-Saison zeigen oder speichern, sondern erneut senden lassen.
 */
export function isAlreadyRanked(e: unknown): boolean {
  return e instanceof ApiRequestError && e.code === 'token_used';
}

/** Anzeigbarer Fehler, wenn finishRun geworfen hat (der Run bleibt dann in 'play'). */
export function finishErrorMessage(e: unknown): string {
  if (isAlreadyRanked(e)) return ALREADY_RANKED;
  if (isRateLimited(e)) {
    const msg = sentence((e as ApiRequestError).message);
    return `${msg} Dein Run ist noch nicht gewertet – sende ihn später noch einmal oder werte ihn offline aus (dann ohne Wertung).`;
  }
  if (isRetryable(e)) return FINISH_FAILED;
  return `Auswertung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
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
      // Schon gewertet: Saison-Seed liegt nur beim Server – nichts erfinden, nichts speichern.
      if (isAlreadyRanked(e)) throw e;
      if (o.networkFallback === false && isRetryable(e)) throw e;
      if (isRateLimited(e)) {
        ranking = offline(`${(e as ApiRequestError).message} – Run nicht gewertet`, o.day);
      } else if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) {
        ranking = { ...offline(e.message, o.day), status: 'rejected' };
      } else {
        ranking = offline('Server nicht erreichbar – Run nicht gewertet', o.day);
      }
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
