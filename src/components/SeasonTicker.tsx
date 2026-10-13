import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useT, type Messages } from '../i18n';
import { formatRecord, type SeasonResult, type TableRow, type UserMatch } from '../lib/season';
import { scorerGroups, seasonTimeline, tickerStep, TOP_ROWS, type Matchday } from '../lib/seasonTimeline';
import type { Pokemon, SpriteStyle } from '../types';
import { Sprite } from './Sprite';
import '../styles/ticker.css';

interface Props {
  season: SeasonResult;
  teamName: string;
  sprite: SpriteStyle;
  byId: Map<number, Pokemon>;
  /** Ticker fertig oder übersprungen → Saisonbilanz zeigen */
  onDone: () => void;
}

type Speed = 1 | 2 | 4;

/** Dauer eines Spieltags bei 1× */
const STEP_MS = 700;
/** Wie lange der Abpfiff stehen bleibt, bevor es automatisch zur Bilanz geht */
const FINALE_MS = 1800;
const SPEEDS: Speed[] = [1, 2, 4];

/** Vorlesetext für einen Spieltag (aria-live). */
function describe(d: Matchday, tr: Messages['result'], opponent: string): string {
  const m = d.match;
  return tr.announceDay(
    d.round,
    tr.outcome[m.outcome],
    m.gf,
    m.ga,
    m.isHome,
    opponent,
    formatRecord(d.record),
    d.points,
    d.position,
  );
}

/**
 * Live-Ticker der Saison: Die 34 Spieltage laufen nacheinander ab (Anzeigetafel,
 * Bilanz, Platz mit Trend, Mini-Tabelle, 34–0-Tracker), danach kurzer Abpfiff.
 * Pause/Weiter, Tempo 1×/2×/4× und Überspringen; Leertaste pausiert, wenn der Ticker den Fokus hat.
 */
export function SeasonTicker({ season, teamName, sprite, byId, onDone }: Props) {
  const t = useT();
  const tr = t.result;
  const days = useMemo(() => seasonTimeline(season), [season]);
  const total = days.length;
  /** 0 = Anpfiff, k = Anzeigetafel des k-ten Spieltags, total + 1 = Abpfiff (siehe tickerStep) */
  const [step, setStep] = useState(0);
  const { played, finale, next } = tickerStep(step, total);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const rootRef = useRef<HTMLElement>(null);
  const onDoneRef = useRef(onDone);
  const doneRef = useRef(false);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  // Fokus in den Ticker, damit die Leertaste sofort pausiert
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (paused) return;
    // Jeder Spieltag – auch der letzte – steht STEP_MS / Tempo; der Abpfiff FINALE_MS, dann Bilanz.
    const id =
      next === 'done'
        ? window.setTimeout(finish, FINALE_MS)
        : window.setTimeout(() => setStep(next), STEP_MS / speed);
    return () => window.clearTimeout(id);
  }, [next, paused, speed, finish]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Nur auf dem Ticker selbst – Buttons behandeln die Leertaste selbst
    if (e.key !== ' ' || e.target !== e.currentTarget) return;
    e.preventDefault();
    setPaused((p) => !p);
  };

  /** Zuletzt gespielter Spieltag – im Abpfiff der letzte */
  const current = played > 0 ? days[played - 1] : null;
  const shownRound = current?.round ?? days[0]?.round ?? 1;
  const nameOf = (id: number) => {
    const p = byId.get(id);
    return p ? t.game.pokemon(p) : '?';
  };
  /** Gegner (intern deutscher Vereinsname) in der aktiven Sprache */
  const club = t.game.club;

  const announcement = finale
    ? tr.announceEnd(formatRecord(season.record), season.points, season.position)
    : current
      ? describe(current, tr, club(current.match.opponent))
      : tr.announceStart;

  /** Zustand für die CSS-Klasse (ticker__live--ende/pause/live) und seine Beschriftung */
  const state = finale ? 'ende' : paused ? 'pause' : 'live';
  const stateLabel = finale ? tr.stateEnd : paused ? tr.statePause : tr.stateLive;

  return (
    <section
      ref={rootRef}
      className={`ticker card ${paused ? 'is-paused' : ''}`}
      aria-labelledby="ticker-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="ticker__head">
        <div className="ticker__heading">
          <span className="kicker">
            <span className={`ticker__live ticker__live--${state}`}>{stateLabel}</span> {tr.ticker}
          </span>
          <h1 id="ticker-title" className="ticker__team">
            {teamName}
          </h1>
        </div>
        <div className="ticker__controls">
          <button type="button" className="btn btn--small" onClick={() => setPaused((p) => !p)}>
            {paused ? tr.resume : tr.pause}
          </button>
          <div className="segmented ticker__speed" role="radiogroup" aria-label={tr.speed}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={s === speed}
                className={`segmented__btn ${s === speed ? 'is-active' : ''}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--small btn--ghost" onClick={finish}>
            {tr.skip}
          </button>
        </div>
      </header>

      <div className="ticker__progress-row">
        <span className="ticker__round">
          {tr.matchday} <strong>{shownRound}</strong>/{total}
        </span>
        <div
          className="ticker__progress"
          role="progressbar"
          aria-label={tr.progressAria}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={played}
          aria-valuetext={tr.progressText(played, total)}
        >
          <span style={{ width: `${total ? (played / total) * 100 : 100}%` }} />
        </div>
      </div>

      <div className="ticker__grid">
        <div className="ticker__main">
          {finale ? (
            <Finale season={season} paused={paused} onContinue={finish} />
          ) : current ? (
            <Scoreboard key={current.round} match={current.match} teamName={teamName} sprite={sprite} byId={byId} nameOf={nameOf} />
          ) : (
            days[0] && <Scoreboard key="kickoff" match={days[0].match} teamName={teamName} sprite={sprite} byId={byId} nameOf={nameOf} upcoming />
          )}

          <dl className="facts ticker__facts">
            <div>
              <dt>{tr.record}</dt>
              <dd>{current ? formatRecord(current.record) : '0–0–0'}</dd>
            </div>
            <div>
              <dt>{tr.points}</dt>
              <dd>{current?.points ?? 0}</dd>
            </div>
            <div>
              <dt>{tr.place}</dt>
              <dd>
                {current ? tr.ordinal(current.position) : '–'}
                {current && <Trend delta={current.positionDelta} />}
              </dd>
            </div>
            <div>
              <dt>{tr.goals}</dt>
              <dd>
                {current?.goalsFor ?? 0}:{current?.goalsAgainst ?? 0}
              </dd>
            </div>
          </dl>

          <PerfectTracker day={current} total={total} />

          <ol className="ticker-dots" aria-hidden="true">
            {days.map((d, i) => (
              <li
                key={d.round}
                className={`ticker-dots__dot ${i < played ? `is-${d.match.outcome}` : ''} ${i === played - 1 ? 'is-latest' : ''}`}
                title={
                  i < played
                    ? tr.dotTitle(d.round, d.match.gf, d.match.ga, d.match.isHome, club(d.match.opponent))
                    : undefined
                }
              />
            ))}
          </ol>
        </div>

        <aside className="ticker__side" aria-label={tr.table}>
          <h2 className="section-title">{current ? tr.tableAfter(current.round) : tr.table}</h2>
          {current ? <MiniTable day={current} teamName={teamName} /> : <p className="muted small">{tr.noMatchYet}</p>}
        </aside>
      </div>

      <p className="ticker__hint muted small only-fine">{tr.spaceHint}</p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}

interface ScoreboardProps {
  match: UserMatch;
  teamName: string;
  sprite: SpriteStyle;
  byId: Map<number, Pokemon>;
  nameOf: (id: number) => string;
  /** Vor dem Anpfiff: Paarung ohne Ergebnis */
  upcoming?: boolean;
}

/** Große Anzeigetafel für das Spiel des eigenen Teams. */
function Scoreboard({ match, teamName, sprite, byId, nameOf, upcoming }: ScoreboardProps) {
  const t = useT();
  const tr = t.result;
  const userSide = (
    <span className="ticker-board__team is-user">
      <span className="ticker-board__name">{teamName}</span>
    </span>
  );
  const oppSide = (
    <span className="ticker-board__team">
      <span className="ticker-board__name">{t.game.club(match.opponent)}</span>
      <span className="ticker-board__rating">{tr.strength(match.opponentRating)}</span>
    </span>
  );
  const hg = match.isHome ? match.gf : match.ga;
  const ag = match.isHome ? match.ga : match.gf;
  const groups = upcoming ? [] : scorerGroups(match.scorers, nameOf);

  return (
    <article className={`ticker-board ${upcoming ? 'is-upcoming' : `ticker-board--${match.outcome}`}`}>
      <div className="ticker-board__bar">
        <span>{tr.boardRound(match.round)}</span>
        <span>{match.isHome ? tr.homeGame : tr.awayGame}</span>
      </div>
      <div className="ticker-board__match">
        {match.isHome ? userSide : oppSide}
        <span className="ticker-board__score">
          {upcoming ? (
            '–:–'
          ) : (
            <>
              <span>{hg}</span>
              <span className="ticker-board__colon">:</span>
              <span>{ag}</span>
            </>
          )}
        </span>
        {match.isHome ? oppSide : userSide}
      </div>
      <div className="ticker-board__foot">
        <span className={`ticker-board__outcome ${upcoming ? '' : `is-${match.outcome}`}`}>
          {upcoming ? tr.kickoff : tr.outcome[match.outcome]}
        </span>
        {groups.length > 0 && (
          <ul className="ticker-board__scorers">
            {groups.map((g) => {
              const p = byId.get(g.pokemonId);
              return (
                <li key={g.label}>
                  {p && <Sprite pokemon={p} style={sprite} className="ticker-board__sprite" loading="eager" />}
                  <span>
                    {g.label}
                    {g.goals > 1 && <strong> {g.goals}×</strong>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!upcoming && groups.length === 0 && match.gf === 0 && <span className="ticker-board__none">{tr.noOwnGoal}</span>}
      </div>
    </article>
  );
}

/** ▲/▼ neben dem Tabellenplatz. */
function Trend({ delta }: { delta: number }) {
  const t = useT();
  if (delta === 0) {
    return (
      <span className="ticker-trend ticker-trend--same">
        <span aria-hidden="true">=</span>
        <span className="sr-only">{t.result.unchanged}</span>
      </span>
    );
  }
  const up = delta > 0;
  const n = Math.abs(delta);
  return (
    <span className={`ticker-trend ticker-trend--${up ? 'up' : 'down'}`}>
      <span aria-hidden="true">
        {up ? '▲' : '▼'}
        {n}
      </span>
      <span className="sr-only">
        {' '}
        {t.result.trend(n, up)}
      </span>
    </span>
  );
}

/** Stand der 34–0-Jagd und laufende Serien. */
function PerfectTracker({ day, total }: { day: Matchday | null; total: number }) {
  const tr = useT().result;
  if (!day) {
    return <p className="ticker-perfect is-alive">{tr.perfectGoal(total)}</p>;
  }
  if (day.perfectAlive) {
    return <p className="ticker-perfect is-alive">{tr.perfectAlive(day.round === total, day.record.w, day.round)}</p>;
  }
  const streak =
    day.winStreak >= 3 ? tr.winStreak(day.winStreak) : day.unbeatenRun >= 3 ? tr.unbeatenRun(day.unbeatenRun) : null;
  return (
    <p className="ticker-perfect is-broken">
      {tr.perfectBroken(total, day.perfectBrokenAt ?? day.round)}
      {streak && <span className="ticker-perfect__streak">{streak}</span>}
    </p>
  );
}

/** Top 4 – und das eigene Team, falls es weiter hinten steht. */
function MiniTable({ day, teamName }: { day: Matchday; teamName: string }) {
  const t = useT();
  const col = t.result.col;
  const row = (r: TableRow, pos: number) => (
    <tr key={r.team} className={r.isUser ? 'is-user' : ''}>
      <td>{pos}</td>
      <td className="left ticker-table__name">{r.isUser ? teamName : t.game.club(r.name)}</td>
      <td>{r.played}</td>
      <td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
      <td>
        <strong>{r.pts}</strong>
      </td>
    </tr>
  );
  return (
    <div className="table-scroll">
      <table className="league-table ticker-table">
        <thead>
          <tr>
            <th scope="col">{col.place}</th>
            <th scope="col" className="left">
              {col.team}
            </th>
            <th scope="col" title={col.playedTitle}>
              {col.played}
            </th>
            <th scope="col" title={col.diffTitle}>
              {col.diff}
            </th>
            <th scope="col">{col.pts}</th>
          </tr>
        </thead>
        <tbody>
          {day.top.map((r, i) => row(r, i + 1))}
          {day.position > TOP_ROWS && (
            <>
              {day.position > TOP_ROWS + 1 && (
                <tr className="ticker-table__gap" aria-hidden="true">
                  <td colSpan={5}>…</td>
                </tr>
              )}
              {row(day.userRow, day.position)}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

interface FinaleProps {
  season: SeasonResult;
  paused: boolean;
  onContinue: () => void;
}

/** Abpfiff nach dem letzten Spieltag – geht nach kurzer Zeit automatisch weiter. */
function Finale({ season, paused, onContinue }: FinaleProps) {
  const tr = useT().result;
  return (
    <div className={`ticker-finale ${season.perfect ? 'is-perfect' : ''}`}>
      <span className="ticker-finale__kicker">{tr.fullTime}</span>
      <div className="ticker-finale__record">{formatRecord(season.record)}</div>
      <p className="ticker-finale__line">
        {tr.finaleLine(season.points, season.position)}
        {season.perfect ? tr.finalePerfect : season.position === 1 ? tr.finaleChampion : ''}
      </p>
      <button type="button" className="btn btn--primary" onClick={onContinue}>
        {tr.toSummary}
      </button>
      {!paused && (
        <span className="ticker-finale__timer" aria-hidden="true">
          <span style={{ animationDuration: `${FINALE_MS}ms` }} />
        </span>
      )}
    </div>
  );
}
