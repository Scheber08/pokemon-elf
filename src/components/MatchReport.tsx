import { useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { formatMinute, type Goal, type Match } from '../lib/season';
import { Modal } from './Modal';

interface Props {
  match: Match;
  nameOf: (team: number) => string;
  pokemonName: (id: number) => string;
  /** Titel über dem Ergebnis (z. B. „Spieltag 5" oder „Halbfinale") */
  label?: string;
  /** KO-Turnier: Elfmeterschießen */
  pens?: { home: number; away: number } | null;
  onClose: () => void;
}

/** Ein Tor der Ereignisliste (Minute, Schütze, Vorlage) – goal fehlt bei Teams ohne Kader (Vereine) */
interface Event {
  goal: Goal | null;
  home: boolean;
}

/** Tore eines Teams: mit Schützen, dazu namenlose, wenn der Kader fehlt */
const eventsOf = (scorers: Goal[], goals: number, home: boolean): Event[] => [
  ...scorers.map((goal) => ({ goal, home })),
  ...Array.from({ length: Math.max(0, goals - scorers.length) }, () => ({ goal: null, home })),
];

/** Spielbericht: Tore mit Minute und Vorlage, dazu Ballbesitz, Schüsse, aufs Tor und xG. */
export function MatchReport({ match, nameOf, pokemonName, label, pens, onClose }: Props) {
  const t = useT();
  const tx = t.draft.report;
  const events: Event[] = [...eventsOf(match.homeScorers, match.hg, true), ...eventsOf(match.awayScorers, match.ag, false)].sort(
    (a, b) => (a.goal?.minute ?? 999) - (b.goal?.minute ?? 999),
  );
  const st = match.stats;
  const rows: { label: string; home: number; away: number; text?: (v: number) => string }[] = st
    ? [
        { label: tx.possession, home: st.possession, away: 100 - st.possession, text: (v) => `${v} %` },
        { label: tx.shots, home: st.shots[0], away: st.shots[1] },
        { label: tx.onTarget, home: st.onTarget[0], away: st.onTarget[1] },
        { label: tx.xg, home: st.xg[0], away: st.xg[1], text: (v) => v.toFixed(1) },
      ]
    : [];
  return (
    <Modal title={tx.title} onClose={onClose} className="match-report" labelId="match-report-title">
      {label && <p className="kicker match-report__label">{label}</p>}
      <div className="match-report__score">
        <span className="match-report__team">{nameOf(match.home)}</span>
        <strong className="match-report__result">
          {match.hg}:{match.ag}
        </strong>
        <span className="match-report__team match-report__team--away">{nameOf(match.away)}</span>
      </div>
      {pens && <p className="match-report__pens">{t.draft.cup.pens(pens.home, pens.away)}</p>}
      <h3 className="match-report__heading">{tx.goals}</h3>
      {events.length ? (
        <ol className="match-report__events">
          {events.map(({ goal, home }, i) => (
            <li key={i} className={`match-report__event ${home ? 'is-home' : 'is-away'}`}>
              <span className="match-report__minute">{goal?.minute != null ? formatMinute(goal.minute) : ''}</span>
              <span className="match-report__who">
                <span aria-hidden="true">⚽ </span>
                {goal ? (
                  <>
                    <strong>{pokemonName(goal.pokemonId)}</strong>
                    {goal.pos === 'SS' && <small className="muted"> ({tx.setPiece})</small>}
                    {goal.assist != null && <small className="muted"> · {tx.assist(pokemonName(goal.assist))}</small>}
                  </>
                ) : (
                  <strong>{tx.goalOf(nameOf(home ? match.home : match.away))}</strong>
                )}
                <span className="sr-only"> – {nameOf(home ? match.home : match.away)}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">{tx.noGoals}</p>
      )}
      {rows.length > 0 ? (
        <>
          <h3 className="match-report__heading">{tx.stats}</h3>
          <dl className="match-report__stats">
            {rows.map((r) => {
              const total = r.home + r.away;
              const share = total > 0 ? (r.home / total) * 100 : 50;
              const text = r.text ?? ((v: number) => String(v));
              return (
                <div key={r.label} className="match-report__stat">
                  <dt>{r.label}</dt>
                  <dd>
                    <span className="match-report__val">{text(r.home)}</span>
                    <span className="match-report__bar" aria-hidden="true">
                      <span style={{ width: `${share}%` }} />
                    </span>
                    <span className="match-report__val">{text(r.away)}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : (
        <p className="muted small">{tx.noStats}</p>
      )}
    </Modal>
  );
}

/** Spielbericht als Dialog: open(match) zeigt ihn, element gehört ins Rendering. */
export function useMatchReport(
  nameOf: (team: number) => string,
  pokemonName: (id: number) => string,
  labelOf?: (m: Match) => string,
  pensOf?: (m: Match) => { home: number; away: number } | null,
): { open: (m: Match) => void; element: ReactNode } {
  const [match, setMatch] = useState<Match | null>(null);
  const element = match ? (
    <MatchReport
      match={match}
      nameOf={nameOf}
      pokemonName={pokemonName}
      label={labelOf?.(match)}
      pens={pensOf?.(match) ?? null}
      onClose={() => setMatch(null)}
    />
  ) : null;
  return { open: setMatch, element };
}
