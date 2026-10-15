/**
 * Abschluss eines Challenge-Runs – online gewertet oder lokal.
 *
 * Mit Token (Run wurde online gestartet) reicht finishRun das Zug-Protokoll beim
 * Server ein; der Server prüft es, zieht den Saison-Seed und speichert die Wertung.
 * Ohne Token oder ohne Server läuft alles lokal (ungewertet). In beiden Fällen
 * wird die Saison im Browser mit demselben Seed simuliert.
 */
import { messages } from '../i18n';
import type { ChallengeKey, Pokemon } from '../types';
import { ApiRequestError, apiAvailable, finishRun as apiFinishRun, renamePlayer } from './api/client';
import { cleanPlayerName, isDefaultPlayerName, LIMITS } from './api/contract';
import { recordRun as recordStats, type ChallengeStats } from './challengeStats';
import { recordDailyDay } from './dailyHistory';
import type { RunState } from './challengeEngine';
import { dailySeasonSeed } from './daily';
import { getDevice } from './device';
import type { Scale } from './fit';
import { leaderboard } from './leaderboard';
import { SEASON } from '../config/season';
import { opponentNames, rankingNames } from './rankingNames';
import { randomSeed } from './rng';
import { computeRun, type ComputedRun, type FinishedRunInput } from './runCompute';
import { load, save, STORAGE_KEYS } from './storage';

export { computeRun, type ComputedRun, type FinishedRunInput } from './runCompute';

// ---------------------------------------------------------------- Spieler- und Teamname

/**
 * Gespeicherter Spielername – leer, solange noch kein eigener gewählt ist. Früher hieß jedes
 * Gerät „Trainer"; ein so gespeicherter Name zählt wie keiner (isDefaultPlayerName).
 */
export function playerName(): string {
  const stored = load<unknown>(STORAGE_KEYS.playerName, '');
  const name = typeof stored === 'string' ? cleanPlayerName(stored) : '';
  return isDefaultPlayerName(name) ? '' : name;
}

/** Teamname wie gesendet: Leerraum zusammengefasst, getrimmt, höchstens LIMITS.teamNameMax Zeichen. */
export function cleanTeamName(raw: string): string {
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  return squash([...squash(raw)].slice(0, LIMITS.teamNameMax).join(''));
}

/** Sichtbarer Inhalt wie beim Server (server/validate.ts): Buchstabe, Ziffer oder Emoji */
const VISIBLE_RE = /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;

/** Pflichtfelder eines Runs */
export type NameField = 'player' | 'teamName';
/** empty: leer · default: „Trainer" · invisible: kein Buchstabe, keine Ziffer, kein Emoji */
export type NameProblem = 'empty' | 'default' | 'invisible';
/** Anzeigbare Meldung je fehlerhaftem Feld */
export type NameErrors = Partial<Record<NameField, string>>;

/** Fehlerhafte Pflichtfelder nach einem Start- bzw. Auswertungsversuch (useChallengeRun.issues). */
export interface NameIssues extends NameErrors {
  /** Erstes fehlerhaftes Feld – bekommt den Fokus */
  focus: NameField;
  /** Zählt die Versuche: Jeder neue gescheiterte Versuch fokussiert das Feld erneut. */
  attempt: number;
}

export function playerNameProblem(raw: string): NameProblem | null {
  const name = cleanPlayerName(raw);
  if (!name) return 'empty';
  // Erst „nichts Sichtbares" (z. B. nur ZWSP), dann „Trainer" – auch mit unsichtbaren Zusätzen.
  if (!VISIBLE_RE.test(name)) return 'invisible';
  return isDefaultPlayerName(name) ? 'default' : null;
}

export function teamNameProblem(raw: string): NameProblem | null {
  const name = cleanTeamName(raw);
  if (!name) return 'empty';
  return VISIBLE_RE.test(name) ? null : 'invisible';
}

/** Meldung zu einem Problem in der aktiven Sprache. */
export function nameProblemText(field: NameField, problem: NameProblem): string {
  const t = messages().challenge;
  if (field === 'teamName') return problem === 'invisible' ? t.teamNameInvisible : t.teamNameEmpty;
  if (problem === 'default') return t.playerNameDefault;
  return problem === 'invisible' ? t.playerNameInvisible : t.playerNameEmpty;
}

/** Prüft beide Pflichtfelder eines Runs – null, wenn alles passt. */
export function checkNames(player: string, teamName: string): NameErrors | null {
  const p = playerNameProblem(player);
  const tm = teamNameProblem(teamName);
  if (!p && !tm) return null;
  return {
    ...(p ? { player: nameProblemText('player', p) } : {}),
    ...(tm ? { teamName: nameProblemText('teamName', tm) } : {}),
  };
}

/**
 * Lehnt der Server einen Namen ab? name_required/bad_name → Spielername,
 * team_name_required → Teamname; sonst null.
 */
export function rejectedNameField(e: unknown): NameField | null {
  if (!(e instanceof ApiRequestError)) return null;
  if (e.code === 'name_required' || e.code === 'bad_name') return 'player';
  if (e.code === 'team_name_required') return 'teamName';
  return null;
}

/** Ungültiger Spielername beim Speichern (Meldung anzeigbar, in der aktiven Sprache). */
export class PlayerNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayerNameError';
  }
}

/** Zuletzt erfolgreich an den Server gesendeter Name – je Gerät, damit nicht jeder Start ihn erneut sendet. */
const SYNCED_KEY = 'player-name-online';
let synced: { deviceId: string; name: string } | null = null;

function lastSyncedName(): string | null {
  const s = synced ?? load<{ deviceId?: unknown; name?: unknown } | null>(SYNCED_KEY, null);
  return s && s.deviceId === getDevice().deviceId && typeof s.name === 'string' ? s.name : null;
}

function markSynced(name: string) {
  synced = { deviceId: getDevice().deviceId, name };
  save(SYNCED_KEY, synced);
}

/**
 * Sorgt dafür, dass der Server diesen Namen fürs Gerät kennt (POST /api/player). Gesendet wird
 * nur, wenn er sich seit dem letzten erfolgreichen Senden geändert hat – mit force immer.
 * Wirft ApiRequestError; lehnt der Server den Namen ab (400), immer mit Code 'bad_name'.
 */
export async function syncPlayerName(name: string, force = false): Promise<void> {
  if (!force && lastSyncedName() === name) return;
  try {
    await renamePlayer(name);
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 400 && e.code === 'bad_request') {
      throw new ApiRequestError(e.message, e.status, 'bad_name');
    }
    throw e;
  }
  markSynced(name);
}

/**
 * Speichert den (gültigen, gesäuberten) Namen lokal – er gilt für neue Runs. Alte Runs ohne
 * eigenen Namen („Trainer") bekommen ihn nicht: Sie sind aus der lokalen Historie gelöscht
 * (siehe leaderboard/local.ts), wie online.
 */
export function rememberPlayerName(name: string): void {
  save(STORAGE_KEYS.playerName, name);
}

export interface RunRanking {
  /** ranked = online gewertet, offline = kein Server, rejected = Server hat abgelehnt */
  status: 'ranked' | 'offline' | 'rejected';
  entryId: string | null;
  rankToday: number | null;
  rankAllTime: number | null;
  /** Tag der Wertung (Europe/Berlin) */
  day: string | null;
  /** Anzeigbarer Hinweis (z. B. Ablehnungsgrund) – in der Sprache beim Abschluss */
  message: string | null;
  /**
   * Fester Hinweis ohne Server-Meldung – die Anzeige übersetzt ihn in die aktuelle Sprache
   * (fehlt bei älteren gespeicherten Ergebnissen; dann gilt `message`).
   */
  note?: 'played_offline' | 'unreachable';
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
  /** Kapitän (Pokémon-ID aus der Elf) – null/fehlt = keiner */
  captain?: number | null;
  teamName: string;
  /** Token aus /api/runs/start – null bei lokal gestarteten Runs */
  token: string | null;
  /** Tag des Runs (für die Tages-Challenge) */
  day: string | null;
  byId: Map<number, Pokemon>;
  scale: Scale;
  /** Spielername für Wertung und lokale Historie – Standard: playerName() */
  player?: string;
  /**
   * false: Ist der Server bei einem Online-Run nicht erreichbar (Netzwerk/5xx) oder bremst er
   * (429), wird der Fehler geworfen statt offline auszuwerten – so kann der Aufrufer erneut
   * senden lassen. „Bereits gewertet" (token_used) wird immer geworfen.
   */
  networkFallback?: boolean;
}

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
  const t = messages().challenge;
  if (isAlreadyRanked(e)) return t.alreadyRanked;
  if (isRateLimited(e)) return t.finishRateLimited(sentence((e as ApiRequestError).message));
  if (isRetryable(e)) return t.finishFailed;
  return t.finishError(e instanceof Error ? e.message : String(e));
}

const offline = (message: string | null, day: string | null, note?: RunRanking['note']): RunRanking => ({
  status: 'offline',
  entryId: null,
  rankToday: null,
  rankAllTime: null,
  day,
  message,
  ...(note ? { note } : {}),
});

export async function finishRun(o: FinishOptions): Promise<FinishOutcome> {
  const { config } = o.state;
  const challenge: ChallengeKey = config.challenge;
  let seasonSeed: number | null = null;
  let expectedScore: number | null = null;
  const t = messages().challenge;
  const player = o.player ?? playerName();
  let ranking: RunRanking = o.token ? offline(null, o.day) : offline(t.playedOffline, o.day, 'played_offline');

  if (o.token) {
    try {
      const res = await apiFinishRun({
        token: o.token,
        formation: config.formation,
        ssEnabled: config.ssEnabled,
        picks: o.state.picks,
        teamName: o.teamName,
        player,
        ...(o.captain != null ? { captain: o.captain } : {}),
      });
      // Der Server übernimmt einen gültigen Namen beim Abschluss fürs Gerät.
      if (!playerNameProblem(player)) markSynced(cleanPlayerName(player));
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
      // Name oder Teamname abgelehnt: korrigieren lassen und erneut senden – der Token bleibt gültig.
      if (rejectedNameField(e)) throw e;
      if (o.networkFallback === false && isRetryable(e)) throw e;
      if (isRateLimited(e)) {
        ranking = offline(t.notRanked((e as ApiRequestError).message), o.day);
      } else if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) {
        ranking = { ...offline(e.message, o.day), status: 'rejected' };
      } else {
        ranking = offline(t.unreachableNotRanked, o.day, 'unreachable');
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
    ...(o.captain != null ? { captain: o.captain } : {}),
    // Gegner heißen wie Teams aus den Online-Ranglisten (sofern geladen) – fest im gespeicherten Run
    ...(rankingNames().length ? { opponentNames: opponentNames(SEASON.opponents, seasonSeed, rankingNames(), [o.teamName]) } : {}),
  };
  const computed = computeRun(input, o.byId, o.scale);
  if (expectedScore != null && expectedScore !== computed.evaluation.score) {
    console.warn(`Score weicht vom Server ab (Server ${expectedScore}, lokal ${computed.evaluation.score})`);
  }

  const stats = recordStats(challenge, computed.evaluation.score, computed.season.record);
  const playedDay = ranking.day ?? o.day;
  if (challenge === 'daily' && playedDay) {
    recordDailyDay({
      day: playedDay,
      record: computed.season.record,
      points: computed.season.points,
      score: computed.evaluation.score,
      position: computed.season.position,
    });
  }
  let localEntryId: string | null = null;
  try {
    const entry = await leaderboard.submit({
      challenge,
      player,
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

/**
 * Speichert den Spielernamen – falls erreichbar zuerst online fürs Gerät, dann lokal.
 * Wirft PlayerNameError, wenn der Name fehlt, „Trainer" heißt oder der Server ihn ablehnt
 * (dann wird nichts gespeichert). Andere Server-Fehler: nur lokal gespeichert ({ online: false }).
 */
export async function savePlayerName(name: string, localEntryId: string | null): Promise<{ online: boolean }> {
  const problem = playerNameProblem(name);
  if (problem) throw new PlayerNameError(nameProblemText('player', problem));
  const clean = cleanPlayerName(name);
  let online = false;
  if (await apiAvailable()) {
    try {
      await syncPlayerName(clean, true);
      online = true;
    } catch (e) {
      if (rejectedNameField(e)) throw new PlayerNameError((e as Error).message);
    }
  }
  rememberPlayerName(clean);
  if (localEntryId) await leaderboard.rename(localEntryId, clean);
  return { online };
}
