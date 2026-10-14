import { useCallback, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { draftLink } from '../lib/api/draftClient';
import type { DraftPickLog, DraftTeam } from '../lib/api/draftContract';
import { copyText, downloadBlob } from '../lib/exportImage';
import { draftGrades, draftShareText, draftSteal, leagueTimeline, titleRace, titleTieNote, topScorers } from '../lib/leagueTimeline';
import { lineupImage, slugify } from '../lib/lineupImage';
import { formatRecord, type LeagueResult } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useToast } from '../state/Toast';
import { teamLabel } from '../state/useDraftRoom';
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
  /** Picks des Drafts (für das „Schnäppchen") – fehlt bei sehr alten Ständen */
  picks?: DraftPickLog[];
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
export function DraftResults({ league, teams, ratings, highlight, sprite, code, leagueName, picks = [] }: Props) {
  const t = useT();
  const tx = t.draft.results;
  const c = t.draft.col;
  const { byId, scale } = usePokemonData();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const days = useMemo(() => leagueTimeline(league), [league]);
  const scorers = useMemo(() => topScorers(league).slice(0, TOP_SCORERS), [league]);
  const steal = useMemo(() => draftSteal(picks, teams, byId, scale('all')), [picks, teams, byId, scale]);
  const table = league.table;
  const you = highlight != null && highlight >= 0 && highlight < league.teams.length ? highlight : null;

  // Vereinsnamen der CPU-Teams erst bei der Anzeige übersetzen – gespeichert bleibt der deutsche Name
  const nameOf = useCallback(
    (i: number) => {
      const team = teams[i];
      if (team?.name) return teamLabel(team, t);
      const stored = league.teams[i]?.name;
      return stored ? t.game.club(stored) : `Team ${i + 1}`;
    },
    [teams, league.teams, t],
  );
  const pokemonName = useCallback(
    (id: number) => {
      const p = byId.get(id);
      return p ? t.game.pokemon(p) : `#${id}`;
    },
    [byId, t],
  );
  const ratingOf = (i: number) => ratings[i] ?? league.teams[i]?.rating ?? 0;
  const grades = draftGrades(league.teams.map((_, i) => ratingOf(i)));

  const champion = table[0];
  const race = titleRace(table);
  const ownIndex = you != null ? table.findIndex((r) => r.team === you) : -1;
  const ownRow = ownIndex >= 0 ? table[ownIndex] : null;
  /** Standardschützen-Slot nur, wenn die Liga mit Standardschütze gedraftet hat */
  const hasSs = teams.some((tm) => tm.ss != null);

  if (!champion) {
    return <p className="notice">{tx.none}</p>;
  }

  const championName = nameOf(champion.team);
  const youAreChampion = you != null && champion.team === you;
  const tieNote = titleTieNote(race, nameOf);
  const stealMon = steal ? byId.get(steal.pokemonId) : undefined;
  const stealTeam = steal ? teams.findIndex((tm) => tm.id === steal.teamId) : -1;
  const shareText = draftShareText({
    code,
    championName,
    championPts: champion.pts,
    tieNote,
    own: ownRow ? { name: nameOf(ownRow.team), place: ownIndex + 1 } : null,
    url: draftLink(code),
  });

  /** Eigene Elf als Bild (wie im Builder) – mit Bilanz und Platz dieser Liga */
  const onSaveImage = async () => {
    const team = you != null ? teams[you] : undefined;
    if (!team || !ownRow) return;
    setSaving(true);
    try {
      const name = nameOf(ownRow.team);
      const blob = await lineupImage({
        formation: team.formation,
        slots: team.slots,
        ss: hasSs ? team.ss : undefined,
        sprite,
        byId,
        teamName: name,
        subtitle: `${team.formation} · ${tx.kicker(code)}`,
        result: {
          record: formatRecord({ w: ownRow.w, d: ownRow.d, l: ownRow.l }),
          points: ownRow.pts,
          score: ratingOf(ownRow.team),
          position: ownIndex + 1,
          label: leagueName || tx.kicker(code),
        },
      });
      downloadBlob(blob, `${slugify(name || 'pokemon-elf')}.png`);
      toast(t.builder.imageSaved);
    } catch (e) {
      console.error(e);
      toast(t.builder.imageFailed);
    } finally {
      setSaving(false);
    }
  };

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
    toast((await copyText(shareText)) ? tx.copied : tx.copyFailed);
  };

  return (
    <div className="draft-results">
      {youAreChampion && <Confetti />}

      <section className={`card draft-results__hero ${youAreChampion ? 'is-you' : ''}`} aria-labelledby="draft-results-champion">
        <span className="kicker">
          {leagueName ? `${leagueName} · ` : ''}
          {tx.kicker(code)}
        </span>
        <h2 id="draft-results-champion" className="draft-results__champion">
          <span className="draft-results__trophy" aria-hidden="true">
            ★
          </span>
          {tx.championLabel}
          {championName}
        </h2>
        <p className="draft-results__line">{tx.heroLine(champion, ratingOf(champion.team))}</p>
        {tieNote && <p className="draft-results__tie">{tieNote}</p>}
        {steal && stealMon && stealTeam >= 0 && (
          <p className="draft-results__steal">
            {tx.steal(t.game.pokemon(stealMon), steal.pick + 1, nameOf(stealTeam), t.game.posName[steal.pos])}
          </p>
        )}
        {ownRow && (
          <p className="draft-results__you">
            {youAreChampion ? tx.youChampion : tx.yourPlace(nameOf(ownRow.team), ownIndex + 1, ownRow.pts)}
          </p>
        )}
        <div className="draft-results__actions">
          <button type="button" className="btn btn--primary" onClick={onShare}>
            {tx.share}
          </button>
          {ownRow && (
            <button type="button" className="btn" onClick={onSaveImage} disabled={saving}>
              {saving ? t.builder.savingImage : tx.saveOwnImage}
            </button>
          )}
        </div>
      </section>

      <div className="result-grid">
        <section className="card" aria-labelledby="draft-results-table">
          <h2 id="draft-results-table" className="section-title">
            {tx.finalTable}
          </h2>
          <div className="table-scroll">
            <table className="league-table draft-results__table">
              <thead>
                <tr>
                  <th scope="col" title={c.placeTitle}>
                    {c.place}
                  </th>
                  <th scope="col" className="left">
                    {c.team}
                  </th>
                  <th scope="col">{c.teamScore}</th>
                  <th scope="col" title={tx.gradeTitle}>
                    {tx.grade}
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
                </tr>
              </thead>
              <tbody>
                {table.map((r, i) => (
                  <tr key={r.team} className={r.team === you ? 'is-user' : ''}>
                    <td>{i + 1}</td>
                    <td className="left draft-results__name">
                      {nameOf(r.team)}
                      {teams[r.team]?.cpu && <span className="rating">{t.draft.cpu}</span>}
                      {r.team === you && <span className="sr-only">{tx.yourTeamSr}</span>}
                    </td>
                    <td>{ratingOf(r.team)}</td>
                    <td className="draft-results__grade">{grades[r.team]}</td>
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
            {t.draft.topScorers}
          </h2>
          {scorers.length === 0 ? (
            <p className="muted">{tx.noGoals}</p>
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
                          {s.setPieceGoals === s.goals ? tx.setPieceOnly : tx.setPiecePart(s.setPieceGoals)}
                        </small>
                      )}
                    </span>
                    <span className="scorers__goals" aria-label={tx.goalsAria(s.goals)}>
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
          {tx.lineups}
        </h2>
        <div className="draft-results__rosters">
          {table.map((r, i) => {
            const team = teams[r.team];
            if (!team) return null;
            return (
              <article key={team.id} className={`card draft-results__roster ${r.team === you ? 'is-you' : ''}`}>
                <header className="draft-results__roster-head">
                  <span className="draft-results__place">{t.draft.placeNo(i + 1)}</span>
                  <h3 className="draft-results__roster-name">
                    {nameOf(r.team)}
                    {r.team === you && <span className="draft-results__you-tag">{t.draft.you}</span>}
                    {team.cpu && <span className="rating">{t.draft.cpu}</span>}
                  </h3>
                  <span className="draft-results__score" title={c.teamScore}>
                    {ratingOf(r.team)}
                  </span>
                </header>
                <p className="draft-results__roster-meta muted small">{tx.rosterMeta(team.formation, r.pts, r.gf, r.ga)}</p>
                <Pitch
                  formation={team.formation}
                  slots={team.slots}
                  ss={hasSs ? team.ss : undefined}
                  sprite={sprite}
                  ariaLabel={tx.lineupAria(nameOf(r.team))}
                />
              </article>
            );
          })}
        </div>
      </section>

      <details className="card details draft-results__days">
        <summary>{tx.allMatchdays}</summary>
        <ol className="draft-results__daylist">
          {days.map((d) => (
            <li key={d.round} className="draft-results__day">
              <h3 className="draft-results__day-title">{t.draft.matchday(d.round)}</h3>
              <FixtureList matches={d.matches} you={you} nameOf={nameOf} pokemonName={pokemonName} className="league-fixtures--plain" />
              {d.byes.length > 0 && <p className="muted small draft-results__byes">{t.draft.byes(d.byes.map(nameOf).join(', '))}</p>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
