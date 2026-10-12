import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

const OUTCOME_WORD: Record<UserMatch['outcome'], string> = { S: 'Sieg', U: 'Remis', N: 'Niederlage' };

/** Vorlesetext für einen Spieltag (aria-live). */
function describe(d: Matchday): string {
  const m = d.match;
  const venue = m.isHome ? 'gegen' : 'bei';
  return `${d.round}. Spieltag: ${OUTCOME_WORD[m.outcome]} ${m.gf}:${m.ga} ${venue} ${m.opponent}. Bilanz ${formatRecord(d.record)}, ${d.points} Punkte, Platz ${d.position}.`;
}

/**
 * Live-Ticker der Saison: Die 34 Spieltage laufen nacheinander ab (Anzeigetafel,
 * Bilanz, Platz mit Trend, Mini-Tabelle, 34–0-Tracker), danach kurzer Abpfiff.
 * Pause/Weiter, Tempo 1×/2×/4× und Überspringen; Leertaste pausiert, wenn der Ticker den Fokus hat.
 */
export function SeasonTicker({ season, teamName, sprite, byId, onDone }: Props) {
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
  const nameOf = (id: number) => byId.get(id)?.de ?? '?';

  const announcement = finale
    ? `Abpfiff! Saisonbilanz ${formatRecord(season.record)}, ${season.points} Punkte, Platz ${season.position}.`
    : current
      ? describe(current)
      : 'Anpfiff! Die Saison beginnt.';

  const state = finale ? 'Ende' : paused ? 'Pause' : 'Live';

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
            <span className={`ticker__live ticker__live--${state.toLowerCase()}`}>{state}</span> Saison-Ticker
          </span>
          <h1 id="ticker-title" className="ticker__team">
            {teamName}
          </h1>
        </div>
        <div className="ticker__controls">
          <button type="button" className="btn btn--small" onClick={() => setPaused((p) => !p)}>
            {paused ? 'Weiter' : 'Pause'}
          </button>
          <div className="segmented ticker__speed" role="radiogroup" aria-label="Tempo">
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
            Überspringen
          </button>
        </div>
      </header>

      <div className="ticker__progress-row">
        <span className="ticker__round">
          Spieltag <strong>{shownRound}</strong>/{total}
        </span>
        <div
          className="ticker__progress"
          role="progressbar"
          aria-label="Saisonfortschritt"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={played}
          aria-valuetext={`${played} von ${total} Spieltagen gespielt`}
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
              <dt>Bilanz</dt>
              <dd>{current ? formatRecord(current.record) : '0–0–0'}</dd>
            </div>
            <div>
              <dt>Punkte</dt>
              <dd>{current?.points ?? 0}</dd>
            </div>
            <div>
              <dt>Platz</dt>
              <dd>
                {current ? `${current.position}.` : '–'}
                {current && <Trend delta={current.positionDelta} />}
              </dd>
            </div>
            <div>
              <dt>Tore</dt>
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
                title={i < played ?`${d.round}. Spieltag: ${d.match.gf}:${d.match.ga} ${d.match.isHome ? 'gegen' : 'bei'} ${d.match.opponent}` : undefined}
              />
            ))}
          </ol>
        </div>

        <aside className="ticker__side" aria-label="Tabelle">
          <h2 className="section-title">Tabelle{current ? ` nach dem ${current.round}. Spieltag` : ''}</h2>
          {current ? <MiniTable day={current} /> : <p className="muted small">Noch kein Spiel absolviert.</p>}
        </aside>
      </div>

      <p className="ticker__hint muted small only-fine">Leertaste: Pause / Weiter</p>
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
  const userSide = (
    <span className="ticker-board__team is-user">
      <span className="ticker-board__name">{teamName}</span>
    </span>
  );
  const oppSide = (
    <span className="ticker-board__team">
      <span className="ticker-board__name">{match.opponent}</span>
      <span className="ticker-board__rating">Stärke {match.opponentRating}</span>
    </span>
  );
  const hg = match.isHome ? match.gf : match.ga;
  const ag = match.isHome ? match.ga : match.gf;
  const groups = upcoming ? [] : scorerGroups(match.scorers, nameOf);

  return (
    <article className={`ticker-board ${upcoming ? 'is-upcoming' : `ticker-board--${match.outcome}`}`}>
      <div className="ticker-board__bar">
        <span>{match.round}. Spieltag</span>
        <span>{match.isHome ? 'Heimspiel' : 'Auswärtsspiel'}</span>
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
          {upcoming ? 'Anpfiff' : OUTCOME_WORD[match.outcome]}
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
        {!upcoming && groups.length === 0 && match.gf === 0 && <span className="ticker-board__none">Ohne eigenen Treffer</span>}
      </div>
    </article>
  );
}

/** ▲/▼ neben dem Tabellenplatz. */
function Trend({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="ticker-trend ticker-trend--same">
        <span aria-hidden="true">=</span>
        <span className="sr-only"> (unverändert)</span>
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
        ({n} {n === 1 ? 'Platz' : 'Plätze'} {up ? 'geklettert' : 'abgerutscht'})
      </span>
    </span>
  );
}

/** Stand der 34–0-Jagd und laufende Serien. */
function PerfectTracker({ day, total }: { day: Matchday | null; total: number }) {
  if (!day) {
    return <p className="ticker-perfect is-alive">Ziel: {total}–0 – jedes Spiel gewinnen</p>;
  }
  if (day.perfectAlive) {
    return (
      <p className="ticker-perfect is-alive">
        {day.round === total ? 'Perfekt' : 'Noch perfekt'}: {day.record.w}/{day.round} Siege
      </p>
    );
  }
  const streak =
    day.winStreak >= 3
      ? `${day.winStreak} Siege in Folge`
      : day.unbeatenRun >= 3
        ? `${day.unbeatenRun} Spiele ungeschlagen`
        : null;
  return (
    <p className="ticker-perfect is-broken">
      {total}–0 geplatzt am {day.perfectBrokenAt}. Spieltag
      {streak && <span className="ticker-perfect__streak">{streak}</span>}
    </p>
  );
}

/** Top 4 – und das eigene Team, falls es weiter hinten steht. */
function MiniTable({ day }: { day: Matchday }) {
  const row = (r: TableRow, pos: number) => (
    <tr key={r.team} className={r.isUser ? 'is-user' : ''}>
      <td>{pos}</td>
      <td className="left ticker-table__name">{r.name}</td>
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
            <th scope="col">Pl.</th>
            <th scope="col" className="left">
              Team
            </th>
            <th scope="col" title="Spiele">
              Sp
            </th>
            <th scope="col" title="Tordifferenz">
              Diff
            </th>
            <th scope="col">Pkt</th>
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
  return (
    <div className={`ticker-finale ${season.perfect ? 'is-perfect' : ''}`}>
      <span className="ticker-finale__kicker">Abpfiff!</span>
      <div className="ticker-finale__record">{formatRecord(season.record)}</div>
      <p className="ticker-finale__line">
        {season.points} Punkte · Platz {season.position}
        {season.perfect ? ' · Perfekte Saison!' : season.position === 1 ? ' · Meister!' : ''}
      </p>
      <button type="button" className="btn btn--primary" onClick={onContinue}>
        Zur Saisonbilanz
      </button>
      {!paused && (
        <span className="ticker-finale__timer" aria-hidden="true">
          <span style={{ animationDuration: `${FINALE_MS}ms` }} />
        </span>
      )}
    </div>
  );
}
