import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import {
  currentMatchday,
  leagueTimeline,
  matchFor,
  recentForm,
  seasonFinishAt,
  secondsToKickoff,
  titleRace,
  titleTieNote,
  topScorers,
  type Matchday,
} from '../lib/leagueTimeline';
import { cupPens, cupStageOf, cupStatus, cupWinner, type CupInfo } from '../lib/cup';
import { buildTable, type LeagueResult, type Match, type TableRow } from '../lib/season';
import { scorerSummary } from '../lib/seasonTimeline';
import { usePokemonData } from '../state/PokemonData';
import { CupBracket, CupGroups, cupStatusText } from './CupBracket';
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
  /** Vor dem Anpfiff zusätzlich angezeigt (z. B. die fertigen Kader) */
  preKickoff?: ReactNode;
  /** Ticker vorbei oder übersprungen → Ergebnis zeigen */
  onDone: () => void;
}

/** So viele Torjäger zeigt der Ticker */
const LIVE_SCORERS = 5;

/** Wie oft die Uhr neu ausgewertet wird */
const TICK_MS = 250;

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
export function LeagueTicker({ league, teamNames, highlight, startsAt, stepMs, clockOffset, onDone, preKickoff }: Props) {
  const t = useT();
  const tx = t.draft.ticker;
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

  // Vereinsnamen (CPU-Teams) erst bei der Anzeige übersetzen – gespeichert bleibt der deutsche Name
  const nameOf = useCallback(
    (i: number) => teamNames[i] || (league.teams[i]?.name ? t.game.club(league.teams[i].name) : `Team ${i + 1}`),
    [teamNames, league.teams, t],
  );
  const pokemonName = useCallback(
    (id: number) => {
      const p = byId.get(id);
      return p ? t.game.pokemon(p) : `#${id}`;
    },
    [byId, t],
  );

  const day: Matchday | null = md > 0 ? days[md - 1] ?? null : null;
  const finale = total > 0 && md === total;
  const table = day?.table ?? startTable;
  const ownRow = you != null ? table.find((r) => r.team === you) ?? null : null;
  const ownPlace = ownRow ? table.indexOf(ownRow) + 1 : null;
  /** KO-Turnier: Baum, Sieger, Status des eigenen Teams bis zum aktuellen Spieltag */
  const cup: CupInfo | null = league.cup ?? null;
  const winner = cup ? cupWinner(cup) : null;
  const ownStatus = cup && you != null ? cupStatus(cup, you, md) : null;
  /** Spieltag bzw. (Turnier) Rundenname */
  const dayLabel = (round: number) => {
    const stage = cup ? cupStageOf(cup, round) : null;
    if (stage === 'group') return `${t.draft.cup.stage.group} · ${t.draft.matchday(round)}`;
    return stage ? t.draft.cup.stage[stage] : t.draft.matchday(round);
  };
  /** Gruppenphase läuft (oder steht bevor) → Gruppentabellen statt Baum */
  const groupsPhase = !!cup?.groups && (!day || cupStageOf(cup, day.round) === 'group');
  const pensOf = useCallback((m: Match) => (cup ? cupPens(cup, m) : null), [cup]);
  /** Torjäger bis zum aktuellen Spieltag (Top 5) */
  const scorers = useMemo(
    () => (md > 0 ? topScorers({ ...league, matches: league.matches.filter((m) => m.round <= md) }).slice(0, LIVE_SCORERS) : []),
    [league, md],
  );
  /** Nur am Saisonende: wie der Titel bei Punktgleichheit entschieden wurde (nicht im Turnier) */
  const tieNote = finale && day && !cup ? titleTieNote(titleRace(day.table), nameOf) : null;

  const announcement = useMemo(() => {
    if (!day) return tx.startsSoon;
    const parts: string[] = [];
    if (finale) parts.push(tx.fullTime);
    if (cup) {
      parts.push(`${dayLabel(day.round)}:`);
      const r = you != null ? matchFor(day.matches, you) : null;
      if (r) parts.push(t.draft.cup.result(t.draft.outcome[r.outcome], r.gf, r.ga, r.isHome, nameOf(r.opponent)));
      if (ownStatus) parts.push(`${cupStatusText(t, ownStatus)}.`);
      if (finale && winner != null) parts.push(`${t.draft.cup.winnerLabel}${nameOf(winner)}.`);
      return parts.join(' ');
    }
    parts.push(tx.matchdayColon(day.round));
    if (you != null) {
      const r = matchFor(day.matches, you);
      parts.push(
        r
          ? tx.result(t.draft.outcome[r.outcome], r.gf, r.ga, r.isHome, nameOf(r.opponent), day.places[you])
          : tx.bye(day.places[you]),
      );
    }
    parts.push(
      finale
        ? tx.championLine(nameOf(day.leader.team), day.leader.pts)
        : tx.leaderLine(nameOf(day.leader.team), day.leader.pts),
    );
    if (tieNote) parts.push(`${tieNote}.`);
    return parts.join(' ');
    // dayLabel hängt nur von cup und t ab
  }, [day, finale, you, nameOf, tieNote, t, tx, cup, ownStatus, winner]);

  const status = finale ? 'ende' : day ? 'live' : 'gleich';
  const statusLabel = finale ? tx.statusEnd : day ? tx.statusLive : tx.statusSoon;

  return (
    <section className="league-ticker card" aria-labelledby="league-ticker-title">
      <header className="league-ticker__head">
        <div className="league-ticker__heading">
          <span className="kicker">
            <span className={`league-ticker__live league-ticker__live--${status}`}>{statusLabel}</span> {tx.sharedSeason}
          </span>
          <h2 id="league-ticker-title" className="league-ticker__title">
            {you != null ? nameOf(you) : tx.title}
          </h2>
        </div>
        <button
          type="button"
          className={`btn btn--small ${finale ? 'btn--primary' : 'btn--ghost'}`}
          onClick={finish}
        >
          {finale ? tx.toResult : tx.skip}
        </button>
      </header>

      <div className="league-ticker__progress-row">
        <span className="league-ticker__round">
          {cup ? t.draft.cup.roundLabel : tx.matchdayLabel} <strong>{md > 0 ? md : '–'}</strong>/{total}
        </span>
        <div
          className="league-ticker__progress"
          role="progressbar"
          aria-label={tx.progressAria}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={md}
          aria-valuetext={cup ? t.draft.cup.progressText(md, total) : tx.progressText(md, total)}
        >
          <span style={{ width: `${total ? (md / total) * 100 : 0}%` }} />
        </div>
      </div>

      {cup && ownRow && (
        <dl className="facts league-ticker__facts">
          <div>
            <dt>{t.draft.cup.status}</dt>
            <dd>{day ? cupStatusText(t, ownStatus) : '–'}</dd>
          </div>
          <div>
            <dt>{tx.record}</dt>
            <dd>
              {ownRow.w}–{ownRow.d}–{ownRow.l}
            </dd>
          </div>
          <div>
            <dt>{tx.goals}</dt>
            <dd>
              {ownRow.gf}:{ownRow.ga}
            </dd>
          </div>
        </dl>
      )}

      {!cup && ownRow && ownPlace != null && (
        <dl className="facts league-ticker__facts">
          <div>
            <dt>{tx.place}</dt>
            <dd>
              {day ? t.draft.placeNo(ownPlace) : '–'}
              {day && <Trend delta={day.delta[ownRow.team]} />}
            </dd>
          </div>
          <div>
            <dt>{tx.points}</dt>
            <dd>{ownRow.pts}</dd>
          </div>
          <div>
            <dt>{tx.record}</dt>
            <dd>
              {ownRow.w}–{ownRow.d}–{ownRow.l}
            </dd>
          </div>
          <div>
            <dt>{tx.goals}</dt>
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
              <span className="league-finale__kicker">{tx.fullTime}</span>
              {cup ? (
                <>
                  {winner != null && (
                    <p className="league-finale__line">
                      {t.draft.cup.winnerLabel}
                      <strong>{nameOf(winner)}</strong>
                    </p>
                  )}
                  {you != null && ownStatus && (
                    <p className="league-finale__you">
                      {ownStatus === 'winner' ? t.draft.cup.youWinner : cupStatusText(t, ownStatus)}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="league-finale__line">
                    {tx.championLabel}
                    <strong>{nameOf(day.leader.team)}</strong> · {t.draft.pts(day.leader.pts)}
                  </p>
                  {tieNote && <p className="league-finale__tie">{tieNote}</p>}
                  {you != null && ownPlace != null && (
                    <p className="league-finale__you">{ownPlace === 1 ? tx.youChampion : tx.yourPlace(ownPlace)}</p>
                  )}
                </>
              )}
              {finaleMs != null && finaleMs > 0 && (
                <span className="league-finale__timer" aria-hidden="true">
                  <span style={{ animationDuration: `${finaleMs}ms` }} />
                </span>
              )}
            </div>
          )}

          {day ? (
            <section key={day.round} className="league-board" aria-label={dayLabel(day.round)}>
              <div className="league-board__bar">
                <span>{dayLabel(day.round)}</span>
                <span>{finale ? tx.finalScores : tx.results}</span>
              </div>
              <FixtureList
                matches={day.matches}
                you={you}
                nameOf={nameOf}
                pokemonName={pokemonName}
                pensOf={pensOf}
              />
              {!cup && day.byes.length > 0 && (
                <p className="league-board__byes">{t.draft.byes(day.byes.map(nameOf).join(', '))}</p>
              )}
            </section>
          ) : (
            <section className="league-board league-board--upcoming" aria-label={tx.kickoff}>
              <div className="league-countdown" role="timer" aria-live="off">
                <span className="league-countdown__label">{secs > 0 ? tx.kickoffIn : tx.kickoffNow}</span>
                {secs > 0 && (
                  <span key={secs} className="league-countdown__num">
                    {formatCountdown(secs)} …
                  </span>
                )}
              </div>
              {days[0] && (
                <>
                  <div className="league-board__bar">
                    <span>{dayLabel(1)}</span>
                    <span>{tx.fixtures}</span>
                  </div>
                  <FixtureList matches={days[0].matches} you={you} nameOf={nameOf} pokemonName={pokemonName} upcoming />
                  {!cup && days[0].byes.length > 0 && (
                    <p className="league-board__byes">{t.draft.byes(days[0].byes.map(nameOf).join(', '))}</p>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        {cup ? (
          <aside className="league-ticker__side" aria-label={groupsPhase ? t.draft.cup.groupsTitle : t.draft.cup.bracket}>
            <h3 className="section-title">{groupsPhase ? t.draft.cup.groupsTitle : t.draft.cup.bracket}</h3>
            {groupsPhase && cup.groups ? (
              <CupGroups teams={league.teams} matches={league.matches} groups={cup.groups} upTo={day?.round ?? 0} you={you} nameOf={nameOf} />
            ) : day ? (
              <CupBracket cup={cup} matches={league.matches} upTo={day.round} you={you} nameOf={nameOf} />
            ) : (
              <p className="muted small">{tx.startsSoon}</p>
            )}
          </aside>
        ) : (
          <aside className="league-ticker__side" aria-label={t.draft.table}>
            <h3 className="section-title">{day ? tx.tableAfter(day.round) : t.draft.table}</h3>
            <LiveTable table={table} day={day} you={you} nameOf={nameOf} matches={league.matches} />
          </aside>
        )}
      </div>

      {scorers.length > 0 && (
        <section className="league-ticker__scorers" aria-label={t.draft.topScorers}>
          <h3 className="section-title">{t.draft.topScorers}</h3>
          <ol className="league-ticker__scorer-list">
            {scorers.map((sc, i) => (
              <li key={`${sc.teamIndex}-${sc.pokemonId}`} className={sc.teamIndex === you ? 'is-you' : ''}>
                <span className="muted">{i + 1}.</span>
                <span className="league-ticker__scorer-name">
                  {pokemonName(sc.pokemonId)} <small className="muted">{nameOf(sc.teamIndex)}</small>
                </span>
                <strong>{sc.goals}</strong>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!day && preKickoff}

      <p className="league-ticker__note muted small">{tx.note}</p>
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
  /** KO-Turnier: Elfmeterschießen eines Spiels (sonst null) */
  pensOf?: (m: Match) => { home: number; away: number } | null;
}

/** Alle Spiele eines Spieltags – das eigene zuerst und hervorgehoben. */
export function FixtureList({ matches, you, nameOf, pokemonName, upcoming, className = '', pensOf }: FixtureListProps) {
  const t = useT();
  const sorted = you == null ? matches : [...matches].sort((a, b) => Number(isOwn(b, you)) - Number(isOwn(a, you)));
  return (
    <ol className={`league-fixtures ${className}`}>
      {sorted.map((m) => {
        const own = you != null && isOwn(m, you);
        const result = you != null && own && !upcoming ? matchFor([m], you) : null;
        const home = scorerSummary(m.homeScorers, pokemonName);
        const away = scorerSummary(m.awayScorers, pokemonName);
        const pens = !upcoming ? pensOf?.(m) ?? null : null;
        return (
          <li
            key={`${m.round}-${m.home}-${m.away}`}
            className={`league-fixture ${own ? 'is-own' : ''} ${result ? `is-${result.outcome}` : ''}`}
          >
            <div className="league-fixture__row">
              <span className={`league-fixture__team league-fixture__team--home ${m.home === you ? 'is-you' : ''}`}>
                {nameOf(m.home)}
              </span>
              <span
                className="league-fixture__score"
                aria-label={upcoming ? t.draft.ticker.scoreOpen : t.draft.ticker.scoreAria(m.hg, m.ag)}
              >
                {upcoming ? '–:–' : `${m.hg}:${m.ag}`}
              </span>
              <span className={`league-fixture__team league-fixture__team--away ${m.away === you ? 'is-you' : ''}`}>
                {nameOf(m.away)}
              </span>
            </div>
            {!upcoming && (home || away || result || pens) && (
              <div className="league-fixture__foot">
                <span className="league-fixture__scorers league-fixture__scorers--home">{home}</span>
                <span className="league-fixture__mid">
                  {result && (
                    <span className={`league-fixture__outcome is-${result.outcome}`}>{t.draft.outcome[result.outcome]}</span>
                  )}
                  {pens && (
                    <small className="league-fixture__pens" title={t.draft.cup.pensTitle}>
                      {t.draft.cup.pens(pens.home, pens.away)}
                    </small>
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
  const t = useT();
  if (!delta) {
    return (
      <span className="league-trend league-trend--same">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{t.draft.ticker.unchanged}</span>
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
        {t.draft.ticker.trend(n, up)}
      </span>
    </span>
  );
}

interface LiveTableProps {
  table: TableRow[];
  day: Matchday | null;
  you: number | null;
  nameOf: (team: number) => string;
  /** Alle Spiele – für die Formkurve bis zum aktuellen Spieltag */
  matches: Match[];
}

/** Komplette Tabelle nach dem Spieltag (höchstens 8 Teams) mit Trendpfeilen. */
function LiveTable({ table, day, you, nameOf, matches }: LiveTableProps) {
  const t = useT();
  const c = t.draft.col;
  return (
    <div className="table-scroll">
      <table className="league-table league-live">
        <thead>
          <tr>
            <th scope="col" title={c.placeTitle}>
              {c.place}
            </th>
            <th scope="col" className="left">
              {c.team}
            </th>
            <th scope="col" title={c.playedTitle}>
              {c.played}
            </th>
            <th scope="col" title={c.wonTitle}>
              {c.won}
            </th>
            <th scope="col" title={c.drawnTitle}>
              {c.drawn}
            </th>
            <th scope="col" title={c.lostTitle}>
              {c.lost}
            </th>
            <th scope="col">{c.goals}</th>
            <th scope="col" title={c.diffTitle}>
              {c.diff}
            </th>
            <th scope="col" title={c.ptsTitle}>
              {c.pts}
            </th>
            <th scope="col" title={c.formTitle} className="league-live__form-col">
              {c.form}
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
              <td className="league-live__form-col">
                <FormDots form={day ? recentForm(matches, r.team, day.round) : []} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Formkurve als Punkte (ältestes links) mit Text für Screenreader. */
export function FormDots({ form }: { form: ('S' | 'U' | 'N')[] }) {
  const t = useT();
  if (!form.length) return <span aria-hidden="true">–</span>;
  return (
    <span className="league-form" aria-label={t.draft.col.formAria(form.map((o) => t.draft.outcome[o]).join(', '))}>
      {form.map((o, i) => (
        <span key={i} className={`league-form__dot is-${o}`} aria-hidden="true" />
      ))}
    </span>
  );
}
