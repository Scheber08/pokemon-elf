import { useCallback, useMemo } from 'react';
import { draftLink } from '../lib/api/draftClient';
import type { DraftTeam } from '../lib/api/draftContract';
import { copyText } from '../lib/exportImage';
import { draftShareText, leagueTimeline, titleRace, titleTieNote, topScorers } from '../lib/leagueTimeline';
import type { LeagueResult } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useToast } from '../state/Toast';
import type { SpriteStyle } from '../types';
import { Confetti } from './Confetti';
import { FixtureList } from './LeagueTicker';
import { Pitch } from './Pitch';
import { Sprite } from './Sprite';
import '../styles/league.css';

interface Props {
  league: LeagueResult;
  /** Draft-Teams in derselben Reihenfolge wie league.teams */
  teams: DraftTeam[];
  /** Team-Score je Team (Reihenfolge wie league.teams) */
  ratings: number[];
  /** Team des Betrachters (Index in league.teams) oder null = Zuschauer */
  highlight: number | null;
  sprite: SpriteStyle;
  code: string;
  leagueName: string;
}

/** Wie viele Torjäger die Liste zeigt */
const TOP_SCORERS = 10;

/**
 * Ergebnis einer Online-Draft-Liga: Meister, Abschlusstabelle mit Team-Score,
 * Torjäger, alle Aufstellungen (nur lesend) und alle Spieltage. Das eigene Team ist
 * überall hervorgehoben; bei Punktgleichheit an der Spitze steht dabei, wie der Titel
 * entschieden wurde. „Ergebnis teilen" (mit Link zur Liga) nutzt das Teilen-Menü oder die
 * Zwischenablage.
 */
export function DraftResults({ league, teams, ratings, highlight, sprite, code, leagueName }: Props) {
  const { byId } = usePokemonData();
  const toast = useToast();
  const days = useMemo(() => leagueTimeline(league), [league]);
  const scorers = useMemo(() => topScorers(league).slice(0, TOP_SCORERS), [league]);
  const table = league.table;
  const you = highlight != null && highlight >= 0 && highlight < league.teams.length ? highlight : null;

  const nameOf = useCallback(
    (t: number) => teams[t]?.name || league.teams[t]?.name || `Team ${t + 1}`,
    [teams, league.teams],
  );
  const pokemonName = useCallback((id: number) => byId.get(id)?.de ?? `#${id}`, [byId]);
  const ratingOf = (t: number) => ratings[t] ?? league.teams[t]?.rating ?? 0;

  const champion = table[0];
  const race = titleRace(table);
  const ownIndex = you != null ? table.findIndex((r) => r.team === you) : -1;
  const ownRow = ownIndex >= 0 ? table[ownIndex] : null;
  /** Standardschützen-Slot nur, wenn die Liga mit Standardschütze gedraftet hat */
  const hasSs = teams.some((t) => t.ss != null);

  if (!champion) {
    return <p className="notice">Für diese Liga gibt es noch kein Ergebnis.</p>;
  }

  const championName = nameOf(champion.team);
  const youAreChampion = you != null && champion.team === you;
  const tieNote = titleTieNote(race, nameOf);
  const shareText = draftShareText({
    code,
    championName,
    championPts: champion.pts,
    tieNote,
    own: ownRow ? { name: nameOf(ownRow.team), place: ownIndex + 1 } : null,
    url: draftLink(code),
  });

  const onShare = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch (e) {
        // Abgebrochen: nichts tun. Sonst (z. B. nicht erlaubt): kopieren.
        if ((e as Error).name === 'AbortError') return;
      }
    }
    toast((await copyText(shareText)) ? 'Ergebnis kopiert' : 'Kopieren nicht möglich');
  };

  return (
    <div className="draft-results">
      {youAreChampion && <Confetti />}

      <section className={`card draft-results__hero ${youAreChampion ? 'is-you' : ''}`} aria-labelledby="draft-results-champion">
        <span className="kicker">
          {leagueName ? `${leagueName} · ` : ''}Online-Draft {code}
        </span>
        <h2 id="draft-results-champion" className="draft-results__champion">
          <span className="draft-results__trophy" aria-hidden="true">
            ★
          </span>
          Meister: {championName}
        </h2>
        <p className="draft-results__line">
          {champion.pts} Pkt · {champion.w}–{champion.d}–{champion.l} · Tore {champion.gf}:{champion.ga} · Team-Score{' '}
          {ratingOf(champion.team)}
        </p>
        {tieNote && <p className="draft-results__tie">{tieNote}</p>}
        {ownRow && (
          <p className="draft-results__you">
            {youAreChampion
              ? 'Glückwunsch – dein Team ist Meister!'
              : `Dein Team ${nameOf(ownRow.team)}: Platz ${ownIndex + 1} · ${ownRow.pts} Pkt`}
          </p>
        )}
        <div className="draft-results__actions">
          <button type="button" className="btn btn--primary" onClick={onShare}>
            Ergebnis teilen
          </button>
        </div>
      </section>

      <div className="result-grid">
        <section className="card" aria-labelledby="draft-results-table">
          <h2 id="draft-results-table" className="section-title">
            Abschlusstabelle
          </h2>
          <div className="table-scroll">
            <table className="league-table draft-results__table">
              <thead>
                <tr>
                  <th scope="col" title="Platz">
                    Pl.
                  </th>
                  <th scope="col" className="left">
                    Team
                  </th>
                  <th scope="col">Team-Score</th>
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
                    <td>{i + 1}</td>
                    <td className="left draft-results__name">
                      {nameOf(r.team)}
                      {teams[r.team]?.cpu && <span className="rating">CPU</span>}
                      {r.team === you && <span className="sr-only"> (dein Team)</span>}
                    </td>
                    <td>{ratingOf(r.team)}</td>
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

        <section className="card" aria-labelledby="draft-results-scorers">
          <h2 id="draft-results-scorers" className="section-title">
            Torjäger
          </h2>
          {scorers.length === 0 ? (
            <p className="muted">Keine Tore in dieser Saison.</p>
          ) : (
            <ol className="scorers draft-results__scorers">
              {scorers.map((s, i) => {
                const p = byId.get(s.pokemonId);
                return (
                  <li key={`${s.teamIndex}-${s.pokemonId}`} className={s.teamIndex === you ? 'is-you' : ''}>
                    <span className="draft-results__rank">{i + 1}.</span>
                    {p ? <Sprite pokemon={p} style={sprite} className="scorers__sprite" /> : <span aria-hidden="true" />}
                    <span className="scorers__name">
                      {pokemonName(s.pokemonId)} <small className="muted">{nameOf(s.teamIndex)}</small>
                      {s.setPieceGoals > 0 && (
                        <small className="draft-results__setpiece">
                          {s.setPieceGoals === s.goals ? 'Standardschütze' : `davon ${s.setPieceGoals} Standard`}
                        </small>
                      )}
                    </span>
                    <span className="scorers__goals" aria-label={`${s.goals} ${s.goals === 1 ? 'Tor' : 'Tore'}`}>
                      {s.goals}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <section aria-labelledby="draft-results-rosters">
        <h2 id="draft-results-rosters" className="section-title">
          Aufstellungen
        </h2>
        <div className="draft-results__rosters">
          {table.map((r, i) => {
            const t = teams[r.team];
            if (!t) return null;
            return (
              <article key={t.id} className={`card draft-results__roster ${r.team === you ? 'is-you' : ''}`}>
                <header className="draft-results__roster-head">
                  <span className="draft-results__place">{i + 1}.</span>
                  <h3 className="draft-results__roster-name">
                    {nameOf(r.team)}
                    {r.team === you && <span className="draft-results__you-tag">Du</span>}
                    {t.cpu && <span className="rating">CPU</span>}
                  </h3>
                  <span className="draft-results__score" title="Team-Score">
                    {ratingOf(r.team)}
                  </span>
                </header>
                <p className="draft-results__roster-meta muted small">
                  {t.formation} · {r.pts} Pkt · Tore {r.gf}:{r.ga}
                </p>
                <Pitch
                  formation={t.formation}
                  slots={t.slots}
                  ss={hasSs ? t.ss : undefined}
                  sprite={sprite}
                  ariaLabel={`Aufstellung ${nameOf(r.team)}`}
                />
              </article>
            );
          })}
        </div>
      </section>

      <details className="card details draft-results__days">
        <summary>Alle Spieltage</summary>
        <ol className="draft-results__daylist">
          {days.map((d) => (
            <li key={d.round} className="draft-results__day">
              <h3 className="draft-results__day-title">{d.round}. Spieltag</h3>
              <FixtureList matches={d.matches} you={you} nameOf={nameOf} pokemonName={pokemonName} className="league-fixtures--plain" />
              {d.byes.length > 0 && <p className="muted small draft-results__byes">Spielfrei: {d.byes.map(nameOf).join(', ')}</p>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
