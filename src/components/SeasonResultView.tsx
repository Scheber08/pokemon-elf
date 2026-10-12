import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import type { ChallengeStats } from '../lib/challengeStats';
import { downloadBlob, shareImage } from '../lib/exportImage';
import { CHALLENGE_LABEL } from '../lib/leaderboard';
import { lineupImage, slugify } from '../lib/lineupImage';
import {
  computeRun,
  playerName,
  savePlayerName,
  type ComputedRun,
  type FinishedRunInput,
  type RunRanking,
} from '../lib/runFinish';
import { formatRecord, type SeasonResult } from '../lib/season';
import { scorerSummary } from '../lib/seasonTimeline';
import { usePokemonData, type ScaleKind } from '../state/PokemonData';
import { useToast } from '../state/Toast';
import type { ChallengeKey, SpriteStyle } from '../types';
import { PosBadge } from './Badges';
import { StatCards } from './ChallengeParts';
import { Confetti } from './Confetti';
import { Pitch } from './Pitch';
import { SeasonTicker } from './SeasonTicker';
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

function verdict(s: SeasonResult): string {
  if (s.perfect) return 'Perfekte Saison! Kein einziger Punkt abgegeben.';
  if (s.record.l === 0) return 'Ungeschlagen! Nur die Remis trennen dich von der Perfektion.';
  if (s.position === 1) return 'Meister! Die Schale geht an dein Team.';
  if (s.position <= 4) return 'Platz in der Königsklasse – starke Saison.';
  if (s.position <= 7) return 'Europapokal-Kurs. Da geht noch was.';
  if (s.position <= 12) return 'Gesichertes Mittelfeld.';
  if (s.position <= 15) return 'Zittern bis zum Schluss – aber drin geblieben.';
  return 'Abstieg. Zeit für einen Kaderumbruch.';
}

export const EXPLAINER =
  'Jedes Pokémon wird danach bewertet, wie gut es auf seine Position passt – aus Basiswerten, Größe, Gewicht und Typ. Torwart, Innenverteidiger und Stürmer zählen am meisten, und deine drei schwächsten Positionen ziehen das ganze Team runter. Gegner reichen von 350 bis 910.';

/** Online-Wertung im Kopf der Bilanz: gewertet (mit Plätzen), offline oder abgelehnt. */
function RankingNote({ ranking, challenge }: { ranking: RunRanking; challenge: ChallengeKey }) {
  if (ranking.status === 'ranked') {
    const parts = ['Online gewertet'];
    if (ranking.rankToday != null) parts.push(`Platz ${ranking.rankToday} heute`);
    if (ranking.rankAllTime != null) parts.push(`Platz ${ranking.rankAllTime} allzeit`);
    return (
      <p className="result-ranking result-ranking--ranked">
        <span className="result-ranking__badge">{parts.join(' · ')}</span>
        <Link to={`/rangliste?c=${challenge}&p=today`}>Rangliste</Link>
      </p>
    );
  }
  if (ranking.status === 'rejected') {
    return (
      <p className="notice notice--error result-ranking" role="alert">
        {ranking.message ?? 'Der Server hat diesen Run nicht gewertet.'}
      </p>
    );
  }
  return <p className="result-ranking muted small">{ranking.message ?? 'Nicht gewertet'}</p>;
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
  newRunLabel = 'Neuer Run',
  stats,
}: Props) {
  const { byId, scale } = usePokemonData();
  const toast = useToast();
  const run = useMemo(() => computeRun(input, byId, scale(scaleKind)), [input, byId, scale, scaleKind]);
  const { evaluation, season } = run;
  const [name, setName] = useState(playerName);
  const [busy, setBusy] = useState(false);
  const [savingName, setSavingName] = useState(false);
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
  const teamName = input.teamName || 'Meine Elf';
  const nameOf = (id: number) => byId.get(id)?.de ?? '?';

  const makeImage = () =>
    lineupImage({
      formation: input.formation,
      slots: input.slots,
      ss: input.ss,
      sprite,
      byId,
      teamName,
      subtitle: `${input.formation} · ${CHALLENGE_LABEL[challenge]}`,
      result: {
        record,
        points: season.points,
        score: evaluation.score,
        position: season.position,
        label: 'Saisonbilanz',
      },
    });

  const onShare = async () => {
    setBusy(true);
    try {
      const blob = await makeImage();
      const text = `Ich bin mit meiner Pokémon-Elf ${record} gegangen! Score ${evaluation.score}`;
      const how = await shareImage(blob, `${slugify(teamName)}-${record}.png`, `${text} ${window.location.origin}`);
      if (how === 'downloaded') toast('Bild gespeichert, Text in die Zwischenablage kopiert');
    } catch (e) {
      console.error(e);
      toast('Teilen nicht möglich');
    } finally {
      setBusy(false);
    }
  };

  const onSaveImage = async () => {
    setBusy(true);
    try {
      downloadBlob(await makeImage(), `${slugify(teamName)}-${record}.png`);
    } catch {
      toast('Bild konnte nicht erstellt werden');
    } finally {
      setBusy(false);
    }
  };

  const onSaveName = async () => {
    setSavingName(true);
    try {
      const { online } = await savePlayerName(name, entryId);
      setName(playerName());
      toast(online ? 'Name gespeichert – auch online' : 'Name gespeichert');
    } catch {
      toast('Name konnte nicht gespeichert werden');
    } finally {
      setSavingName(false);
    }
  };

  const weakCodes = evaluation.weakest.map((i) => defs[i].pos);

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
              ariaLabel="Deine Elf"
            />
          </div>
          <div className="result-hero__info">
            <span className="kicker">Saisonbilanz · {CHALLENGE_LABEL[challenge]}</span>
            <h1 id="result-title" className="result-hero__team" ref={titleRef} tabIndex={-1}>
              {teamName}
            </h1>
            <div className={`result-hero__record ${season.perfect ? 'is-perfect' : ''}`} aria-label={`Bilanz ${season.record.w} Siege, ${season.record.d} Unentschieden, ${season.record.l} Niederlagen`}>
              {record}
            </div>
            <div className="result-hero__legend" aria-hidden="true">
              Siege – Remis – Niederlagen
            </div>
            {ranking && <RankingNote ranking={ranking} challenge={challenge} />}
            <dl className="facts">
              <div>
                <dt>Punkte</dt>
                <dd>{season.points}</dd>
              </div>
              <div>
                <dt>Team-Score</dt>
                <dd>{evaluation.score}</dd>
              </div>
              <div>
                <dt>Platz</dt>
                <dd>{season.position}.</dd>
              </div>
              <div>
                <dt>Tore</dt>
                <dd>
                  {season.goalsFor}:{season.goalsAgainst}
                </dd>
              </div>
            </dl>
            <p className="result-hero__verdict">{verdict(season)}</p>
            <p className="result-hero__weak">
              Schwachstellen laut Scouting: <strong>{weakCodes.join(', ')}</strong>
              <span className="muted"> (auf dem Feld markiert)</span>
            </p>
            <div className="actionbar">
              <button type="button" className="btn btn--primary" onClick={onShare} disabled={busy}>
                Teilen
              </button>
              <button type="button" className="btn" onClick={onSaveImage} disabled={busy}>
                Bild speichern
              </button>
              {newRunLabel !== null && (
                <button type="button" className="btn btn--accent" onClick={onNewRun}>
                  {newRunLabel}
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
                Dein Name auf der Rangliste
              </label>
              <div className="namefield__row">
                <input id="player-name" className="input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
                <button type="submit" className="btn" disabled={savingName}>
                  Speichern
                </button>
              </div>
            </form>
          </div>
        </section>

        <div className="result-grid">
          <section className="card" aria-labelledby="table-title">
            <h2 id="table-title" className="section-title">
              Abschlusstabelle
            </h2>
            <div className="table-scroll">
              <table className="league-table">
                <thead>
                  <tr>
                    <th scope="col">Pl.</th>
                    <th scope="col" className="left">
                      Team
                    </th>
                    <th scope="col" title="Spiele">Sp</th>
                    <th scope="col" title="Siege">S</th>
                    <th scope="col" title="Unentschieden">U</th>
                    <th scope="col" title="Niederlagen">N</th>
                    <th scope="col">Tore</th>
                    <th scope="col">Diff</th>
                    <th scope="col">Pkt</th>
                  </tr>
                </thead>
                <tbody>
                  {season.league.table.map((r, i) => (
                    <tr key={r.team} className={r.isUser ? 'is-user' : ''}>
                      <td>{i + 1}</td>
                      <td className="left">
                        {r.name}
                        {!r.isUser && <span className="rating">{r.rating}</span>}
                      </td>
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
          </section>

          <section className="card" aria-labelledby="scorers-title">
            <h2 id="scorers-title" className="section-title">
              Torschützenliste
            </h2>
            {season.scorers.length === 0 ? (
              <p className="muted">Keine Tore – autsch.</p>
            ) : (
              <ol className="scorers">
                {season.scorers.map((s) => {
                  const p = byId.get(s.pokemonId);
                  return (
                    <li key={`${s.pokemonId}-${s.pos}`}>
                      <PosBadge pos={s.pos} />
                      {p && <Sprite pokemon={p} style={sprite} className="scorers__sprite" />}
                      <span className="scorers__name">{p?.de}</span>
                      <span className="scorers__goals">{s.goals}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <details className="card details">
          <summary>Saisondetails – alle {season.userMatches.length} Spiele</summary>
          <ol className="matches">
            {season.userMatches.map((m) => (
              <li key={m.round} className={`match match--${m.outcome}`}>
                <span className="match__round">{m.round}.</span>
                <span className="match__venue">{m.isHome ? 'H' : 'A'}</span>
                <span className="match__opp">
                  {m.isHome ? 'vs.' : '@'} {m.opponent}
                </span>
                <span className="match__score">
                  {m.gf}:{m.ga}
                </span>
                <span className={`match__outcome match__outcome--${m.outcome}`}>{m.outcome}</span>
                {m.scorers.length > 0 && (
                  <span className="match__scorers">{scorerSummary(m.scorers, nameOf)}</span>
                )}
              </li>
            ))}
          </ol>
        </details>

        <p className="explainer">{EXPLAINER}</p>
        <p className="muted small">
          Positionen nach Gewicht: TW {POSITIONS.TW.teamWeight.toLocaleString('de-DE')} · ST{' '}
          {POSITIONS.ST.teamWeight.toLocaleString('de-DE')} · IV/OM {POSITIONS.IV.teamWeight.toLocaleString('de-DE')} ·
          DM {POSITIONS.DM.teamWeight.toLocaleString('de-DE')} · übrige 1,0
        </p>
      </div>
      {stats && <StatCards stats={stats} />}
    </>
  );
}
