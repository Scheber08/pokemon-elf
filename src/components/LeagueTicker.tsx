import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  currentMatchday,
  leagueTimeline,
  matchFor,
  seasonFinishAt,
  secondsToKickoff,
  titleRace,
  titleTieNote,
  type Matchday,
} from '../lib/leagueTimeline';
import { buildTable, type LeagueResult, type Match, type TableRow } from '../lib/season';
import { scorerSummary } from '../lib/seasonTimeline';
import { usePokemonData } from '../state/PokemonData';
import '../styles/league.css';

interface Props {
  league: LeagueResult;
  /** Anzeigenamen in der Reihenfolge von league.teams */
  teamNames: string[];
  /** Team des Betrachters (Index in league.teams) oder null = Zuschauer */
  highlight: number | null;
  /** Serverzeit (ms) des ersten Spieltags */
  startsAt: number;
  /** Dauer eines Spieltags (ms) */
  stepMs: number;
  /** Serverzeit − Gerätezeit (ms) aus dem Uhrenabgleich */
  clockOffset: number;
  /** Ticker vorbei oder übersprungen → Ergebnis zeigen */
  onDone: () => void;
}

/** Wie oft die Uhr neu ausgewertet wird */
const TICK_MS = 250;

const OUTCOME_WORD = { S: 'Sieg', U: 'Remis', N: 'Niederlage' } as const;

/** „Anpfiff in 3 …" – ab einer Minute als m:ss */
function formatCountdown(secs: number): string {
  if (secs < 60) return String(secs);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/**
 * Gemeinsamer Saison-Ticker des Online-Drafts: Alle Clients rechnen aus Startzeit,
 * Spieltagsdauer und abgeglichener Uhr denselben Spieltag aus und zeigen ihn – wer
 * später kommt, springt direkt an die richtige Stelle. Vor dem Anpfiff Countdown, je
 * Spieltag alle Spiele mit Torschützen und die Tabelle mit Trend, am Ende kurz Abpfiff
 * (bei Punktgleichheit an der Spitze mit der Titelentscheidung), dann onDone (genau
 * einmal). „Überspringen" wirkt nur lokal.
 */
export function LeagueTicker({ league, teamNames, highlight, startsAt, stepMs, clockOffset, onDone }: Props) {
  const { byId } = usePokemonData();
  const days = useMemo(() => leagueTimeline(league), [league]);
  const startTable = useMemo(() => buildTable(league.teams, []), [league]);
  const total = days.length;
  const finishAt = seasonFinishAt(startsAt, stepMs, total);
  const you = highlight != null && highlight >= 0 && highlight < league.teams.length ? highlight : null;

  const clock = () => Date.now() + clockOffset;
  const [md, setMd] = useState(() => currentMatchday(startsAt, stepMs, clock(), total));
  const [secs, setSecs] = useState(() => secondsToKickoff(startsAt, clock()));
  /** Restdauer des Abpfiffs beim Erreichen des letzten Spieltags (für den Balken) */
  const [finaleMs, setFinaleMs] = useState<number | null>(null);

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

  useEffect(() => {
    const tick = () => {
      const now = Date.now() + clockOffset;
      const current = currentMatchday(startsAt, stepMs, now, total);
      setMd(current);
      setSecs(secondsToKickoff(startsAt, now));
      if (total > 0 && current === total) setFinaleMs((v) => v ?? Math.max(0, finishAt - now));
      // Gleicher Zeitpunkt für alle – wer nach dem Abpfiff kommt, geht direkt zum Ergebnis
      if (now >= finishAt) finish();
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [startsAt, stepMs, clockOffset, total, finishAt, finish]);

  const nameOf = useCallback(
    (t: number) => teamNames[t] || league.teams[t]?.name || `Team ${t + 1}`,
    [teamNames, league.teams],
  );
  const pokemonName = useCallback((id: number) => byId.get(id)?.de ?? `#${id}`, [byId]);

  const day: Matchday | null = md > 0 ? days[md - 1] ?? null : null;
  const finale = total > 0 && md === total;
  const table = day?.table ?? startTable;
  const ownRow = you != null ? table.find((r) => r.team === you) ?? null : null;
  const ownPlace = ownRow ? table.indexOf(ownRow) + 1 : null;
  /** Nur am Saisonende: wie der Titel bei Punktgleichheit entschieden wurde */
  const tieNote = finale && day ? titleTieNote(titleRace(day.table), nameOf) : null;

  const announcement = useMemo(() => {
    if (!day) return 'Die gemeinsame Saison beginnt gleich.';
    const parts: string[] = [];
    if (finale) parts.push('Abpfiff!');
    parts.push(`${day.round}. Spieltag:`);
    if (you != null) {
      const r = matchFor(day.matches, you);
      parts.push(
        r
          ? `${OUTCOME_WORD[r.outcome]} ${r.gf}:${r.ga} ${r.isHome ? 'gegen' : 'bei'} ${nameOf(r.opponent)}, Platz ${day.places[you]}.`
          : `Dein Team ist spielfrei, Platz ${day.places[you]}.`,
      );
    }
    parts.push(
      finale
        ? `Meister: ${nameOf(day.leader.team)} mit ${day.leader.pts} Punkten.`
        : `Tabellenführer: ${nameOf(day.leader.team)} mit ${day.leader.pts} Punkten.`,
    );
    if (tieNote) parts.push(`${tieNote}.`);
    return parts.join(' ');
  }, [day, finale, you, nameOf, tieNote]);

  const status = finale ? 'ende' : day ? 'live' : 'gleich';
  const statusLabel = finale ? 'Ende' : day ? 'Live' : 'Gleich';

  return (
    <section className="league-ticker card" aria-labelledby="league-ticker-title">
      <header className="league-ticker__head">
        <div className="league-ticker__heading">
          <span className="kicker">
            <span className={`league-ticker__live league-ticker__live--${status}`}>{statusLabel}</span> Gemeinsame Saison
          </span>
          <h2 id="league-ticker-title" className="league-ticker__title">
            {you != null ? nameOf(you) : 'Saison-Ticker'}
          </h2>
        </div>
        <button
          type="button"
          className={`btn btn--small ${finale ? 'btn--primary' : 'btn--ghost'}`}
          onClick={finish}
        >
          {finale ? 'Zum Ergebnis' : 'Überspringen'}
        </button>
      </header>

      <div className="league-ticker__progress-row">
        <span className="league-ticker__round">
          Spieltag <strong>{md > 0 ? md : '–'}</strong>/{total}
        </span>
        <div
          className="league-ticker__progress"
          role="progressbar"
          aria-label="Saisonfortschritt"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={md}
          aria-valuetext={`Spieltag ${md} von ${total}`}
        >
          <span style={{ width: `${total ? (md / total) * 100 : 0}%` }} />
        </div>
      </div>

      {ownRow && ownPlace != null && (
        <dl className="facts league-ticker__facts">
          <div>
            <dt>Platz</dt>
            <dd>
              {day ? `${ownPlace}.` : '–'}
              {day && <Trend delta={day.delta[ownRow.team]} />}
            </dd>
          </div>
          <div>
            <dt>Punkte</dt>
            <dd>{ownRow.pts}</dd>
          </div>
          <div>
            <dt>Bilanz</dt>
            <dd>
              {ownRow.w}–{ownRow.d}–{ownRow.l}
            </dd>
          </div>
          <div>
            <dt>Tore</dt>
            <dd>
              {ownRow.gf}:{ownRow.ga}
            </dd>
          </div>
        </dl>
      )}

      <div className="league-ticker__grid">
        <div className="league-ticker__main">
          {finale && day && (
            <div className="league-finale">
              <span className="league-finale__kicker">Abpfiff!</span>
              <p className="league-finale__line">
                Meister: <strong>{nameOf(day.leader.team)}</strong> · {day.leader.pts} Pkt
              </p>
              {tieNote && <p className="league-finale__tie">{tieNote}</p>}
              {you != null && ownPlace != null && (
                <p className="league-finale__you">
                  {ownPlace === 1 ? 'Dein Team ist Meister!' : `Dein Team: Platz ${ownPlace}`}
                </p>
              )}
              {finaleMs != null && finaleMs > 0 && (
                <span className="league-finale__timer" aria-hidden="true">
                  <span style={{ animationDuration: `${finaleMs}ms` }} />
                </span>
              )}
            </div>
          )}

          {day ? (
            <section key={day.round} className="league-board" aria-label={`${day.round}. Spieltag`}>
              <div className="league-board__bar">
                <span>{day.round}. Spieltag</span>
                <span>{finale ? 'Endstand' : 'Ergebnisse'}</span>
              </div>
              <FixtureList
                matches={day.matches}
                you={you}
                nameOf={nameOf}
                pokemonName={pokemonName}
              />
              {day.byes.length > 0 && (
                <p className="league-board__byes">Spielfrei: {day.byes.map(nameOf).join(', ')}</p>
              )}
            </section>
          ) : (
            <section className="league-board league-board--upcoming" aria-label="Anpfiff">
              <div className="league-countdown" role="timer" aria-live="off">
                <span className="league-countdown__label">{secs > 0 ? 'Anpfiff in' : 'Anpfiff!'}</span>
                {secs > 0 && (
                  <span key={secs} className="league-countdown__num">
                    {formatCountdown(secs)} …
                  </span>
                )}
              </div>
              {days[0] && (
                <>
                  <div className="league-board__bar">
                    <span>1. Spieltag</span>
                    <span>Paarungen</span>
                  </div>
                  <FixtureList matches={days[0].matches} you={you} nameOf={nameOf} pokemonName={pokemonName} upcoming />
                  {days[0].byes.length > 0 && (
                    <p className="league-board__byes">Spielfrei: {days[0].byes.map(nameOf).join(', ')}</p>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        <aside className="league-ticker__side" aria-label="Tabelle">
          <h3 className="section-title">{day ? `Tabelle nach dem ${day.round}. Spieltag` : 'Tabelle'}</h3>
          <LiveTable table={table} day={day} you={you} nameOf={nameOf} />
        </aside>
      </div>

      <p className="league-ticker__note muted small">
        Alle sehen dieselbe Saison gleichzeitig. Überspringen gilt nur für dich.
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}

interface FixtureListProps {
  matches: Match[];
  you: number | null;
  nameOf: (team: number) => string;
  pokemonName: (id: number) => string;
  /** Vor dem Anpfiff: Paarungen ohne Ergebnis */
  upcoming?: boolean;
  className?: string;
}

/** Alle Spiele eines Spieltags – das eigene zuerst und hervorgehoben. */
export function FixtureList({ matches, you, nameOf, pokemonName, upcoming, className = '' }: FixtureListProps) {
  const sorted = you == null ? matches : [...matches].sort((a, b) => Number(isOwn(b, you)) - Number(isOwn(a, you)));
  return (
    <ol className={`league-fixtures ${className}`}>
      {sorted.map((m) => {
        const own = you != null && isOwn(m, you);
        const result = you != null && own && !upcoming ? matchFor([m], you) : null;
        const home = scorerSummary(m.homeScorers, pokemonName);
        const away = scorerSummary(m.awayScorers, pokemonName);
        return (
          <li
            key={`${m.round}-${m.home}-${m.away}`}
            className={`league-fixture ${own ? 'is-own' : ''} ${result ? `is-${result.outcome}` : ''}`}
          >
            <div className="league-fixture__row">
              <span className={`league-fixture__team league-fixture__team--home ${m.home === you ? 'is-you' : ''}`}>
                {nameOf(m.home)}
              </span>
              <span className="league-fixture__score" aria-label={upcoming ? 'noch offen' : `${m.hg} zu ${m.ag}`}>
                {upcoming ? '–:–' : `${m.hg}:${m.ag}`}
              </span>
              <span className={`league-fixture__team league-fixture__team--away ${m.away === you ? 'is-you' : ''}`}>
                {nameOf(m.away)}
              </span>
            </div>
            {!upcoming && (home || away || result) && (
              <div className="league-fixture__foot">
                <span className="league-fixture__scorers league-fixture__scorers--home">{home}</span>
                <span className="league-fixture__mid">
                  {result && (
                    <span className={`league-fixture__outcome is-${result.outcome}`}>{OUTCOME_WORD[result.outcome]}</span>
                  )}
                </span>
                <span className="league-fixture__scorers league-fixture__scorers--away">{away}</span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function isOwn(m: Match, team: number): boolean {
  return m.home === team || m.away === team;
}

/** ▲/▼ – Platzveränderung gegenüber dem Vorspieltag. */
function Trend({ delta }: { delta: number }) {
  if (!delta) {
    return (
      <span className="league-trend league-trend--same">
        <span aria-hidden="true">–</span>
        <span className="sr-only"> (unverändert)</span>
      </span>
    );
  }
  const up = delta > 0;
  const n = Math.abs(delta);
  return (
    <span className={`league-trend league-trend--${up ? 'up' : 'down'}`}>
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

interface LiveTableProps {
  table: TableRow[];
  day: Matchday | null;
  you: number | null;
  nameOf: (team: number) => string;
}

/** Komplette Tabelle nach dem Spieltag (höchstens 8 Teams) mit Trendpfeilen. */
function LiveTable({ table, day, you, nameOf }: LiveTableProps) {
  return (
    <div className="table-scroll">
      <table className="league-table league-live">
        <thead>
          <tr>
            <th scope="col" title="Platz">
              Pl.
            </th>
            <th scope="col" className="left">
              Team
            </th>
            <th scope="col" title="Spiele">
              Sp
            </th>
            <th scope="col" title="Siege">
              S
            </th>
            <th scope="col" title="Unentschieden">
              U
            </th>
            <th scope="col" title="Niederlagen">
              N
            </th>
            <th scope="col">Tore</th>
            <th scope="col" title="Tordifferenz">
              Diff
            </th>
            <th scope="col" title="Punkte">
              Pkt
            </th>
          </tr>
        </thead>
        <tbody>
          {table.map((r, i) => (
            <tr key={r.team} className={r.team === you ? 'is-user' : ''}>
              <td className="league-live__place">
                {day ? i + 1 : '–'}
                {day && <Trend delta={day.delta[r.team]} />}
              </td>
              <td className="left league-live__name">{nameOf(r.team)}</td>
              <td>{r.played}</td>
              <td>{r.w}</td>
              <td>{r.d}</td>
              <td>{r.l}</td>
              <td>
                {r.gf}:{r.ga}
              </td>
              <td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
              <td>
                <strong>{r.pts}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
