/**
 * useChallengeRun – Zustand eines Challenge-Runs auf Basis der challengeEngine.
 * Genutzt von der 34–0 Challenge, der 151-Seite (151 Challenge + Retro 34–0) und
 * der Tageschallenge „Tägliche Elf".
 *
 *   const run = useChallengeRun(storageId, { challenge?, allowed? });
 *
 * Phasen: 'setup' → start() → 'play' → finish() → 'result' → reset() → 'setup'
 *
 *   phase                  'setup' | 'play' | 'result'
 *   setup                  { challenge, formation, ssEnabled, teamName } – Werte des Setup-Formulars
 *   setSetup(patch)        Setup ändern (nur in Phase 'setup', nicht während start() läuft;
 *                          challenge nur innerhalb von `allowed`)
 *   challenge              Challenge des laufenden/letzten Runs (in 'setup': setup.challenge)
 *   engine                 RunState der Engine in 'play' und 'result' (bis reset()), sonst null
 *   data                   EngineData (für RunBoard), einmal pro Pokémon-Liste gebaut
 *   online                 Run wurde online gestartet (hat Token) → wird beim Abschluss gewertet
 *   day                    Tag des Runs: Server-Tag (online) bzw. dayKey() (offline)
 *   apiOnline              Backend erreichbar? null = wird noch geprüft
 *   start(opts?)           Online, wenn das Backend da ist: Seed + Token vom Server
 *                          (Tages-Challenge: Seed des Tages). Sonst lokal: Seed =
 *                          dailyRunSeed(dayKey()) bzw. randomSeed(). `{ offline: true }`
 *                          erzwingt einen lokalen, ungewerteten Run (z. B. Üben nach
 *                          „already_played"). Gilt das Backend als offline, wird vorher
 *                          erneut geprüft. Fehler (siehe startFailure):
 *                            already_played → `error`, bleibt in 'setup'
 *                            Backend weg, Netzwerk, 5xx, 429, sonstige 4xx → lokaler Run +
 *                            `notice` (mit Server-Meldung)
 *                            (offlineFallback 'ask': `error` + canStartOffline, bleibt in 'setup')
 *   reroll(kind)           challengeEngine.applyReroll – Fehler landen in `error`
 *   place(pokemonId, slot) challengeEngine.place – Fehler landen in `error`
 *   finish(opts?)          runFinish.finishRun (online einreichen oder lokal) → 'result'.
 *                          Liefert true bei Erfolg. Ist der Server nicht erreichbar oder
 *                          bremst er (429), bleibt der Run in 'play' (`error` + canFinishOffline):
 *                          erneut finish() oder finish({ offline: true }) wertet lokal ohne
 *                          Wertung aus. Meldet der Server „bereits gewertet" (token_used),
 *                          bleibt der Run ebenfalls in 'play' – ohne Offline-Auswertung, denn
 *                          die gewertete Saison kennt nur der Server; erneut finish() lädt sie.
 *   result                 { challenge, input, ranking, localEntryId, reveal } | null
 *                          `reveal` = Live-Ticker abspielen. Bleibt für diese Hook-Instanz
 *                          stabil, auch nach markRevealed().
 *   markRevealed()         Merkt sich, dass der Ticker gezeigt wurde – nach Reload/Remount
 *                          kommt direkt die Bilanz. Darf sofort beim Anzeigen aufgerufen werden.
 *   reset()                Zurück zu 'setup', Setup-Werte bleiben.
 *   starting, finishing    laufende Anfragen (Buttons sperren)
 *   error, clearError()    anzeigbarer Fehler (in der Sprache beim Auftreten)
 *   notice, clearNotice()  Hinweis, z. B. „Server nicht erreichbar – Run läuft offline"
 *   stats                  lokale Bestwerte der aktiven Challenge, nach finish() aktualisiert
 *
 * Alles Nötige zum Fortsetzen (Phase, Setup, Engine-Zustand, Token, Tag, Ergebnis) liegt
 * in localStorage unter STORAGE_KEYS.run(storageId). Der Engine-Zustand wird beim Laden aus
 * seinem Zug-Protokoll neu aufgebaut (so wie der Server ihn nachspielt); Daten älterer
 * Seitenversionen werden erkannt und verworfen – nur Formation/SS/Teamname bleiben.
 *
 * start()/finish() sind gegen Doppelklicks und StrictMode-Doppelaufrufe abgesichert.
 * `storageId` und `options` müssen über die Lebensdauer der Komponente gleich bleiben.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FORMATION, FORMATION_IDS } from '../config/formations';
import { messages } from '../i18n';
import { ApiRequestError, apiAvailable, apiEverOnline, onApiHealth, startRun as apiStartRun } from '../lib/api/client';
import { LIMITS } from '../lib/api/contract';
import {
  applyReroll,
  createEngineData,
  EngineError,
  isComplete,
  MODE_RULES,
  place as placeOnEngine,
  REROLL_KINDS,
  startRun as startEngine,
  type EngineData,
  type RerollKind,
  type RunConfig,
  type RunState,
} from '../lib/challengeEngine';
import { loadStats, type ChallengeStats } from '../lib/challengeStats';
import { dailyRunSeed, dayKey, isDayKey } from '../lib/daily';
import { randomSeed } from '../lib/rng';
import {
  finishErrorMessage,
  finishRun,
  isAlreadyRanked,
  isRetryable,
  type FinishedRunInput,
  type RunRanking,
} from '../lib/runFinish';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import type { ChallengeKey, FormationId, Pokemon } from '../types';
import { usePokemonData } from './PokemonData';

export type RunPhase = 'setup' | 'play' | 'result';

export interface RunSetupValues {
  challenge: ChallengeKey;
  formation: FormationId;
  ssEnabled: boolean;
  teamName: string;
}

export interface RunResult {
  /** Challenge des ausgewerteten Runs */
  challenge: ChallengeKey;
  input: FinishedRunInput;
  ranking: RunRanking;
  /** Eintrag in der lokalen Run-Historie (Umbenennen) */
  localEntryId: string | null;
  /** Live-Ticker abspielen (siehe markRevealed) */
  reveal: boolean;
}

export interface ChallengeRunOptions {
  /** Challenge neuer Runs – Standard: storageId, falls gültig, sonst 'c340' */
  challenge?: ChallengeKey;
  /** Challenges, die setup.challenge annehmen darf – Standard: nur `challenge` */
  allowed?: readonly ChallengeKey[];
  /**
   * Was passiert, wenn der Online-Start scheitert (Backend weg, Netzwerk, 5xx, 429 …):
   * 'auto' (Standard) startet automatisch offline (mit Hinweis), 'ask' bleibt im Setup und
   * setzt canStartOffline – z. B. für die Tages-Challenge mit nur einem Versuch.
   */
  offlineFallback?: 'auto' | 'ask';
}

export interface StartOptions {
  /** Lokal und ungewertet spielen, auch wenn das Backend erreichbar ist */
  offline?: boolean;
}

export interface FinishOptions {
  /** Ohne Server auswerten (ungewertet), z. B. nachdem das Senden gescheitert ist */
  offline?: boolean;
}

export interface ChallengeRun {
  phase: RunPhase;
  setup: RunSetupValues;
  setSetup(patch: Partial<RunSetupValues>): void;
  challenge: ChallengeKey;
  engine: RunState | null;
  data: EngineData;
  online: boolean;
  day: string | null;
  apiOnline: boolean | null;
  start(opts?: StartOptions): Promise<void>;
  reroll(kind: RerollKind): void;
  place(pokemonId: number, slot: number): void;
  finish(opts?: FinishOptions): Promise<boolean>;
  /** Online-Start gescheitert (offlineFallback 'ask') → start({ offline: true }) anbieten */
  canStartOffline: boolean;
  /** Senden beim Abschluss gescheitert (Netzwerk/5xx/429) → erneut senden oder finish({ offline: true }) anbieten */
  canFinishOffline: boolean;
  result: RunResult | null;
  markRevealed(): void;
  reset(): void;
  starting: boolean;
  finishing: boolean;
  error: string | null;
  clearError(): void;
  notice: string | null;
  clearNotice(): void;
  stats: ChallengeStats;
}

/** Gespeichertes Format (v2). Ältere Seitenversionen hatten kein `v`/`engine`. */
interface Persisted {
  v: 2;
  phase: RunPhase;
  setup: RunSetupValues;
  engine: RunState | null;
  /** Token aus /api/runs/start – nur bei Online-Runs bis zum Abschluss */
  token: string | null;
  day: string | null;
  online: boolean;
  result: RunResult | null;
}

/** Steht für „Backend beim Start nicht erreichbar" (Health-Check gescheitert). */
const unreachable = () => new ApiRequestError(messages().errors.network, 0, 'network');

/**
 * Anzeigbarer Text zu einem Fehler der Engine (Reroll/Setzen/Start) in der aktiven Sprache –
 * über den Code des EngineError; ohne Code die Meldung selbst.
 */
export function engineErrorText(e: unknown, byId: Map<number, Pokemon>): string {
  if (!(e instanceof EngineError) || !e.info) return e instanceof Error ? e.message : String(e);
  const { game, challenge } = messages();
  const t = challenge.engine;
  const info = e.info;
  const p = info.pokemonId != null ? byId.get(info.pokemonId) : undefined;
  const name = p ? game.pokemon(p) : `#${info.pokemonId}`;
  switch (info.code) {
    case 'finished':
      return t.finished;
    case 'no_reroll':
      return t.noReroll(info.kind ?? '');
    case 'no_other_roll':
      return t.noOtherRoll;
    case 'unknown_pokemon':
      return t.unknownPokemon(info.pokemonId ?? 0);
    case 'not_allowed':
      return t.notAllowed(name);
    case 'in_team':
      return t.inTeam(name);
    case 'no_match':
      return t.noMatch(name);
    case 'legend_limit':
      return challenge.legendLimit(info.max ?? 2);
    case 'slot_taken':
      return t.slotTaken(info.slot ?? 0);
    case 'pool_empty':
      return t.poolEmpty;
    case 'unknown_challenge':
      return t.unknownChallenge(info.value ?? '');
    case 'unknown_formation':
      return t.unknownFormation(info.value ?? '');
    case 'bad_seed':
      return t.badSeed;
    case 'bad_log':
      return t.badLog;
    case 'bad_pick':
      return t.badPick;
    default:
      return e.message;
  }
}

/** Reaktion von start() auf einen gescheiterten Online-Start. */
export type StartFailure =
  /** already_played: im Setup bleiben, kein Offline-Angebot (Üben nur ausdrücklich) */
  | { kind: 'stop'; error: string }
  /** offlineFallback 'ask': im Setup bleiben, `error` + canStartOffline */
  | { kind: 'ask'; error: string }
  /** offlineFallback 'auto': lokaler, ungewerteter Run mit Hinweis (null = still) */
  | { kind: 'offline'; notice: string | null };

/**
 * Entscheidet, wie start() mit einem Fehler beim Online-Start umgeht. Nur „heute schon
 * gespielt" stoppt hart – 429 (z. B. zu viele neue Geräte hinter einer gemeinsamen IP) und
 * andere 4xx dürfen nie das ungewertete Spielen verhindern.
 */
export function startFailure(e: unknown, offlineFallback: 'auto' | 'ask'): StartFailure {
  const t = messages().challenge;
  if (e instanceof ApiRequestError && e.code === 'already_played') return { kind: 'stop', error: e.message };
  // 4xx inkl. 429: Meldung des Servers zeigen; Netzwerk/5xx: „nicht erreichbar"
  const serverMsg = e instanceof ApiRequestError && e.status >= 400 && e.status < 500 ? e.message : null;
  if (offlineFallback === 'ask') return { kind: 'ask', error: serverMsg ?? t.startFailed };
  // Ohne Backend (statisches Hosting, `npm run dev`) hat das Setup schon „Offline" angezeigt –
  // dann still offline starten; nur ein Ausfall eines eben noch erreichbaren Servers bekommt den Hinweis.
  if (!serverMsg) return { kind: 'offline', notice: apiEverOnline() ? t.offlineFallback : null };
  const sentence = /[.!?…]$/.test(serverMsg) ? serverMsg : `${serverMsg}.`;
  return { kind: 'offline', notice: t.offlineWithReason(sentence) };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

export const isChallengeKey = (x: unknown): x is ChallengeKey =>
  typeof x === 'string' && Object.prototype.hasOwnProperty.call(MODE_RULES, x);

const isFormation = (x: unknown): x is FormationId =>
  typeof x === 'string' && (FORMATION_IDS as readonly string[]).includes(x);

const freshState = (setup: RunSetupValues): Persisted => ({
  v: 2,
  phase: 'setup',
  setup,
  engine: null,
  token: null,
  day: null,
  online: false,
  result: null,
});

/** Setup-Werte lesen – auch aus dem alten Format (Felder auf oberster Ebene, 151: `mode`). */
function readSetup(x: unknown, fallback: RunSetupValues, allowed: readonly ChallengeKey[]): RunSetupValues {
  if (!isObj(x)) return fallback;
  const legacy = x.mode === 'retro' ? 'retro340' : x.mode === 'classic' ? 'c151' : undefined;
  const challenge = [x.challenge, legacy].find(
    (c): c is ChallengeKey => isChallengeKey(c) && allowed.includes(c),
  );
  return {
    challenge: challenge ?? fallback.challenge,
    formation: isFormation(x.formation) ? x.formation : fallback.formation,
    ssEnabled: typeof x.ssEnabled === 'boolean' ? x.ssEnabled : fallback.ssEnabled,
    teamName: typeof x.teamName === 'string' ? x.teamName.slice(0, LIMITS.teamNameMax) : fallback.teamName,
  };
}

/**
 * Baut den Engine-Zustand aus Konfiguration + Zug-Protokoll neu auf – genau wie der
 * Server. Passt etwas nicht (manipuliert, alte Engine), gibt es null.
 */
function restoreEngine(x: unknown, data: EngineData, allowed: readonly ChallengeKey[]): RunState | null {
  if (!isObj(x) || !isObj(x.config) || !Array.isArray(x.picks) || !Array.isArray(x.roundRerolls)) return null;
  const c = x.config;
  if (!isChallengeKey(c.challenge) || !allowed.includes(c.challenge)) return null;
  const config: RunConfig = {
    challenge: c.challenge,
    formation: c.formation as FormationId,
    ssEnabled: c.ssEnabled === true,
    seed: c.seed as number,
  };
  const validKinds = (k: unknown): k is RerollKind[] =>
    Array.isArray(k) && k.every((kind) => REROLL_KINDS.includes(kind as RerollKind));
  try {
    let s = startEngine(config, data);
    for (const p of x.picks as unknown[]) {
      if (!isObj(p) || !validKinds(p.rerolls)) return null;
      for (const kind of p.rerolls) s = applyReroll(s, kind, data);
      s = placeOnEngine(s, p.pokemonId as number, p.slot as number, data);
    }
    if (!validKinds(x.roundRerolls)) return null;
    for (const kind of x.roundRerolls) s = applyReroll(s, kind, data);
    return s;
  } catch {
    return null;
  }
}

function readResult(x: unknown, allowed: readonly ChallengeKey[]): RunResult | null {
  if (!isObj(x) || !isObj(x.input) || !isObj(x.ranking)) return null;
  if (!isChallengeKey(x.challenge) || !allowed.includes(x.challenge)) return null;
  const input = x.input;
  if (
    !isFormation(input.formation) ||
    !Array.isArray(input.slots) ||
    !Number.isInteger(input.seed) ||
    typeof input.teamName !== 'string'
  ) {
    return null;
  }
  return {
    challenge: x.challenge,
    input: input as unknown as FinishedRunInput,
    ranking: x.ranking as unknown as RunRanking,
    localEntryId: typeof x.localEntryId === 'string' ? x.localEntryId : null,
    reveal: x.reveal === true,
  };
}

function loadPersisted(
  key: string,
  fallback: RunSetupValues,
  allowed: readonly ChallengeKey[],
  data: EngineData,
): Persisted {
  const raw = load<unknown>(key, null);
  if (!isObj(raw)) return freshState(fallback);
  // Altes Format: Setup-Felder lagen auf oberster Ebene, es gab kein `engine`.
  const setup = readSetup(isObj(raw.setup) ? raw.setup : raw, fallback, allowed);
  if (raw.v !== 2 || !('engine' in raw)) return freshState(setup);

  const day = typeof raw.day === 'string' && isDayKey(raw.day) ? raw.day : null;
  const token = typeof raw.token === 'string' ? raw.token : null;
  if (raw.phase === 'play') {
    const engine = restoreEngine(raw.engine, data, allowed);
    if (!engine) return freshState(setup);
    return { ...freshState(setup), phase: 'play', engine, token, day, online: raw.online === true && token != null };
  }
  if (raw.phase === 'result') {
    const result = readResult(raw.result, allowed);
    if (!result) return freshState(setup);
    const engine = raw.engine ? restoreEngine(raw.engine, data, allowed) : null;
    return { ...freshState(setup), phase: 'result', engine, day, online: raw.online === true, result };
  }
  return freshState(setup);
}

/**
 * Ist das Backend erreichbar? null, solange die erste Prüfung läuft. Folgt jeder weiteren
 * Prüfung (z. B. vor einem Start); nach einem Fehlschlag wird erneut geprüft, sobald das
 * Netz zurück ist oder der Tab wieder sichtbar wird (ein Erfolg gilt für den Seitenaufruf).
 */
export function useApiOnline(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = (recheck = false) => void apiAvailable(recheck).then((ok) => alive && setOnline(ok));
    const unsubscribe = onApiHealth((ok) => alive && setOnline(ok));
    const onNetworkBack = () => check(true);
    const onVisible = () => document.visibilityState === 'visible' && check();
    check();
    window.addEventListener('online', onNetworkBack);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener('online', onNetworkBack);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return online;
}

export function useChallengeRun(storageId: string, options: ChallengeRunOptions = {}): ChallengeRun {
  const { list, byId, scale } = usePokemonData();
  const data = useMemo(() => createEngineData(list), [list]);
  const key = STORAGE_KEYS.run(storageId);
  const defaultChallenge: ChallengeKey = options.challenge ?? (isChallengeKey(storageId) ? storageId : 'c340');
  const allowedRef = useRef<readonly ChallengeKey[]>(options.allowed ?? [defaultChallenge]);

  const [state, setState] = useState<Persisted>(() =>
    loadPersisted(
      key,
      { challenge: defaultChallenge, formation: DEFAULT_FORMATION, ssEnabled: false, teamName: '' },
      allowedRef.current,
      data,
    ),
  );
  /** Immer aktueller Zustand – async-Abläufe lesen hier statt aus veralteten Closures. */
  const stateRef = useRef(state);
  /** Ergebnis, dessen Ticker in dieser Instanz abgespielt wird (hält `reveal` stabil). */
  const [revealFor, setRevealFor] = useState<FinishedRunInput | null>(() =>
    state.result?.reveal ? state.result.input : null,
  );
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statsVersion, setStatsVersion] = useState(0);
  const [canStartOffline, setCanStartOffline] = useState(false);
  const [canFinishOffline, setCanFinishOffline] = useState(false);
  /** Token, den der Server als „bereits gewertet" gemeldet hat – dafür nie offline auswerten. */
  const rankedTokenRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const offlineFallback = options.offlineFallback ?? 'auto';
  /** Wird bei start()/reset() erhöht – verspätete Antworten alter Abläufe werden verworfen. */
  const generation = useRef(0);
  const apiOnline = useApiOnline();

  /** Neuen Zustand übernehmen und sofort speichern (auch wenn die Seite gerade verlassen wird). */
  const commit = useCallback(
    (next: Persisted) => {
      stateRef.current = next;
      save(key, next);
      setState(next);
    },
    [key],
  );

  const setSetup = useCallback(
    (patch: Partial<RunSetupValues>) => {
      const cur = stateRef.current;
      if (cur.phase !== 'setup' || startingRef.current) return;
      const next = { ...cur.setup, ...patch };
      if (!allowedRef.current.includes(next.challenge) || !isFormation(next.formation)) return;
      commit({ ...cur, setup: next });
    },
    [commit],
  );

  const start = useCallback(
    async (opts: StartOptions = {}) => {
      if (startingRef.current || stateRef.current.phase !== 'setup') return;
      startingRef.current = true;
      const gen = ++generation.current;
      setStarting(true);
      setError(null);
      setNotice(null);
      setCanStartOffline(false);
      const setup = stateRef.current.setup;
      const { challenge } = setup;
      try {
        let seed: number | null = null;
        let token: string | null = null;
        let day: string | null = null;
        let info: string | null = null;
        if (!opts.offline) {
          try {
            // Ein zwischengespeicherter Fehlschlag wird vor dem Start neu geprüft.
            if (!(await apiAvailable(true))) throw unreachable();
            const res = await apiStartRun(challenge);
            seed = res.seed;
            token = res.token;
            day = res.day;
          } catch (e) {
            const failure = startFailure(e, offlineFallback);
            if (failure.kind !== 'offline') {
              if (gen === generation.current) {
                setError(failure.error);
                setCanStartOffline(failure.kind === 'ask');
              }
              return;
            }
            info = failure.notice;
          }
        }
        if (gen !== generation.current) return;
        if (seed == null) {
          day = dayKey();
          seed = challenge === 'daily' ? dailyRunSeed(day) : randomSeed();
        }
        const engine = startEngine(
          { challenge, formation: setup.formation, ssEnabled: setup.ssEnabled, seed },
          data,
        );
        commit({ ...freshState(setup), phase: 'play', engine, token, day, online: token != null });
        setRevealFor(null);
        setNotice(info);
      } catch (e) {
        if (gen === generation.current) setError(messages().challenge.startError(engineErrorText(e, byId)));
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [byId, commit, data, offlineFallback],
  );

  const reroll = useCallback(
    (kind: RerollKind) => {
      const cur = stateRef.current;
      if (cur.phase !== 'play' || !cur.engine || finishingRef.current) return;
      try {
        commit({ ...cur, engine: applyReroll(cur.engine, kind, data) });
        setError(null);
      } catch (e) {
        setError(engineErrorText(e, byId));
      }
    },
    [byId, commit, data],
  );

  const place = useCallback(
    (pokemonId: number, slot: number) => {
      const cur = stateRef.current;
      if (cur.phase !== 'play' || !cur.engine || finishingRef.current) return;
      try {
        commit({ ...cur, engine: placeOnEngine(cur.engine, pokemonId, slot, data) });
        setError(null);
      } catch (e) {
        setError(engineErrorText(e, byId));
      }
    },
    [byId, commit, data],
  );

  const finish = useCallback(async (opts: FinishOptions = {}): Promise<boolean> => {
    const cur = stateRef.current;
    if (finishingRef.current || cur.phase !== 'play' || !cur.engine || !isComplete(cur.engine)) return false;
    finishingRef.current = true;
    const gen = generation.current;
    setFinishing(true);
    setError(null);
    try {
      const challenge = cur.engine.config.challenge;
      const outcome = await finishRun({
        state: cur.engine,
        teamName: cur.setup.teamName.trim().slice(0, LIMITS.teamNameMax),
        token: opts.offline ? null : cur.token,
        day: cur.day,
        byId,
        scale: scale(MODE_RULES[challenge].scale),
        // Online-Runs nicht still offline auswerten – erst erneut senden lassen.
        networkFallback: false,
      });
      if (gen !== generation.current) return false;
      const result: RunResult = {
        challenge,
        input: outcome.input,
        ranking: outcome.ranking,
        localEntryId: outcome.localEntryId,
        reveal: true,
      };
      commit({ ...stateRef.current, phase: 'result', token: null, day: outcome.ranking.day ?? cur.day, result });
      setRevealFor(outcome.input);
      setStatsVersion((v) => v + 1);
      setCanFinishOffline(false);
      return true;
    } catch (e) {
      // Token und Phase 'play' bleiben – erneut senden ist möglich.
      if (gen === generation.current) {
        setError(finishErrorMessage(e));
        // Bereits gewertet: nie (auch nicht nach einem späteren Netzwerkfehler) offline auswerten –
        // das zeigte eine andere Saison als die gespeicherte.
        if (isAlreadyRanked(e)) rankedTokenRef.current = cur.token;
        const ranked = cur.token != null && rankedTokenRef.current === cur.token;
        if (isRetryable(e)) setCanFinishOffline(!ranked);
        else if (ranked) setCanFinishOffline(false);
      }
      return false;
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  }, [byId, commit, scale]);

  const markRevealed = useCallback(() => {
    const cur = stateRef.current;
    if (cur.result?.reveal) commit({ ...cur, result: { ...cur.result, reveal: false } });
  }, [commit]);

  const reset = useCallback(() => {
    generation.current++;
    commit(freshState(stateRef.current.setup));
    setRevealFor(null);
    setError(null);
    setNotice(null);
    setCanStartOffline(false);
    setCanFinishOffline(false);
  }, [commit]);

  const clearError = useCallback(() => setError(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  const challenge: ChallengeKey =
    state.phase === 'setup'
      ? state.setup.challenge
      : state.engine?.config.challenge ?? state.result?.challenge ?? state.setup.challenge;

  // statsVersion erzwingt das Neuladen nach finish()
  const stats = useMemo(() => loadStats(challenge), [challenge, statsVersion]);

  const result = useMemo<RunResult | null>(
    () => (state.result ? { ...state.result, reveal: revealFor != null && state.result.input === revealFor } : null),
    [state.result, revealFor],
  );

  return {
    phase: state.phase,
    setup: state.setup,
    setSetup,
    challenge,
    engine: state.engine,
    data,
    online: state.online,
    day: state.day,
    apiOnline,
    start,
    reroll,
    place,
    finish,
    canStartOffline,
    canFinishOffline,
    result,
    markRevealed,
    reset,
    starting,
    finishing,
    error,
    clearError,
    notice,
    clearNotice,
    stats,
  };
}

