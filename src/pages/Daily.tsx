import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HowItWorks, RunSetup, StatCards } from '../components/ChallengeParts';
import { RunBoard, RunModeBadge, RunNotice } from '../components/RunBoard';
import { SeasonResultView } from '../components/SeasonResultView';
import { fetchLeaderboard } from '../lib/api/client';
import type { LeaderboardRow } from '../lib/api/contract';
import { MODE_RULES } from '../lib/challengeEngine';
import { dailyNumber, dayKey, formatDay, msUntilNextDay } from '../lib/daily';
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

const HOW_TO =
  'Jeden Tag dieselben Würfe für alle: Region und Typ werden pro Runde gewürfelt – wie bei der 34–0 Challenge, mit höchstens 2 Legendären und je einem Reroll für Typ und Region. Du hast einen Versuch pro Tag. Gleiche Elf, gleiches Ergebnis – die Saison ist für alle identisch. Schaffst du 34–0?';

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
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="daily-countdown">
      <span className="daily-countdown__label">Neue Elf in</span>
      <span className="daily-countdown__time" role="timer">
        {formatCountdown(nextAt - now)}
      </span>
    </p>
  );
}

/** Online-Status im Setup – offline klar als „nicht gewertet" markiert. */
function DailyNetNote({ online }: { online: boolean | null }) {
  const [mod, text] =
    online == null
      ? ['checking', 'Verbindung wird geprüft …']
      : online
        ? ['online', 'Online – dein Versuch kommt in die Tagesrangliste']
        : ['offline', 'Offline – nicht gewertet. Auch offline gibt es nur einen Versuch pro Tag.'];
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
  const [mod, label] =
    ranking.status === 'ranked'
      ? ['ranked', 'Gewertet']
      : ranking.status === 'offline'
        ? ['offline', 'Offline – nicht gewertet']
        : ['offline', 'Nicht gewertet'];
  return (
    <div className="daily-bar card">
      <div className="daily-bar__info">
        <span className="kicker">{formatDayLong(day)}</span>
        <p className="daily-bar__title">
          Tägliche Elf <span className="daily-no">#{dailyNumber(day)}</span>
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
  const toast = useToast();
  const titleId = useId();
  const { season, evaluation } = run;
  const text = useMemo(
    () =>
      buildDailyShareText({
        day,
        number: dailyNumber(day),
        record: season.record,
        points: season.points,
        score: evaluation.score,
        position: season.position,
        outcomes: [...season.userMatches].sort((a, b) => a.round - b.round).map((m) => m.outcome),
        url: `${window.location.origin}${import.meta.env.BASE_URL}taeglich`,
      }),
    [day, season, evaluation.score],
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
    toast((await copyText(text)) ? 'Ergebnis kopiert' : 'Kopieren nicht möglich');
  };

  return (
    <section className="daily-share" aria-labelledby={titleId}>
      <h2 id={titleId} className="daily-share__title">
        Tägliche Elf #{dailyNumber(day)} teilen
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
          Ergebnis teilen
        </button>
        <Link className="btn" to={BOARD_LINK}>
          Zur Tagesrangliste
        </Link>
      </div>
    </section>
  );
}

/** Online schon gespielt: Versuch verbraucht – kein Übungsrun, nur Platzierung + Rangliste. */
function PlayedToday({ entry, message }: { entry: TodayEntry; message: string | null }) {
  const titleId = useId();
  const { row, players } = entry;
  return (
    <section className="card daily-done" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        Heute schon gespielt
      </h2>
      {message && <RunNotice>{message}</RunNotice>}
      <p>
        Dein gewerteter Versuch für die Tägliche Elf #{dailyNumber(entry.day)} ist verbraucht. Morgen gibt es neue
        Würfe – wieder für alle dieselben.
      </p>
      <dl className="facts daily-done__facts">
        <div>
          <dt>Platz</dt>
          <dd>{row.rank}.</dd>
        </div>
        <div>
          <dt>Bilanz</dt>
          <dd>{formatRecord(row.record)}</dd>
        </div>
        <div>
          <dt>Punkte</dt>
          <dd>{row.points}</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>{row.score}</dd>
        </div>
      </dl>
      <p className="muted small">
        {players.toLocaleString('de-DE')} Spieler heute{row.teamName ? ` · dein Team: ${row.teamName}` : ''}
      </p>
      <Link className="btn btn--primary btn--big daily-done__cta" to={BOARD_LINK}>
        Zur Tagesrangliste
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
              <span>Die neue Tägliche Elf #{dailyNumber(today)} ist da!</span>
              <button type="button" className="btn btn--primary btn--small" onClick={reset}>
                Jetzt spielen
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
          extra={(computed) => <DailyShare day={day} run={computed} />}
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
          <span className="kicker">{formatDayLong(day)}</span>
          <h1 className="page-title">
            Tägliche Elf <span className="daily-no">#{dailyNumber(day)}</span>
          </h1>
          <p className="page-lead">Jeden Tag eine neue Elf – dieselben Würfe für alle.</p>
        </div>
        {day === today ? (
          <Countdown nextAt={nextAt} />
        ) : (
          <div className="daily-new">
            <p>Die neue Elf ist schon da – dieser Run zählt noch für den {formatDay(day)}.</p>
            {phase === 'play' && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() =>
                  window.confirm(`Den Run vom ${formatDay(day)} verwerfen? Er wird dann nicht mehr gewertet.`) && reset()
                }
              >
                Verwerfen und heutige Elf spielen
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
          onFinish={() => void onFinish()}
          finishing={run.finishing}
          onFinishOffline={run.canFinishOffline ? () => void run.finish({ offline: true }) : undefined}
          statusExtra={<RunModeBadge online={run.online} />}
          notice={
            <>
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
            <HowItWorks>{HOW_TO}</HowItWorks>
            <StatCards stats={run.stats} />
          </div>
          {entry ? (
            <PlayedToday entry={entry} message={run.error} />
          ) : (
            <RunSetup
              formation={run.setup.formation}
              ssEnabled={run.setup.ssEnabled}
              teamName={run.setup.teamName}
              onChange={run.setSetup}
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
                      Offline spielen (ohne Wertung – zählt als Tagesversuch)
                    </button>
                  )}
                  <DailyNetNote online={run.apiOnline} />
                  <p className="muted small">
                    Ein Versuch pro Tag: Ein gestarteter Run lässt sich nicht abbrechen oder neu starten.
                  </p>
                </>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
