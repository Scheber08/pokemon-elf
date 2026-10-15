import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { draftLink } from '../lib/api/draftClient';
import type { DraftPickLog, DraftSettings, DraftTeam, ManagerTransfer } from '../lib/api/draftContract';
import { poolStars } from './PoolStars';
import { copyText, downloadBlob } from '../lib/exportImage';
import { bestTransfer, draftGrades, draftShareText, biggestWin, draftSteal, fastestPicker, goalFest, hatTricks, mostCleanSheets, seasonEleven, seasonSwings, headToHead, leagueTimeline, longestWinStreak, recentForm, tableRowClass, titleRace, titleTieNote, topScorers } from '../lib/leagueTimeline';
import { lineupImage, slugify } from '../lib/lineupImage';
import { buildTable, formatRecord, sideTable, type LeagueResult } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useToast } from '../state/Toast';
import { teamLabel } from '../state/useDraftRoom';
import type { SpriteStyle } from '../types';
import { cupPath, cupPens, cupStageOf, cupStatus, cupWinner } from '../lib/cup';
import { Confetti } from './Confetti';
import { CupBracket, CupGroups, cupStatusText } from './CupBracket';
import { FixtureList, FormDots, TableLegend } from './LeagueTicker';
import { ReplayToggle, useMatchReport } from './MatchReport';
import { SeasonStats } from './SeasonStats';
import { TrainerAvatar } from './TrainerAvatar';
import { parseLook } from '../lib/trainer';
import { Pitch } from './Pitch';
import { PlaceChart } from './PlaceChart';
import { SaveImageButton } from './SaveImageButton';
import { TableTimeTravel } from './TableTimeTravel';
import { Sprite } from './Sprite';
import { Segmented } from './Segmented';
import '../styles/league.css';
import { cleanKit } from '../lib/kits';
import { cleanCrest } from '../lib/crest';
import { Crest } from './Crest';
import { shinyTeamBoost } from '../lib/shiny';
import { FORMATIONS } from '../config/formations';
import { positionFit } from '../lib/fit';
import { fastPickCounts, goalReached, limitKindsOf, poolOf, rosterOf } from '../lib/draftEngine';
import { KindMarks } from './DraftBoard';

interface Props {
  /** Shinys der Liga */
  shinies?: readonly number[];
  /** Grüne Zone oben: Aufstiegsplätze (Manager-Karriere unter der 1. Liga) bzw. 1 = nur der Meister */
  zoneTop?: number;
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
  /** Manager-Saison: vollzogene Transfers (für den „Transfer der Saison") */
  transfers?: ManagerTransfer[];
  /** Einstellungen der Liga – für „Wo landeten die Stars?" (die fünf stärksten Pokémon des Pools) */
  settings?: DraftSettings;
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
export function DraftResults({ league, teams, ratings, highlight, sprite, code, leagueName, picks = [], transfers = [], shinies, zoneTop = 1, settings }: Props) {
  const t = useT();
  const tx = t.draft.results;
  const [onlyMine, setOnlyMine] = useState(false);
  const c = t.draft.col;
  const { all, byId, scale } = usePokemonData();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<HTMLElement>(null);
  const bracketRef = useRef<HTMLElement>(null);
  const elevenRef = useRef<HTMLElement>(null);
  const days = useMemo(() => leagueTimeline(league), [league]);
  const allScorers = useMemo(() => topScorers(league), [league]);
  const scorers = allScorers.slice(0, TOP_SCORERS);
  /** Bester Torschütze je Team (Index in league.teams) für die Kader-Karten */
  const teamTopScorer = useMemo(() => {
    const m = new Map<number, (typeof allScorers)[number]>();
    for (const sc of allScorers) if (!m.has(sc.teamIndex)) m.set(sc.teamIndex, sc);
    return m;
  }, [allScorers]);
  // Die fünf Stars des Pools (wie in der Lobby) und wer sie mit welchem Pick bekam
  const stars = useMemo(() => {
    if (!settings || !all.length || !picks.length) return [];
    return poolStars(poolOf(settings, all), scale('all')).map((x) => ({ ...x, pick: picks.find((pk) => pk.pokemonId === x.pokemon.id) }));
  }, [settings, all, picks, scale]);
  const steal = useMemo(() => draftSteal(picks, teams, byId, scale('all')), [picks, teams, byId, scale]);
  const signing = useMemo(
    () => bestTransfer(league.matches, transfers, (id) => teams.findIndex((tm) => tm.id === id)),
    [league, transfers, teams],
  );
  const table = league.table;
  /** Abschlusstabelle: gesamt oder nur Heim- bzw. Auswärtsspiele */
  const [tableView, setTableView] = useState<'all' | 'home' | 'away'>('all');
  const shownTable = useMemo(
    () => (tableView === 'all' || league.cup ? table : sideTable(league.teams, league.matches, tableView)),
    [tableView, table, league],
  );
  const you = highlight != null && highlight >= 0 && highlight < league.teams.length ? highlight : null;
  const duels = useMemo(() => (you != null ? headToHead(league, you) : []), [league, you]);
  const streak = useMemo(() => (league.cup ? null : longestWinStreak(league)), [league]);
  const bigWin = useMemo(() => (league.cup ? null : biggestWin(league.matches)), [league]);
  const fest = useMemo(() => (league.cup ? null : goalFest(league.matches)), [league]);
  const fastest = useMemo(() => fastestPicker(picks), [picks]);
  const fastestTeam = fastest ? teams.findIndex((tm) => tm.id === fastest.teamId) : -1;
  // Blitz-König: meiste Blitz-Picks ⚡ (ab 3, bei Gleichstand das Team weiter vorn in der Teamliste)
  const blitz = useMemo(() => {
    const counts = fastPickCounts(picks);
    const all = teams.map((tm, i) => ({ team: i, n: counts.get(tm.id) ?? 0 }));
    const best = all.reduce<{ team: number; n: number } | null>((a, b) => (!a || b.n > a.n ? b : a), null);
    return best && best.n >= 3 ? best : null;
  }, [picks, teams]);

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
  // Spielbericht (Klick aufs Ergebnis) – Titel wie die Spieltage, KO-Spiele mit Elfmeterschießen
  const report = useMatchReport(
    nameOf,
    pokemonName,
    (m) => {
      const stage = league.cup ? cupStageOf(league.cup, m.round) : null;
      if (stage === 'group') return `${t.draft.cup.stage.group} · ${t.draft.matchday(m.round)}`;
      return stage ? t.draft.cup.stage[stage] : t.draft.matchday(m.round);
    },
    (m) => (league.cup ? cupPens(league.cup, m) : null),
    // 2D-Ansicht: gedraftete Teams mit ihrer Elf, Auffüllteams allgemein
    (i) => (teams[i] ? { formation: teams[i].formation, ids: teams[i].slots, jerseys: teams[i].jerseys, captain: teams[i].captain, kit: cleanKit(teams[i].kit), cheer: teams[i].cheer, crest: cleanCrest(teams[i].crest), shinies } : null),
  );
  const ratingOf = (i: number) => ratings[i] ?? league.teams[i]?.rating ?? 0;
  // Noten nur für gedraftete Teams (die Auffüllteams dahinter haben nicht gedraftet)
  const grades = draftGrades(teams.map((_, i) => ratingOf(i)));

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
  /** KO-Turnier: Baum statt Tabelle, Sieger statt Meister */
  const cup = league.cup ?? null;
  const ownCupStatus = cup && you != null ? cupStatusText(t, cupStatus(cup, you)) : null;
  const finalMatch = cup ? league.matches.find((m) => m.round === cup.rounds.find((r) => r.stage === 'final')?.round) : undefined;
  const cupFinalLine =
    cup && finalMatch && cupWinner(cup) === champion.team
      ? (() => {
          const home = finalMatch.home === champion.team;
          const score = home ? `${finalMatch.hg}:${finalMatch.ag}` : `${finalMatch.ag}:${finalMatch.hg}`;
          const tie = cup.rounds.find((r) => r.stage === 'final')?.ties[0];
          const pens = tie?.pens ? ` (${t.draft.cup.pens(home ? tie.pens.home : tie.pens.away, home ? tie.pens.away : tie.pens.home)})` : '';
          return t.draft.cup.finalLine(score + pens, nameOf(home ? finalMatch.away : finalMatch.home));
        })()
      : null;
  /** Weg des Siegers durch die KO-Runden (ohne das Finale, das steht schon in der Zeile darüber) */
  const championPath = cup && cupFinalLine ? cupPath(cup, league.matches, champion.team).filter((s) => s.stage !== 'final') : [];
  /** Eigene KO-Spiele (wenn man nicht selbst gewonnen hat – dann steht der Weg schon oben) */
  const ownPath = cup && you != null && !youAreChampion ? cupPath(cup, league.matches, you) : [];
  const pathText = (steps: ReturnType<typeof cupPath>) =>
    steps
      .map((s) =>
        t.draft.cup.pathStep(
          t.draft.cup.stage[s.stage],
          `${s.gf}:${s.ga}${s.pens ? ` (${t.draft.cup.pens(s.pens.own, s.pens.opp)})` : ''}`,
          nameOf(s.opponent),
        ),
      )
      .join(' · ');
  const tieNote = cup ? null : titleTieNote(race, nameOf);
  const dayTitle = (round: number) => {
    const stage = cup ? cupStageOf(cup, round) : null;
    if (stage === 'group') return `${t.draft.cup.stage.group} · ${t.draft.matchday(round)}`;
    return stage ? t.draft.cup.stage[stage] : t.draft.matchday(round);
  };
  const stealMon = steal ? byId.get(steal.pokemonId) : undefined;
  // Kapitän mit den meisten Toren (Gleichstand: wie die Torjägerliste)
  const topCaptain = allScorers.find((sc) => sc.goals > 0 && teams[sc.teamIndex]?.captain === sc.pokemonId);
  const topCaptainMon = topCaptain ? byId.get(topCaptain.pokemonId) : undefined;
  const stealTeam = steal ? teams.findIndex((tm) => tm.id === steal.teamId) : -1;
  const shareText = draftShareText({
    code,
    championName,
    championPts: champion.pts,
    tieNote,
    own: ownRow
      ? { name: nameOf(ownRow.team), place: ownIndex + 1, shinies: you != null && teams[you] ? rosterOf(teams[you]).filter((id) => shinies?.includes(id)).length : 0 }
      : null,
    url: draftLink(code),
    ...(cup ? { cup: { ownStatus: ownCupStatus, final: cupFinalLine } } : {}),
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
        jerseys: team.jerseys,
        captain: team.captain ?? null,
        crest: cleanCrest(team.crest),
        shinies,
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
      {report.element}
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
          {cup ? t.draft.cup.winnerLabel : tx.championLabel}
          {championName}
        </h2>
        <p className="draft-results__line">{cupFinalLine ?? tx.heroLine(champion, ratingOf(champion.team))}</p>
        {championPath.length > 0 && (
          <p className="draft-results__path muted small">
            {t.draft.cup.pathTitle}: {pathText(championPath)}
          </p>
        )}
        {tieNote && <p className="draft-results__tie">{tieNote}</p>}
        {steal && stealMon && stealTeam >= 0 && (
          <p className="draft-results__steal">
            {tx.steal(t.game.pokemon(stealMon), steal.pick + 1, nameOf(stealTeam), t.game.posName[steal.pos])}
          </p>
        )}
        {topCaptain && topCaptainMon && (
          <p className="draft-results__steal">
            {tx.topCaptain(t.game.pokemon(topCaptainMon), nameOf(topCaptain.teamIndex), topCaptain.goals)}
          </p>
        )}
        {signing && byId.get(signing.pokemonId) && (
          <p className="draft-results__steal">
            {tx.signing(
              t.game.pokemon(byId.get(signing.pokemonId)!),
              nameOf(signing.teamIndex),
              signing.matchday,
              t.draft.manager.starLine(signing.goals, signing.assists),
            )}
          </p>
        )}
        {ownRow && (
          <p className="draft-results__you">
            {cup
              ? youAreChampion
                ? t.draft.cup.youWinner
                : t.draft.cup.yourCup(nameOf(ownRow.team), ownCupStatus ?? '')
              : youAreChampion
                ? tx.youChampion
                : tx.yourPlace(nameOf(ownRow.team), ownIndex + 1, ownRow.pts)}
          </p>
        )}
        {ownRow && !cup && you != null && (() => {
          // Eigener höchster Sieg und höchste Niederlage (aus eigener Sicht, Ergebnis eigene Tore zuerst)
          const own = league.matches.filter((m) => m.home === you || m.away === you);
          const view = (m: (typeof own)[number]) => (m.home === you ? { gf: m.hg, ga: m.ag, opp: m.away } : { gf: m.ag, ga: m.hg, opp: m.home });
          const best = biggestWin(own.filter((m) => view(m).gf > view(m).ga));
          const worst = biggestWin(own.filter((m) => view(m).gf < view(m).ga));
          if (!best && !worst) return null;
          return (
            <p className="draft-results__extremes muted small">
              {best && tx.ownBest(`${view(best).gf}:${view(best).ga}`, nameOf(view(best).opp))}
              {best && worst && ' · '}
              {worst && tx.ownWorst(`${view(worst).gf}:${view(worst).ga}`, nameOf(view(worst).opp))}
            </p>
          );
        })()}
        {you != null && teams[you] && (() => {
          // Eigener bester und schwächster Pick nach Positions-Fit (Feldspieler, Position am Saisonende)
          const team = teams[you];
          const sc = scale('all');
          const rated = FORMATIONS[team.formation].slots.flatMap((d, j) => {
            const p = team.slots[j] != null ? byId.get(team.slots[j]!) : undefined;
            return p ? [{ p, pos: d.pos, fit: Math.round(positionFit(p, d.pos, sc)) }] : [];
          });
          if (rated.length < 2) return null;
          const top = rated.reduce((a, b) => (b.fit > a.fit ? b : a));
          const low = rated.reduce((a, b) => (b.fit < a.fit ? b : a));
          if (top.fit === low.fit) return null;
          const pickNo = (id: number) => {
            const k = picks.findIndex((x) => x.pokemonId === id);
            return k >= 0 ? picks[k].pick + 1 : null;
          };
          const line = (x: (typeof rated)[number]) => tx.pickLine(t.game.pokemon(x.p), t.game.posShort[x.pos], x.fit, pickNo(x.p.id));
          return (
            <p className="draft-results__ownpicks muted small">
              {tx.ownTopPick(line(top))} · {tx.ownLowPick(line(low))}
            </p>
          );
        })()}
        {ownRow && !cup && you != null && teams[you]?.goal && (
          <p className="draft-results__goal">
            {goalReached(teams[you].goal!, ownIndex + 1, table.length)
              ? t.online.goalReached(t.online.goal[teams[you].goal!])
              : t.online.goalMissed(t.online.goal[teams[you].goal!])}
          </p>
        )}
        {ownPath.length > 0 && (
          <p className="draft-results__path muted small">
            {t.draft.cup.ownPathTitle}: {pathText(ownPath)}
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

      {cup && (
        <section className="card" aria-labelledby="draft-results-bracket" ref={bracketRef}>
          <div className="draft-results__table-head">
            <h2 id="draft-results-bracket" className="section-title">
              {t.draft.cup.bracket}
            </h2>
            <SaveImageButton
              target={bracketRef}
              filename={`${slugify(leagueName || code)}-turnierbaum.png`}
              label={tx.saveTable}
              aria={tx.saveBracketAria}
            />
          </div>
          <CupBracket cup={cup} matches={league.matches} you={you} nameOf={nameOf} />
        </section>
      )}
      {cup?.groups && (
        <section className="card" aria-labelledby="draft-results-groups">
          <h2 id="draft-results-groups" className="section-title">
            {t.draft.cup.groupsTitle}
          </h2>
          <CupGroups teams={league.teams} matches={league.matches} groups={cup.groups} you={you} nameOf={nameOf} />
        </section>
      )}

      <div className="result-grid">
        <section className="card" aria-labelledby="draft-results-table" ref={tableRef}>
          <div className="draft-results__table-head">
            <h2 id="draft-results-table" className="section-title">
              {cup ? t.draft.cup.standings : tx.finalTable}
            </h2>
            <SaveImageButton
              target={tableRef}
              filename={`${slugify(leagueName || code)}-tabelle.png`}
              label={tx.saveTable}
              aria={tx.saveTableAria}
            />
          </div>
          {!cup && (
            <Segmented
              label={tx.tableView}
              hideLabel
              value={tableView}
              onChange={setTableView}
              options={(['all', 'home', 'away'] as const).map((v) => ({ value: v, label: tx.tableViews[v] }))}
            />
          )}
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
                  {!cup && (
                    <th scope="col" title={c.formTitle} className="league-live__form-col">
                      {c.form}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shownTable.map((r, i) => (
                  <tr
                    key={r.team}
                    className={cup || tableView !== 'all' ? (r.team === you ? 'is-user' : '') : tableRowClass(r.team === you, i + 1, table.length, zoneTop)}
                  >
                    <td>{i + 1}</td>
                    <td className="left draft-results__name">
                      {teams[r.team]?.trainer && (
                        <TrainerAvatar look={parseLook(teams[r.team].trainer)} size={22} companion={false} className="draft-trainer" />
                      )}
                      {teams[r.team]?.crest && cleanCrest(teams[r.team].crest) && <Crest crest={cleanCrest(teams[r.team].crest)!} size={16} />}
                      {nameOf(r.team)}
                      {teams[r.team]?.cpu && <span className="rating">{t.draft.cpu}</span>}
                      {!teams[r.team] && league.teams[r.team]?.player && (
                        <small className="muted draft-results__player" title={tx.fillPlayerTitle}>
                          {league.teams[r.team].playerEntry ? (
                            <Link to={`/spieler/${league.teams[r.team].playerEntry}`}>{league.teams[r.team].player}</Link>
                          ) : (
                            league.teams[r.team].player
                          )}
                        </small>
                      )}
                      {r.team === you && <span className="sr-only">{tx.yourTeamSr}</span>}
                    </td>
                    <td>{ratingOf(r.team)}</td>
                    <td className="draft-results__grade">{grades[r.team] ?? '–'}</td>
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
                    {!cup && (
                      <td className="league-live__form-col">
                        <FormDots form={recentForm(league.matches, r.team, Infinity)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!cup && tableView === 'all' && <TableLegend total={table.length} top={zoneTop} />}
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
                      {pokemonName(s.pokemonId)}{' '}
                      {teams[s.teamIndex]?.captain === s.pokemonId && (
                        <>
                          <span className="captain-badge" title={t.captain.title}>
                            C<span className="sr-only"> – {t.captain.title}</span>
                          </span>{' '}
                        </>
                      )}
                      <small className="muted">{nameOf(s.teamIndex)}</small>
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

        <SeasonStats league={league} you={you} nameOf={nameOf} tabs={['assists', 'points', 'teams']} captains={teams.map((tm) => tm?.captain)} />

        {teams.length >= 2 && (() => {
          // Elf der Saison: beste Scorer je Position über alle gedrafteten Teams
          const eleven = seasonEleven(league, teams, byId, scale('all'));
          if (!eleven) return null;
          return (
            <section className="card draft-results__eleven" aria-labelledby="draft-results-eleven" ref={elevenRef}>
              <div className="draft-results__table-head">
                <h2 id="draft-results-eleven" className="section-title">
                  {tx.elevenTitle}
                </h2>
                <SaveImageButton
                  target={elevenRef}
                  filename={`${slugify(leagueName || code)}-elf-der-saison.png`}
                  label={tx.saveTable}
                  aria={tx.saveElevenAria}
                />
              </div>
              <p className="muted small">{tx.elevenNote(eleven.formation)}</p>
              <Pitch formation={eleven.formation} slots={eleven.slots} sprite={sprite} ariaLabel={tx.elevenTitle} jerseys={false} shinies={shinies} />
              <ul className="draft-results__eleven-list small">
                {eleven.slots.map((id, j) => {
                  const p = byId.get(id);
                  return (
                    <li key={id} className={eleven.teamOf[j] === you ? 'is-mine' : ''}>
                      {p ? t.game.pokemon(p) : `#${id}`} <span className="muted">({nameOf(eleven.teamOf[j])})</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })()}

        {!cup && table.length > 1 && (
          <section className="card" aria-labelledby="draft-results-records">
            <h2 id="draft-results-records" className="section-title">
              {tx.records}
            </h2>
            <dl className="draft-records">
              {(() => {
                const attack = table.reduce((a, b) => (b.gf > a.gf ? b : a));
                const defense = table.reduce((a, b) => (b.ga < a.ga ? b : a));
                // Meiste Unentschieden (ab 4) – bei Gleichstand das besser platzierte Team
                const draws = table.reduce((a, b) => (b.d > a.d ? b : a));
                return (
                  <>
                    <div>
                      <dt>{tx.recordAttack}</dt>
                      <dd>{tx.recordGoals(nameOf(attack.team), attack.gf)}</dd>
                    </div>
                    <div>
                      <dt>{tx.recordDefense}</dt>
                      <dd>{tx.recordConceded(nameOf(defense.team), defense.ga)}</dd>
                    </div>
                    {draws.d >= 4 && (
                      <div>
                        <dt>{tx.recordDraws}</dt>
                        <dd>{tx.recordDrawsLine(nameOf(draws.team), draws.d)}</dd>
                      </div>
                    )}
                    {(() => {
                      const clean = mostCleanSheets(league.matches, table.map((r) => r.team));
                      return clean ? (
                        <div>
                          <dt>{tx.recordClean}</dt>
                          <dd>{tx.recordCleanLine(nameOf(clean.team), clean.n)}</dd>
                        </div>
                      ) : null;
                    })()}
                  </>
                );
              })()}
              {/* Herbstmeister: Tabellenführer nach der Hinrunde (doppelte Runde, mindestens 4 Spieltage) */}
              {days.length >= 4 && days.length % 2 === 0 && (() => {
                const half = days[days.length / 2 - 1];
                // Rückrunden-Tabelle: nur die Spiele nach der Hinrunde (Gleichstand wie in der Tabelle)
                const second = buildTable(league.teams, league.matches.filter((m) => m.round > half.round))[0];
                return (
                  <>
                    <div>
                      <dt>{tx.recordHalf}</dt>
                      <dd>{tx.recordHalfLine(nameOf(half.leader.team), half.leader.pts, half.round)}</dd>
                    </div>
                    {second && (
                      <div>
                        <dt>{tx.recordSecond}</dt>
                        <dd>{tx.recordSecondLine(nameOf(second.team), second.pts)}</dd>
                      </div>
                    )}
                  </>
                );
              })()}
              {bigWin && (
                <div>
                  <dt>{tx.recordWin}</dt>
                  <dd>{tx.recordWinLine(nameOf(bigWin.home), `${bigWin.hg}:${bigWin.ag}`, nameOf(bigWin.away), bigWin.round)}</dd>
                </div>
              )}
              {(() => {
                // Hattricks der Saison: Anzahl und der erste
                const hats = hatTricks(league.matches);
                const first = hats[0];
                const mon = first ? byId.get(first.pokemonId) : undefined;
                return first && mon ? (
                  <div>
                    <dt>{tx.recordHatTricks}</dt>
                    <dd>{tx.recordHatTricksLine(hats.length, t.game.pokemon(mon), nameOf(first.team), first.round)}</dd>
                  </div>
                ) : null;
              })()}
              {fest && fest !== bigWin && (
                <div>
                  <dt>{tx.recordFest}</dt>
                  <dd>{tx.recordWinLine(nameOf(fest.home), `${fest.hg}:${fest.ag}`, nameOf(fest.away), fest.round)}</dd>
                </div>
              )}
              {blitz && (
                <div>
                  <dt>{tx.recordBlitz}</dt>
                  <dd>{tx.recordBlitzLine(nameOf(blitz.team), blitz.n)}</dd>
                </div>
              )}
              {fastest && fastestTeam >= 0 && (
                <div>
                  <dt>{tx.recordFastest}</dt>
                  <dd>{tx.recordFastestLine(nameOf(fastestTeam), Math.max(1, Math.round(fastest.avgMs / 1000)))}</dd>
                </div>
              )}
              {(() => {
                const { up, down } = seasonSwings(table.map((r) => r.team), teams.map((_, i) => ratingOf(i)));
                return (
                  <>
                    {up && up.delta >= 2 && (
                      <div>
                        <dt>{tx.recordSurprise}</dt>
                        <dd>{tx.recordSwingLine(nameOf(up.team), up.delta)}</dd>
                      </div>
                    )}
                    {down && down.delta <= -2 && (
                      <div>
                        <dt>{tx.recordFlop}</dt>
                        <dd>{tx.recordSwingLine(nameOf(down.team), down.delta)}</dd>
                      </div>
                    )}
                  </>
                );
              })()}
              {streak && streak.length >= 3 && (
                <div>
                  <dt>{tx.recordStreak}</dt>
                  <dd>{tx.streak(nameOf(streak.team), streak.length, streak.from, streak.to)}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {!cup && you != null && days.length > 1 && (
          <section className="card" aria-labelledby="draft-results-places">
            <h2 id="draft-results-places" className="section-title">
              {tx.placeChart}
            </h2>
            <PlaceChart places={days.map((d) => d.places[you])} teams={league.teams.length} />
          </section>
        )}

        {!cup && days.length > 1 && (
          <section className="card" aria-labelledby="draft-results-timetravel">
            <h2 id="draft-results-timetravel" className="section-title">
              {tx.timeTravel}
            </h2>
            <TableTimeTravel days={days} you={you} nameOf={nameOf} />
          </section>
        )}

        {duels.length > 0 && (
          <section className="card" aria-labelledby="draft-results-duels">
            <h2 id="draft-results-duels" className="section-title">
              {tx.duels}
            </h2>
            <div className="table-scroll">
              <table className="league-table draft-results__duels">
                <thead>
                  <tr>
                    <th scope="col" className="left">
                      {tx.duelsOpponent}
                    </th>
                    <th scope="col" className="left">
                      {tx.duelsScores}
                    </th>
                    <th scope="col" title={tx.duelsRecordTitle}>
                      {tx.duelsRecord}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {duels.map((d) => (
                    <tr key={d.opponent} className={d.w > d.l ? 'is-up' : d.l > d.w ? 'is-down' : ''}>
                      <th scope="row" className="left">
                        {nameOf(d.opponent)}
                      </th>
                      <td className="left">
                        {d.scores.map((x, i) => (
                          <span key={i} className="draft-results__duel" title={x.home ? tx.duelHome : tx.duelAway}>
                            {x.gf}:{x.ga}
                          </span>
                        ))}
                      </td>
                      <td>
                        <strong>{formatRecord({ w: d.w, d: d.d, l: d.l })}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
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
                {!cup && team.goal && (
                  <p className="small draft-results__roster-goal">
                    🎯 {t.online.goal[team.goal]} {goalReached(team.goal, i + 1, table.length) ? '✓' : '✗'}
                  </p>
                )}
                {(() => {
                  // Shinys dieses Teams mit ihrem Team-Bonus
                  const own = rosterOf(team).filter((id) => shinies?.includes(id));
                  if (!own.length) return null;
                  const parts = own.flatMap((id) => {
                    const p = byId.get(id);
                    return p ? [`${t.game.pokemon(p)} +${shinyTeamBoost(p)}`] : [];
                  });
                  return <p className="draft-results__roster-meta small">✨ {parts.join(', ')}</p>;
                })()}
                {teamTopScorer.has(r.team) && (
                  <p className="draft-results__roster-meta small">
                    {tx.teamTopScorer(pokemonName(teamTopScorer.get(r.team)!.pokemonId), teamTopScorer.get(r.team)!.goals)}
                  </p>
                )}
                <Pitch
                  formation={team.formation}
                  slots={team.slots}
                  ss={hasSs ? team.ss : undefined}
                  sprite={sprite}
                  ariaLabel={tx.lineupAria(nameOf(r.team))}
                  jerseys={team.jerseys}
                  captain={team.captain ?? null}
                  shinies={shinies}
                />
              </article>
            );
          })}
        </div>
      </section>

      {stars.length > 0 && (
        <section className="card draft-results__stars" aria-labelledby="draft-results-stars-title">
          <h2 id="draft-results-stars-title" className="section-title">
            ⭐ {tx.starsTitle}
          </h2>
          <ol className="pool-stars__list">
            {stars.map((x) => {
              const ti = x.pick ? teams.findIndex((tm) => tm.id === x.pick!.teamId) : -1;
              return (
                <li key={x.pokemon.id} className={ti >= 0 && ti === you ? 'is-you' : ''}>
                  <Sprite pokemon={x.pokemon} style={sprite} className="pool-stars__sprite" />
                  <span className="pool-stars__name">
                    <strong>{t.game.pokemon(x.pokemon)}</strong>
                    <KindMarks kinds={limitKindsOf(x.pokemon)} />
                  </span>
                  <span className="pool-stars__pos small">
                    {x.pick && ti >= 0 ? tx.starsPick(nameOf(ti), x.pick.pick + 1) : <span className="muted">{tx.starsFree}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {picks.length > 0 && (
        <details className="card details draft-results__picks">
          <summary>{tx.allPicks(picks.length)}</summary>
          {you != null && (
            <label className="draft-results__mine">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> {tx.onlyMyPicks}
            </label>
          )}
          <ol className="draft-results__picklist">
            {picks.filter((pk) => !onlyMine || teams.findIndex((tm) => tm?.id === pk.teamId) === you).map((pk) => {
              const ti = teams.findIndex((tm) => tm?.id === pk.teamId);
              const p = byId.get(pk.pokemonId);
              return (
                <li key={pk.pick} className={ti === you ? 'is-you' : ''}>
                  <span className="muted" title={tx.pickRound(Math.floor(pk.pick / teams.length) + 1)}>
                    #{pk.pick + 1} · R{Math.floor(pk.pick / teams.length) + 1}
                  </span>{' '}
                  <strong>{p ? t.game.pokemon(p) : `#${pk.pokemonId}`}</strong>
                  {p && <KindMarks kinds={limitKindsOf(p)} />}
                  {pk.shiny && <span title={t.shiny.title}> ✨</span>} → {ti >= 0 ? nameOf(ti) : '?'}
                  {pk.auto && <small className="muted">{t.draft.board.auto}</small>}
                </li>
              );
            })}
          </ol>
        </details>
      )}

      <details className="card details draft-results__days">
        <summary>{tx.allMatchdays}</summary>
        <ReplayToggle />
        <ol className="draft-results__daylist">
          {days.map((d) => (
            <li key={d.round} className="draft-results__day">
              <h3 className="draft-results__day-title">{dayTitle(d.round)}</h3>
              <FixtureList
                matches={d.matches}
                you={you}
                nameOf={nameOf}
                pokemonName={pokemonName}
                className="league-fixtures--plain"
                pensOf={cup ? (m) => cupPens(cup, m) : undefined}
                onOpen={report.open}
              />
              {!cup && d.byes.length > 0 && <p className="muted small draft-results__byes">{t.draft.byes(d.byes.map(nameOf).join(', '))}</p>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
