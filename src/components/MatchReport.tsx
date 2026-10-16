import { useMemo, useRef, useState, type ReactNode } from 'react';
import { fmtNumber, useLang, useT } from '../i18n';
import { formatMinute, type Goal, type Match } from '../lib/season';
import { lineupNumbers, type ReplayLineup } from '../lib/matchReplay';
import { MatchPitch } from './MatchPitch';
import { Modal } from './Modal';
import { SaveImageButton } from './SaveImageButton';
import { Segmented } from './Segmented';
import { useSettings, type ReplayMode } from '../state/Settings';
import '../styles/match-report.css';
import { Crest } from './Crest';

/**
 * Halbzeitstand aus den Torminuten (bis einschließlich 45.). null, wenn nicht jedes Tor eine Minute hat
 * (Vereinstore ohne Kader, ältere Spiele) oder gar keine Tore fielen.
 */
export function halfTimeScore(match: Pick<Match, 'hg' | 'ag' | 'homeScorers' | 'awayScorers'>): [number, number] | null {
  if (match.hg + match.ag === 0) return null;
  const timed = (goals: Goal[], n: number) => goals.length === n && goals.every((g) => g.minute != null);
  if (!timed(match.homeScorers, match.hg) || !timed(match.awayScorers, match.ag)) return null;
  const first = (goals: Goal[]) => goals.filter((g) => g.minute! <= 45).length;
  return [first(match.homeScorers), first(match.awayScorers)];
}

interface Props {
  match: Match;
  nameOf: (team: number) => string;
  pokemonName: (id: number) => string;
  /** Titel über dem Ergebnis (z. B. „Spieltag 5" oder „Halbfinale") */
  label?: string;
  /** KO-Turnier: Elfmeterschießen */
  pens?: { home: number; away: number } | null;
  /** Aufstellung eines Teams für die 2D-Ansicht (fehlt: allgemeine Formation) */
  lineupOf?: (team: number, match: Match) => ReplayLineup | null;
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
export function MatchReport({ match, nameOf, pokemonName, label, pens, lineupOf, onClose }: Props) {
  const t = useT();
  const tx = t.draft.report;
  const { replay, setReplay } = useSettings();
  // Startansicht wie eingestellt; ein Wechsel im Dialog wird zur neuen Einstellung
  const view = replay === 'report' ? 'report' : 'pitch';
  const setView = (v: 'pitch' | 'report') => setReplay(v);
  const cardRef = useRef<HTMLDivElement>(null);
  const lineups = useMemo<[ReplayLineup | null, ReplayLineup | null]>(
    () => [lineupOf?.(match.home, match) ?? null, lineupOf?.(match.away, match) ?? null],
    [match, lineupOf],
  );
  return (
    <Modal title={tx.title} onClose={onClose} className="match-report" labelId="match-report-title">
      <div className="match-report__tabs">
        <Segmented<'pitch' | 'report'>
          label={tx.title}
          hideLabel
          value={view}
          onChange={setView}
          options={[
            { value: 'pitch', label: t.draft.replay.tab },
            { value: 'report', label: t.draft.replay.reportTab },
          ]}
        />
      </div>
      <div ref={cardRef} className="match-report__card">
        {label && <p className="kicker match-report__label">{label}</p>}
        <div className="match-report__score">
          <span className="match-report__team">
            {lineups[0]?.crest && (
              <>
                <Crest crest={lineups[0].crest} size={22} />{' '}
              </>
            )}
            {nameOf(match.home)}
          </span>
          <strong className="match-report__result">
            {match.hg}:{match.ag}
          </strong>
          <span className="match-report__team match-report__team--away">
            {nameOf(match.away)}
            {lineups[1]?.crest && (
              <>
                {' '}
                <Crest crest={lineups[1].crest} size={22} />
              </>
            )}
          </span>
        </div>
        {pens && <p className="match-report__pens">{t.draft.cup.pens(pens.home, pens.away)}</p>}
        {(() => {
          const ht = halfTimeScore(match);
          return ht && <p className="match-report__half">{tx.halfTime(ht[0], ht[1])}</p>;
        })()}
        {view === 'report' && <ReportBody match={match} nameOf={nameOf} pokemonName={pokemonName} lineups={lineups} />}
      </div>
      {view === 'pitch' ? (
        <>
          <MatchPitch match={match} lineups={lineups} nameOf={nameOf} pokemonName={pokemonName} />
          <p className="muted small">{t.draft.replay.note}</p>
        </>
      ) : (
        <div className="match-report__actions">
          <SaveImageButton target={cardRef} filename={`pokemon-elf-spiel-${match.round}.png`} label={tx.image} aria={tx.imageAria} />
        </div>
      )}
    </Modal>
  );
}

/** Tore und Statistik des Berichts */
function ReportBody({
  match,
  nameOf,
  pokemonName,
  lineups,
}: Pick<Props, 'match' | 'nameOf' | 'pokemonName'> & { lineups: [ReplayLineup | null, ReplayLineup | null] }) {
  const t = useT();
  const lang = useLang();
  const tx = t.draft.report;
  // Trikotnummern je Seite (nur mit bekannter Aufstellung)
  const numbers = useMemo(() => lineups.map((l) => (l ? lineupNumbers(l) : null)), [lineups]);
  const who = (id: number, home: boolean) => {
    const n = numbers[home ? 0 : 1]?.get(id);
    const captain = lineups[home ? 0 : 1]?.captain === id;
    const tags = [n != null ? String(n) : '', captain ? 'C' : ''].filter(Boolean).join(', ');
    return tags ? `${pokemonName(id)} (${tags})` : pokemonName(id);
  };
  const events: Event[] = [...eventsOf(match.homeScorers, match.hg, true), ...eventsOf(match.awayScorers, match.ag, false)].sort(
    (a, b) => (a.goal?.minute ?? 999) - (b.goal?.minute ?? 999),
  );
  // Laufender Spielstand nach jedem Tor – nur, wenn jedes Tor eine Minute hat (sonst stimmt die Reihenfolge nicht)
  const running = events.every((e) => e.goal?.minute != null)
    ? events.reduce<[number, number][]>((acc, e) => {
        const [h, a] = acc.length ? acc[acc.length - 1] : [0, 0];
        acc.push(e.home ? [h + 1, a] : [h, a + 1]);
        return acc;
      }, [])
    : null;
  // Siegtor: das Tor des Siegers, nach dem der Verlierer nie mehr gleichzieht (Tor Nr. Verlierertore + 1)
  const winnerIdx = (() => {
    if (!running || match.hg === match.ag) return -1;
    const homeWon = match.hg > match.ag;
    const need = (homeWon ? match.ag : match.hg) + 1;
    return running.findIndex((r, i) => events[i].home === homeWon && r[homeWon ? 0 : 1] === need);
  })();
  // Wie vielter Treffer des Schützen in diesem Spiel (Doppelpack, Hattrick …) – nur in richtiger Reihenfolge
  const nth = (() => {
    if (!running) return null;
    const seen = new Map<string, number>();
    return events.map(({ goal, home }) => {
      const k = `${home ? 'h' : 'a'}${goal!.pokemonId}`;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      return n;
    });
  })();
  const st = match.stats;
  const rows: { label: string; home: number; away: number; text?: (v: number) => string }[] = st
    ? [
        { label: tx.possession, home: st.possession, away: 100 - st.possession, text: (v) => `${v} %` },
        { label: tx.shots, home: st.shots[0], away: st.shots[1] },
        { label: tx.onTarget, home: st.onTarget[0], away: st.onTarget[1] },
        { label: tx.xg, home: st.xg[0], away: st.xg[1], text: (v) => fmtNumber(v, 1, lang) },
      ]
    : [];
  return (
    <>
      <h3 className="match-report__heading">{tx.goals}</h3>
      {events.length ? (
        <ol className="match-report__events">
          {events.map(({ goal, home }, i) => (
            <li key={i} className={`match-report__event ${home ? 'is-home' : 'is-away'}`}>
              <span className="match-report__minute">{goal?.minute != null ? formatMinute(goal.minute) : ''}</span>
              {running && (
                <span className="match-report__running">
                  <span aria-hidden="true">
                    {running[i][0]}:{running[i][1]}
                  </span>
                  <span className="sr-only">{tx.running(running[i][0], running[i][1])}</span>
                </span>
              )}
              <span className="match-report__who">
                <span aria-hidden="true">⚽ </span>
                {goal ? (
                  <>
                    <strong>{who(goal.pokemonId, home)}</strong>
                    {goal.pos === 'SS' && <small className="muted"> ({tx.setPiece})</small>}
                    {goal.assist != null && <small className="muted"> · {tx.assist(who(goal.assist, home))}</small>}
                    {nth && nth[i] >= 2 && <small className="match-report__brace"> · {tx.nthGoal(nth[i])}</small>}
                    {running && running[i][0] === running[i][1] && <small className="match-report__equalizer"> · {tx.equalizer}</small>}
                    {i === winnerIdx && <small className="match-report__winner"> · {tx.winner}</small>}
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
    </>
  );
}

/** Spielbericht als Dialog: open(match) zeigt ihn, element gehört ins Rendering. */
export function useMatchReport(
  nameOf: (team: number) => string,
  pokemonName: (id: number) => string,
  labelOf?: (m: Match) => string,
  pensOf?: (m: Match) => { home: number; away: number } | null,
  lineupOf?: (team: number, match: Match) => ReplayLineup | null,
): { open: ((m: Match) => void) | undefined; element: ReactNode } {
  const [match, setMatch] = useState<Match | null>(null);
  const { replay } = useSettings();
  const element = match ? (
    <MatchReport
      match={match}
      nameOf={nameOf}
      pokemonName={pokemonName}
      label={labelOf?.(match)}
      pens={pensOf?.(match) ?? null}
      lineupOf={lineupOf}
      onClose={() => setMatch(null)}
    />
  ) : null;
  // Spielwiedergabe aus: Ergebnisse bleiben reiner Text
  return { open: replay === 'off' ? undefined : setMatch, element };
}

/** Schalter „Spielwiedergabe: 2D · Bericht · Aus" (gilt überall, wird gespeichert) */
export function ReplayToggle() {
  const t = useT();
  const { replay, setReplay } = useSettings();
  return (
    <div className="replay-toggle">
      <Segmented<ReplayMode>
        label={t.draft.replay.setting}
        value={replay}
        onChange={setReplay}
        options={[
          { value: 'pitch', label: t.draft.replay.tab, title: t.draft.replay.settingPitch },
          { value: 'report', label: t.draft.replay.reportTab, title: t.draft.replay.settingReport },
          { value: 'off', label: t.draft.replay.off, title: t.draft.replay.settingOff },
        ]}
      />
    </div>
  );
}
