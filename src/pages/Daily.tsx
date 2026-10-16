import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HowItWorks, RunNamesPrompt, RunSetup, StatCards } from '../components/ChallengeParts';
import { DailyStreak } from '../components/DailyStreak';
import { RunBoard, RunModeBadge, RunNotice } from '../components/RunBoard';
import { SeasonResultView } from '../components/SeasonResultView';
import { fetchLeaderboard } from '../lib/api/client';
import type { LeaderboardRow } from '../lib/api/contract';
import { useT } from '../i18n';
import { MODE_RULES } from '../lib/challengeEngine';
import { dailyNumber, dayKey, msUntilNextDay } from '../lib/daily';
import { dailyStreak, loadDailyHistory } from '../lib/dailyHistory';
import { keepDailyRun } from '../lib/dailyRun';
import { buildDailyShareText, formatCountdown, formatDayLong } from '../lib/dailyShare';
import { copyText } from '../lib/exportImage';
import type { ComputedRun, RunRanking } from '../lib/runFinish';
import { formatRecord } from '../lib/season';
import { useSettings } from '../state/Settings';
import { useToast } from '../state/Toast';
import { useChallengeRun } from '../state/useChallengeRun';
import '../styles/daily.css';

/** Deep-Link auf die heutige Tageswertung der Rangliste */
const BOARD_LINK = '/rangliste?c=daily&p=today';

interface DailyClock {
  /** Heutiger Tag in Berlin „YYYY-MM-DD" */
  today: string;
  /** Zeitpunkt (ms) des nächsten Tageswechsels */
  nextAt: number;
}

function readClock(): DailyClock {
  const now = new Date();
  return { today: dayKey(now), nextAt: now.getTime() + msUntilNextDay(now) };
}

/** Heutiger Tag – springt um Mitternacht (Berlin) automatisch weiter. */
function useDailyClock(): DailyClock {
  const [clock, setClock] = useState(readClock);
  useEffect(() => {
    const check = () => setClock((c) => (dayKey() === c.today ? c : readClock()));
    // Kurz nach Mitternacht prüfen; Intervall + Sichtbarkeit fangen gedrosselte Timer und Standby ab.
    const timer = window.setTimeout(check, Math.max(0, clock.nextAt - Date.now()) + 200);
    const interval = window.setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', check);
    };
  }, [clock]);
  return clock;
}

/** „Neue Elf in 05:12:33" – tickt jede Sekunde (eigene Komponente, damit nur sie neu rendert). */
function Countdown({ nextAt }: { nextAt: number }) {
  const t = useT();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="daily-countdown">
      <span className="daily-countdown__label">{t.daily.countdownLabel}</span>
      <span className="daily-countdown__time" role="timer">
        {formatCountdown(nextAt - now)}
      </span>
    </p>
  );
}

/** Online-Status im Setup – offline klar als „nicht gewertet" markiert. */
function DailyNetNote({ online }: { online: boolean | null }) {
  const t = useT();
  const [mod, text] =
    online == null
      ? ['checking', t.daily.netChecking]
      : online
        ? ['online', t.daily.netOnline]
        : ['offline', t.daily.netOffline];
  return (
    <p className={`runnet runnet--${mod}`} role="status">
      <span className="runnet__dot" aria-hidden="true" />
      {text}
    </p>
  );
}

interface TodayEntry {
  day: string;
  row: LeaderboardRow;
  players: number;
}

/**
 * Online: Hat dieses Gerät die heutige Elf schon gewertet gespielt? Liest die eigene Zeile
 * der Tageswertung – beim Öffnen (z. B. zweiter Tab) und erneut nach einem abgelehnten Start.
 */
function useTodayEntry(today: string, enabled: boolean, recheck: unknown): TodayEntry | null {
  const [entry, setEntry] = useState<TodayEntry | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchLeaderboard('daily', 'today', 1).then(
      (res) => {
        if (alive && res.mine && res.day === today) setEntry({ day: today, row: res.mine, players: res.players });
      },
      () => {
        /* ohne Antwort entscheidet der Server beim Start */
      },
    );
    return () => {
      alive = false;
    };
  }, [today, enabled, recheck]);
  return entry?.day === today ? entry : null;
}

/** Kopfzeile der Ergebnisansicht: welche Tägliche Elf, gewertet oder nicht, Countdown. */
function DailyBar({ day, ranking, children }: { day: string; ranking: RunRanking; children: ReactNode }) {
  const t = useT();
  const [mod, label] =
    ranking.status === 'ranked'
      ? ['ranked', t.daily.ranked]
      : ranking.status === 'offline'
        ? ['offline', t.daily.offlineUnranked]
        : ['offline', t.daily.unranked];
  return (
    <div className="daily-bar card">
      <div className="daily-bar__info">
        <span className="kicker">{formatDayLong(day, t)}</span>
        <p className="daily-bar__title">
          {t.game.challenge.daily} <span className="daily-no">#{dailyNumber(day)}</span>
          <span className={`runbadge runbadge--${mod} daily-bar__badge`}>{label}</span>
        </p>
      </div>
      <div className="daily-bar__side">{children}</div>
    </div>
  );
}

/** Zeile nur aus Ergebnis-Emojis – wird in der Vorschau passend zur Breite verkleinert. */
const EMOJI_LINE = /^[🟩🟨🟥]+$/u;

/** Teilen im „Wordle-Stil": Vorschau + Teilen-Knopf, eingebettet in die Saisonbilanz. */
function DailyShare({ day, run }: { day: string; run: ComputedRun }) {
  const t = useT();
  const toast = useToast();
  const titleId = useId();
  const { season, evaluation } = run;
  const text = useMemo(
    () =>
      buildDailyShareText(
        {
          day,
          number: dailyNumber(day),
          record: season.record,
          points: season.points,
          score: evaluation.score,
          position: season.position,
          outcomes: [...season.userMatches].sort((a, b) => a.round - b.round).map((m) => m.outcome),
          url: `${window.location.origin}${import.meta.env.BASE_URL}taeglich`,
          streak: dailyStreak(
            loadDailyHistory().map((d) => d.day),
            day,
          ).current,
        },
        t,
      ),
    [day, season, evaluation.score, t],
  );

  const onShare = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        // Abgebrochen: nichts tun. Sonst (z. B. nicht erlaubt): kopieren.
        if ((e as Error).name === 'AbortError') return;
      }
    }
    toast((await copyText(text)) ? t.daily.copied : t.daily.copyFailed);
  };

  return (
    <section className="daily-share" aria-labelledby={titleId}>
      <h2 id={titleId} className="daily-share__title">
        {t.daily.shareTitle(dailyNumber(day))}
      </h2>
      <pre className="daily-share__preview">
        {text.split('\n').map((line, i) => (
          <span key={i} className={`daily-share__line ${EMOJI_LINE.test(line) ? 'daily-share__line--emoji' : ''}`}>
            {line}
          </span>
        ))}
      </pre>
      <div className="actionbar daily-share__actions">
        <button type="button" className="btn btn--accent" onClick={() => void onShare()}>
          {t.daily.shareButton}
        </button>
        <Link className="btn" to={BOARD_LINK}>
          {t.daily.toBoard}
        </Link>
      </div>
    </section>
  );
}

/** Online schon gespielt: Versuch verbraucht – kein Übungsrun, nur Platzierung + Rangliste. */
function PlayedToday({ entry, message }: { entry: TodayEntry; message: string | null }) {
  const t = useT();
  const titleId = useId();
  const { row, players } = entry;
  return (
    <section className="card daily-done" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        {t.daily.playedTitle}
      </h2>
      {message && <RunNotice>{message}</RunNotice>}
      <p>{t.daily.playedText(dailyNumber(entry.day))}</p>
      <dl className="facts daily-done__facts">
        <div>
          <dt>{t.daily.factRank}</dt>
          <dd>
            {t.daily.rankValue(row.rank)}
            {/* Top n %: erst ab 10 Spielern aussagekräftig */}
            {players >= 10 && row.rank <= players && (
              <small className="daily-done__top"> {t.daily.topPercent(Math.max(1, Math.ceil((row.rank / players) * 100)))}</small>
            )}
          </dd>
        </div>
        <div>
          <dt>{t.daily.factRecord}</dt>
          <dd>{formatRecord(row.record)}</dd>
        </div>
        <div>
          <dt>{t.daily.factPoints}</dt>
          <dd>{row.points}</dd>
        </div>
        <div>
          <dt>{t.daily.factScore}</dt>
          <dd>{row.score}</dd>
        </div>
      </dl>
      <p className="muted small">
        {t.daily.playersToday(players)}
        {row.teamName ? t.daily.yourTeam(row.teamName) : ''}
      </p>
      <Link className="btn btn--primary btn--big daily-done__cta" to={BOARD_LINK}>
        {t.daily.toBoard}
      </Link>
    </section>
  );
}

/**
 * Tägliche Elf: jeden Tag dieselben Würfe für alle (Seed des Tages), ein Versuch pro Gerät
 * und Tag, Saison mit dem Seed des Tages – gleiche Elf, gleiches Ergebnis.
 * Run-Logik: useChallengeRun('daily'); diese Seite regelt nur Tageswechsel und Darstellung.
 */
export function Daily() {
  const t = useT();
  const { sprite } = useSettings();
  // Nur ein Versuch pro Tag: Antwortet der Server beim Start nicht, nicht still offline starten.
  const run = useChallengeRun('daily', { offlineFallback: 'ask' });
  const { phase, result, markRevealed, reset, clearError, canStartOffline } = run;
  const { today, nextAt } = useDailyClock();
  const firstCheck = useRef(true);
  const errorDay = useRef(today);

  // Ein Versuch pro Tag: Runs anderer Tage zurücksetzen – vor dem ersten Zeichnen.
  // Ein Run vom Vortag bleibt spielbar (zählt für seinen Starttag), siehe keepDailyRun.
  useLayoutEffect(() => {
    const initial = firstCheck.current;
    firstCheck.current = false;
    if (phase === 'setup') return;
    if (keepDailyRun({ phase, day: run.day, today, initial, revealing: result?.reveal === true })) return;
    reset();
  }, [phase, run.day, today, result?.reveal, reset]);

  // Neuer Tag: Fehler vom Vortag (z. B. „schon gespielt") gehören nicht zur neuen Elf.
  // „Server nicht erreichbar" samt Offline-Knopf gilt weiter und bleibt stehen.
  useLayoutEffect(() => {
    if (errorDay.current === today) return;
    errorDay.current = today;
    if (phase === 'setup' && !canStartOffline) clearError();
  }, [today, phase, canStartOffline, clearError]);

  // Ticker nur direkt nach dem Run – nach einem Reload kommt gleich die Bilanz.
  useEffect(() => {
    if (phase === 'result' && result?.reveal) markRevealed();
  }, [phase, result?.reveal, markRevealed]);

  const entry = useTodayEntry(today, run.apiOnline === true && phase === 'setup', run.error);

  const onFinish = async () => {
    if (await run.finish()) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (phase === 'result' && result) {
    const day = run.day ?? today;
    return (
      <div className="page daily">
        <DailyBar day={day} ranking={result.ranking}>
          {day === today ? (
            <Countdown nextAt={nextAt} />
          ) : (
            <p className="daily-new">
              <span>{t.daily.newDailyReady(dailyNumber(today))}</span>
              <button type="button" className="btn btn--primary btn--small" onClick={reset}>
                {t.daily.playNow}
              </button>
            </p>
          )}
        </DailyBar>
        <SeasonResultView
          challenge={result.challenge}
          input={result.input}
          scaleKind={MODE_RULES[result.challenge].scale}
          sprite={sprite}
          entryId={result.localEntryId}
          ranking={result.ranking}
          reveal={result.reveal}
          onNewRun={reset}
          newRunLabel={null}
          extra={(computed) => (
            <>
              <DailyShare day={day} run={computed} />
              <DailyStreak />
            </>
          )}
          stats={run.stats}
        />
      </div>
    );
  }

  const playing = phase === 'play' && run.engine != null;
  const day = playing ? (run.day ?? today) : today;

  return (
    <div className="page challenge daily">
      <header className="page-head daily-head">
        <div className="daily-head__main">
          <span className="kicker">{formatDayLong(day, t)}</span>
          <h1 className="page-title">
            {t.game.challenge.daily} <span className="daily-no">#{dailyNumber(day)}</span>
          </h1>
          <p className="page-lead">{t.daily.lead}</p>
        </div>
        {day === today ? (
          <Countdown nextAt={nextAt} />
        ) : (
          <div className="daily-new">
            <p>{t.daily.stillCountsFor(t.game.day(day))}</p>
            {phase === 'play' && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => window.confirm(t.daily.discardConfirm(t.game.day(day))) && reset()}
              >
                {t.daily.discardButton}
              </button>
            )}
          </div>
        )}
      </header>

      {playing && run.engine ? (
        <RunBoard
          state={run.engine}
          data={run.data}
          sprite={sprite}
          onReroll={run.reroll}
          onPlace={run.place}
          captain={run.captain}
          onCaptain={run.setCaptain}
          onFinish={() => void onFinish()}
          finishing={run.finishing}
          onFinishOffline={run.canFinishOffline ? () => void run.finish({ offline: true }) : undefined}
          statusExtra={<RunModeBadge online={run.online} />}
          notice={
            <>
              {run.namesNeeded && (
                <RunNamesPrompt
                  playerName={run.player}
                  teamName={run.setup.teamName}
                  onPlayerNameChange={run.setPlayer}
                  onTeamNameChange={run.setTeamName}
                  issues={run.issues}
                  disabled={run.finishing}
                />
              )}
              {run.notice && <RunNotice onClose={run.clearNotice}>{run.notice}</RunNotice>}
              {run.error && (
                <RunNotice error onClose={run.clearError}>
                  {run.error}
                </RunNotice>
              )}
            </>
          }
        />
      ) : (
        <div className="challenge__setup">
          <div>
            <HowItWorks>{t.daily.howTo}</HowItWorks>
            <StatCards stats={run.stats} showLast />
            <DailyStreak />
          </div>
          {entry ? (
            <PlayedToday entry={entry} message={run.error} />
          ) : (
            <RunSetup
              formation={run.setup.formation}
              ssEnabled={run.setup.ssEnabled}
              teamName={run.setup.teamName}
              onChange={run.setSetup}
              playerName={run.player}
              onPlayerNameChange={run.setPlayer}
              issues={run.issues}
              onStart={() => void run.start()}
              starting={run.starting}
              note={
                <>
                  {run.error && <RunNotice error>{run.error}</RunNotice>}
                  {run.canStartOffline && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      disabled={run.starting}
                      onClick={() => void run.start({ offline: true })}
                    >
                      {t.daily.playOffline}
                    </button>
                  )}
                  <DailyNetNote online={run.apiOnline} />
                  <p className="muted small">{t.daily.oneAttempt}</p>
                </>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
