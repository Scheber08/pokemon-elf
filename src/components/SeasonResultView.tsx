import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { fmtNumber, LANGS, messages, useT, type Messages } from '../i18n';
import type { ChallengeStats } from '../lib/challengeStats';
import { downloadBlob, shareImage } from '../lib/exportImage';
import { lineupImage, slugify } from '../lib/lineupImage';
import { LIMITS } from '../lib/api/contract';
import {
  computeRun,
  playerName,
  PlayerNameError,
  savePlayerName,
  type ComputedRun,
  type FinishedRunInput,
  type RunRanking,
} from '../lib/runFinish';
import { formatRecord, type SeasonResult } from '../lib/season';
import { scorerSummary } from '../lib/seasonTimeline';
import { usePokemonData, type ScaleKind } from '../state/PokemonData';
import { useToast } from '../state/Toast';
import { useFieldError } from '../state/useFieldError';
import type { ChallengeKey, SpriteStyle } from '../types';
import { PosBadge } from './Badges';
import { StatCards } from './ChallengeParts';
import { Confetti } from './Confetti';
import { Pitch } from './Pitch';
import { SeasonTicker } from './SeasonTicker';
import { ReplayToggle, useMatchReport } from './MatchReport';
import { Sprite } from './Sprite';
import '../styles/ticker.css';

interface Props {
  challenge: ChallengeKey;
  input: FinishedRunInput;
  scaleKind: ScaleKind;
  sprite: SpriteStyle;
  /** Eintrag in der lokalen Run-Historie (für Umbenennen) */
  entryId: string | null;
  onNewRun: () => void;
  /** true direkt nach dem Run: erst den Live-Ticker abspielen, dann die Bilanz zeigen */
  reveal?: boolean;
  /** Online-Wertung des Runs (gewertet / offline / abgelehnt) */
  ranking?: RunRanking | null;
  /** Zusätzlicher Inhalt unter den Aktionen, z. B. Emoji-Teilen der Tages-Challenge */
  extra?: (run: ComputedRun) => ReactNode;
  /** Beschriftung des „Neuer Run"-Buttons; null blendet ihn aus */
  newRunLabel?: string | null;
  /** Lokale Bestwerte unter der Bilanz – erst nach dem Ticker, damit sie das Ergebnis nicht vorwegnehmen */
  stats?: ChallengeStats;
}

function verdict(s: SeasonResult, v: Messages['result']['verdict']): string {
  if (s.perfect) return v.perfect;
  if (s.record.l === 0) return v.unbeaten;
  if (s.position === 1) return v.champion;
  if (s.position <= 4) return v.top4;
  if (s.position <= 7) return v.europe;
  if (s.position <= 12) return v.midTable;
  if (s.position <= 15) return v.survived;
  return v.relegated;
}

/**
 * Fester Hinweis eines Ergebnisses – auch bei älteren gespeicherten Ergebnissen ohne `note`,
 * die nur die Meldung (in einer der Sprachen) kennen.
 */
function fixedNote(ranking: RunRanking): RunRanking['note'] {
  if (ranking.note) return ranking.note;
  const msg = ranking.message;
  if (msg == null) return undefined;
  const known = LANGS.map((l) => messages(l).challenge);
  if (known.some((c) => c.playedOffline === msg)) return 'played_offline';
  if (known.some((c) => c.unreachableNotRanked === msg)) return 'unreachable';
  return undefined;
}

/** Online-Wertung im Kopf der Bilanz: gewertet (mit Plätzen), offline oder abgelehnt. */
function RankingNote({ ranking, challenge }: { ranking: RunRanking; challenge: ChallengeKey }) {
  const t = useT();
  if (ranking.status === 'ranked') {
    const parts = [t.result.rankedOnline];
    if (ranking.rankToday != null) parts.push(t.result.rankToday(ranking.rankToday));
    if (ranking.rankAllTime != null) parts.push(t.result.rankAllTime(ranking.rankAllTime));
    return (
      <p className="result-ranking result-ranking--ranked">
        <span className="result-ranking__badge">{parts.join(' · ')}</span>
        <Link to={`/rangliste?c=${challenge}&p=today`}>{t.nav.tabs.leaderboard}</Link>
      </p>
    );
  }
  if (ranking.status === 'rejected') {
    return (
      <p className="notice notice--error result-ranking" role="alert">
        {ranking.message ?? t.result.rejected}
      </p>
    );
  }
  // Feste Hinweise in der aktuellen Sprache (gespeicherte Meldung gilt nur für Server-Texte)
  const fixed = fixedNote(ranking);
  const note =
    fixed === 'played_offline'
      ? t.challenge.playedOffline
      : fixed === 'unreachable'
        ? t.challenge.unreachableNotRanked
        : ranking.message;
  return <p className="result-ranking muted small">{note ?? t.result.notRanked}</p>;
}

export function SeasonResultView({
  challenge,
  input,
  scaleKind,
  sprite,
  entryId,
  onNewRun,
  reveal = false,
  ranking = null,
  extra,
  newRunLabel,
  stats,
}: Props) {
  const t = useT();
  const tr = t.result;
  const { byId, scale } = usePokemonData();
  const toast = useToast();
  const run = useMemo(() => computeRun(input, byId, scale(scaleKind)), [input, byId, scale, scaleKind]);
  const { evaluation, season } = run;
  const [name, setName] = useState(playerName);
  const [busy, setBusy] = useState(false);
  const [savingName, setSavingName] = useState(false);
  /** Name abgelehnt (leer, „Trainer", vom Server) – Meldung direkt am Feld */
  const nameError = useFieldError();
  /** Ticker fertig/übersprungen – bleibt auch, wenn der Parent reveal später auf false setzt */
  const [tickerDone, setTickerDone] = useState(false);
  const showTicker = reveal && !tickerDone;
  const heroRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);

  // Nach dem Ticker: Fokus auf die Überschrift, Bilanz ins Bild holen
  useEffect(() => {
    if (showTicker || !focusTitle.current) return;
    focusTitle.current = false;
    titleRef.current?.focus({ preventScroll: true });
    const hero = heroRef.current;
    if (hero && hero.getBoundingClientRect().top < 0) hero.scrollIntoView({ block: 'start' });
  }, [showTicker]);

  const onTickerDone = () => {
    focusTitle.current = true;
    setTickerDone(true);
  };

  const defs = FORMATIONS[input.formation].slots;
  const record = formatRecord(season.record);
  const teamName = input.teamName || tr.defaultTeamName;
  const nameOf = (id: number) => {
    const p = byId.get(id);
    return p ? t.game.pokemon(p) : '?';
  };
  /** Vereinsnamen sind intern deutsch – das eigene Team heißt immer teamName */
  const teamLabel = (r: { name: string; isUser: boolean }) => (r.isUser ? teamName : t.game.club(r.name));
  // Spielwiedergabe (2D/Bericht): das eigene Team (Index 0) mit seiner Elf, die Gegner allgemein
  const report = useMatchReport(
    (i) => (i === 0 ? teamName : t.game.club(season.league.teams[i]?.name ?? '')),
    nameOf,
    (m) => t.draft.matchday(m.round),
    undefined,
    (i) => (i === 0 ? { formation: input.formation, ids: input.slots } : null),
  );
  const leagueMatch = (round: number) => season.league.matches.find((x) => x.round === round && (x.home === 0 || x.away === 0));

  const makeImage = () =>
    lineupImage({
      formation: input.formation,
      slots: input.slots,
      ss: input.ss,
      sprite,
      byId,
      teamName,
      subtitle: `${input.formation} · ${t.game.challenge[challenge]}`,
      result: {
        record,
        points: season.points,
        score: evaluation.score,
        position: season.position,
        label: tr.title,
      },
    });

  const onShare = async () => {
    setBusy(true);
    try {
      const blob = await makeImage();
      const text = tr.shareText(record, evaluation.score);
      const how = await shareImage(blob, `${slugify(teamName)}-${record}.png`, `${text} ${window.location.origin}`);
      if (how === 'downloaded') toast(tr.imageSaved);
    } catch (e) {
      console.error(e);
      toast(tr.shareFailed);
    } finally {
      setBusy(false);
    }
  };

  const onSaveImage = async () => {
    setBusy(true);
    try {
      downloadBlob(await makeImage(), `${slugify(teamName)}-${record}.png`);
    } catch {
      toast(tr.imageFailed);
    } finally {
      setBusy(false);
    }
  };

  const onSaveName = async () => {
    setSavingName(true);
    nameError.clear();
    try {
      const { online } = await savePlayerName(name, entryId);
      setName(playerName());
      toast(online ? tr.nameSavedOnline : tr.nameSaved);
    } catch (e) {
      if (e instanceof PlayerNameError) {
        nameError.fail(e.message);
      } else {
        toast(tr.nameFailed);
      }
    } finally {
      setSavingName(false);
    }
  };

  const weakCodes = evaluation.weakest.map((i) => t.game.posShort[defs[i].pos]);
  const runLabel = newRunLabel === undefined ? tr.newRun : newRunLabel;
  const weight = (pos: keyof typeof POSITIONS) => fmtNumber(POSITIONS[pos].teamWeight, 1);
  const { posShort } = t.game;

  // Während des Tickers keine Bestwerte – sie zeigen den neuen Rekord schon vor dem letzten Spieltag.
  if (showTicker) {
    return (
      <div className="result">
        <SeasonTicker season={season} teamName={teamName} sprite={sprite} byId={byId} onDone={onTickerDone} />
      </div>
    );
  }

  return (
    <>
      <div className="result">
        {season.perfect && <Confetti />}
        <section className="result-hero card" aria-labelledby="result-title" ref={heroRef}>
          <div className="result-hero__pitch">
            <Pitch
              formation={input.formation}
              slots={input.slots}
              ss={input.ss}
              sprite={sprite}
              highlight={evaluation.weakest}
              ariaLabel={tr.yourTeam}
            />
          </div>
          <div className="result-hero__info">
            <span className="kicker">
              {tr.title} · {t.game.challenge[challenge]}
            </span>
            <h1 id="result-title" className="result-hero__team" ref={titleRef} tabIndex={-1}>
              {teamName}
            </h1>
            <div
              className={`result-hero__record ${season.perfect ? 'is-perfect' : ''}`}
              aria-label={tr.recordAria(season.record.w, season.record.d, season.record.l)}
            >
              {record}
            </div>
            <div className="result-hero__legend" aria-hidden="true">
              {tr.recordLegend}
            </div>
            {ranking && <RankingNote ranking={ranking} challenge={challenge} />}
            <dl className="facts">
              <div>
                <dt>{tr.points}</dt>
                <dd>{season.points}</dd>
              </div>
              <div>
                <dt>{tr.teamScore}</dt>
                <dd>{evaluation.score}</dd>
              </div>
              <div>
                <dt>{tr.place}</dt>
                <dd>{tr.ordinal(season.position)}</dd>
              </div>
              <div>
                <dt>{tr.goals}</dt>
                <dd>
                  {season.goalsFor}:{season.goalsAgainst}
                </dd>
              </div>
            </dl>
            <p className="result-hero__verdict">{verdict(season, tr.verdict)}</p>
            <p className="result-hero__weak">
              {tr.weakSpots}
              <strong>{weakCodes.join(', ')}</strong>
              <span className="muted">{tr.weakSpotsNote}</span>
            </p>
            <div className="actionbar">
              <button type="button" className="btn btn--primary" onClick={onShare} disabled={busy}>
                {tr.share}
              </button>
              <button type="button" className="btn" onClick={onSaveImage} disabled={busy}>
                {tr.saveImage}
              </button>
              {runLabel !== null && (
                <button type="button" className="btn btn--accent" onClick={onNewRun}>
                  {runLabel}
                </button>
              )}
            </div>
            {extra?.(run)}
            <form
              className="namefield"
              onSubmit={(e) => {
                e.preventDefault();
                void onSaveName();
              }}
            >
              <label className="field__label" htmlFor="player-name">
                {tr.nameLabel}
              </label>
              <div className="namefield__row">
                <input
                  id="player-name"
                  ref={nameError.ref}
                  className="input"
                  maxLength={LIMITS.playerMax}
                  value={name}
                  autoComplete="nickname"
                  aria-required="true"
                  aria-invalid={nameError.error ? true : undefined}
                  aria-describedby={nameError.error ? 'player-name-error' : undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    nameError.clear();
                  }}
                />
                <button type="submit" className="btn" disabled={savingName}>
                  {tr.save}
                </button>
              </div>
              {nameError.error && (
                <p id="player-name-error" key={nameError.error.attempt} className="field__error" role="alert">
                  {nameError.error.message}
                </p>
              )}
            </form>
          </div>
        </section>

        <div className="result-grid">
          <section className="card" aria-labelledby="table-title">
            <h2 id="table-title" className="section-title">
              {tr.finalTable}
            </h2>
            <div className="table-scroll">
              <table className="league-table">
                <thead>
                  <tr>
                    <th scope="col">{tr.col.place}</th>
                    <th scope="col" className="left">
                      {tr.col.team}
                    </th>
                    <th scope="col" title={tr.col.playedTitle}>
                      {tr.col.played}
                    </th>
                    <th scope="col" title={tr.col.wonTitle}>
                      {tr.col.won}
                    </th>
                    <th scope="col" title={tr.col.drawnTitle}>
                      {tr.col.drawn}
                    </th>
                    <th scope="col" title={tr.col.lostTitle}>
                      {tr.col.lost}
                    </th>
                    <th scope="col">{tr.col.goals}</th>
                    <th scope="col">{tr.col.diff}</th>
                    <th scope="col">{tr.col.pts}</th>
                  </tr>
                </thead>
                <tbody>
                  {season.league.table.map((r, i) => (
                    <tr key={r.team} className={r.isUser ? 'is-user' : ''}>
                      <td>{i + 1}</td>
                      <td className="left">
                        {teamLabel(r)}
                        {!r.isUser && <span className="rating">{r.rating}</span>}
                      </td>
                      <td>{r.played}</td>
                      <td>{r.w}</td>
                      <td>{r.d}</td>
                      <td>{r.l}</td>
                      <td>
                        {`${r.gf}:${r.ga}`}
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
          </section>

          <section className="card" aria-labelledby="scorers-title">
            <h2 id="scorers-title" className="section-title">
              {tr.topScorers}
            </h2>
            {season.scorers.length === 0 ? (
              <p className="muted">{tr.noGoals}</p>
            ) : (
              <ol className="scorers">
                {season.scorers.map((s) => {
                  const p = byId.get(s.pokemonId);
                  return (
                    <li key={`${s.pokemonId}-${s.pos}`}>
                      <PosBadge pos={s.pos} />
                      {p && <Sprite pokemon={p} style={sprite} className="scorers__sprite" />}
                      <span className="scorers__name">{p && t.game.pokemon(p)}</span>
                      <span className="scorers__goals">{s.goals}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <details className="card details">
          <summary>{tr.details(season.userMatches.length)}</summary>
          <ReplayToggle />
          {report.element}
          <ol className="matches">
            {season.userMatches.map((m) => (
              <li key={m.round} className={`match match--${m.outcome}`}>
                <span className="match__round">{m.round}.</span>
                <span className="match__venue">{m.isHome ? tr.venueHome : tr.venueAway}</span>
                <span className="match__opp">
                  {m.isHome ? tr.vsHome : tr.vsAway} {t.game.club(m.opponent)}
                </span>
                {report.open && leagueMatch(m.round) ? (
                  <button
                    type="button"
                    className="match__score match__score--btn"
                    aria-label={t.draft.report.open(teamName, t.game.club(m.opponent), `${m.gf}:${m.ga}`)}
                    title={t.draft.report.title}
                    onClick={() => report.open?.(leagueMatch(m.round)!)}
                  >
                    {m.gf}:{m.ga}
                  </button>
                ) : (
                  <span className="match__score">
                    {m.gf}:{m.ga}
                  </span>
                )}
                <span className={`match__outcome match__outcome--${m.outcome}`}>{tr.outcomeShort[m.outcome]}</span>
                {m.scorers.length > 0 && (
                  <span className="match__scorers">{scorerSummary(m.scorers, nameOf)}</span>
                )}
              </li>
            ))}
          </ol>
        </details>

        <p className="explainer">{tr.explainer}</p>
        <p className="muted small">
          {tr.weights(
            [
              [posShort.TW, weight('TW')],
              [posShort.ST, weight('ST')],
              [`${posShort.IV}/${posShort.OM}`, weight('IV')],
              [posShort.DM, weight('DM')],
            ],
            fmtNumber(1, 1),
          )}
        </p>
      </div>
      {stats && <StatCards stats={stats} />}
    </>
  );
}
