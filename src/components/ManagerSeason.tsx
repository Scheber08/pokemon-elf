import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FORMATION_IDS, FORMATIONS } from '../config/formations';
import { localeOf, useLang, useT } from '../i18n';
import type { DraftSnapshot, DraftTeam, ManagerSnapshot, ManagerLineup, ManagerOffer, ManagerTransfer } from '../lib/api/draftContract';
import { goalReached, rosterOf } from '../lib/draftEngine';
import { loadTips, MATCH_TIPS, saveTip, tipScore } from '../lib/managerTips';
import { currentRun, hatTricks, TABLE_BOTTOM_MIN, TABLE_BOTTOM_ZONE, leagueTimeline, matchFor, playerOfRound, recentForm, storedLeague, tableRowClass, tableZone, leaderSince, lateWinner, biggestUpset, routOf, comebackOf, titleChance, goalMilestones, scoringRuns, goalsByLine, GOAL_LINES, distinctScorers, bestGoalPhase, fanMood, winRun, attackDefenseRanks, expectedCrowd, STADIUM_CAPACITY, weatherFor } from '../lib/leagueTimeline';
import { liveDuration, liveMinute, partialMatch } from '../lib/liveMatchday';
import { showNotify } from '../lib/notify';
import { shinyTeamBoost } from '../lib/shiny';
import { bestLineup, FORM_FIT, formFit, kickoffAt, lineupScore, scheduleOf, squadStrength } from '../lib/manager';
import { buildTable, formatMinute, formatRecord, sideTable, type LeagueResult, type Match } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { teamLabel, type DraftRoom } from '../state/useDraftRoom';
import type { FormationId, Pokemon, PosCode } from '../types';
import { PosBadge } from './Badges';
import { BenchRow } from './BenchRow';
import { Segmented } from './Segmented';
import { FixtureList, FormDots, TableLegend, Trend } from './LeagueTicker';
import { ReplayToggle, useMatchReport } from './MatchReport';
import { CaptainPicker } from './CaptainPicker';
import { JerseyEditor } from './JerseyEditor';
import { PlaceChart } from './PlaceChart';
import { SeasonStats } from './SeasonStats';
import { Sprite } from './Sprite';
import { Pitch, SS_INDEX, type SlotState } from './Pitch';
import { TradePanel, TransferMarket } from './ManagerMarket';
import { FormationMini } from './FormationMini';
import { KitPicker } from './KitPicker';
import '../styles/draft.css';
import { cleanKit } from '../lib/kits';
import { CrestEditor } from './CrestEditor';
import { cleanCrest, type Crest as CrestData } from '../lib/crest';
import { absentAt, CUP_MATCHDAYS, type ManagerAbsence } from '../lib/manager';
import { Crest } from './Crest';

/** Auswahl beim Tauschen: ein Feld-/SS-Platz oder ein Bankspieler */
type Selection = { kind: 'slot'; index: number } | { kind: 'bench'; id: number } | null;

/** Tagesform als Pfeile (▲▲ … ▼▼) */
function FormMark({ value }: { value: number }) {
  const t = useT();
  const text = value > 0 ? '▲'.repeat(value) : value < 0 ? '▼'.repeat(-value) : '–';
  return (
    <span className={`manager-form manager-form--${value > 0 ? 'up' : value < 0 ? 'down' : 'flat'}`} title={t.draft.manager.formTitle(value)}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{t.draft.manager.formTitle(value)}</span>
    </span>
  );
}

/** Erinnerung so lange vor dem Anpfiff */
const KICKOFF_REMINDER_MS = 5 * 60_000;

/** Uhrzeit (Serverzeit) im Sekundentakt – für den Countdown bis zum Anpfiff. */
export function useServerNow(clockOffset: number): number {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + clockOffset), 1000);
    return () => window.clearInterval(id);
  }, [clockOffset]);
  return now;
}

/**
 * Manager-Saison (Phase „season"): Countdown bis zum nächsten Spieltag, eigene Aufstellung
 * (tauschen auf dem Feld und mit der Bank, Formation, automatisch), Kader mit Tagesform,
 * Ergebnisse des letzten Spieltags, nächste Paarungen und die Tabelle.
 */
export function ManagerSeason({ room, readOnly }: { room: DraftRoom; readOnly: boolean }) {
  const t = useT();
  const lang = useLang();
  const tx = t.draft.manager;
  const { byId, scale } = usePokemonData();
  const s = room.state!;
  const m = s.manager ?? null;
  const league = useMemo(() => storedLeague(s.league, s.teams.length), [s.league, s.teams.length]);
  const now = useServerNow(room.clockOffset);

  const meIndex = room.me ? s.teams.findIndex((tm) => tm.id === room.me!.id) : -1;
  const you = meIndex >= 0 ? meIndex : null;
  // Eigene Tipps auf das nächste Spiel (nur auf diesem Gerät)
  const [tips, setTips] = useState(() => loadTips(s.code));
  const nameOf = useCallback(
    (i: number) => {
      const team = s.teams[i];
      if (team) return teamLabel(team, t);
      const stored = league?.teams[i]?.name;
      return stored ? t.game.club(stored) : `Team ${i + 1}`;
    },
    [s.teams, league, t],
  );
  const pokemonName = useCallback((id: number) => {
    const p = byId.get(id);
    return p ? t.game.pokemon(p) : `#${id}`;
  }, [byId, t]);

  // 2D-Ansicht mit der Aufstellung dieses Spieltags (ältere Stände: die aktuelle)
  // Neuer Spieltag gespielt, während die Seite offen ist (Tab im Hintergrund): Hinweis mit dem eigenen Ergebnis
  const { notify, sprite } = useSettings();
  const playedNow = m?.played ?? 0;
  const seenPlayed = useRef(playedNow);
  useEffect(() => {
    if (playedNow <= seenPlayed.current) return;
    seenPlayed.current = playedNow;
    if (!notify || you == null || !league) return;
    const r = matchFor(
      league.matches.filter((x) => x.round === playedNow),
      you,
    );
    // Läuft der Spieltag noch live, nichts verraten – nur Bescheid geben
    const live = s.season ? liveMinute(kickoffAt(s.season, playedNow), now, liveDuration(s.season.stepMs)) != null : false;
    const place = league.table.findIndex((x) => x.team === you) + 1;
    const body = live
      ? t.draft.manager.notifyLive(playedNow)
      : (r
          ? t.draft.manager.notifyResult(t.draft.outcome[r.outcome], r.gf, r.ga, nameOf(r.opponent))
          : t.draft.manager.notifyPlayed(playedNow)) + (place > 0 ? ` ${t.draft.manager.notifyPlace(place)}` : '');
    showNotify(t.draft.manager.notifyHeading(s.settings.name || t.online.leagueFallback(s.code), playedNow), body, `manager-${s.code}`);
  }, [playedNow]);

  // Erinnerung kurz vor dem Anpfiff (einmal je Spieltag, nur bei Spieltagen ab einer Stunde Abstand):
  // noch Zeit für Aufstellung und Transfers
  const remindedFor = useRef(-1);
  const msToKickoff = m?.nextAt != null ? m.nextAt - now : null;
  useEffect(() => {
    if (msToKickoff == null || msToKickoff <= 0 || msToKickoff > KICKOFF_REMINDER_MS) return;
    if (remindedFor.current === playedNow) return;
    remindedFor.current = playedNow;
    if (!notify || you == null || readOnly || (s.settings.matchdayMinutes ?? 0) < 60) return;
    showNotify(
      t.draft.manager.notifySoonHeading(s.settings.name || t.online.leagueFallback(s.code), playedNow + 1),
      t.draft.manager.notifySoon(Math.ceil(msToKickoff / 60_000)),
      `manager-${s.code}`,
    );
  }, [msToKickoff != null && msToKickoff > 0 && msToKickoff <= KICKOFF_REMINDER_MS, playedNow]);

  // Neues Tausch-Angebot an das eigene Team (Tab im Hintergrund): Hinweis
  const myId = room.me?.id ?? null;
  const incomingIds = (m?.offers ?? []).filter((o) => o.to === myId).map((o) => o.id);
  const seenOffers = useRef<Set<number> | null>(null);
  useEffect(() => {
    const before = seenOffers.current;
    seenOffers.current = new Set(incomingIds);
    if (!before || !notify || readOnly) return;
    const fresh = (m?.offers ?? []).find((o) => o.to === myId && !before.has(o.id));
    if (!fresh) return;
    const from = s.teams.find((tm) => tm.id === fresh.from);
    const p = (id: number) => (byId.get(id) ? t.game.pokemon(byId.get(id)!) : `#${id}`);
    showNotify(
      t.draft.manager.notifyOfferHeading(s.settings.name || t.online.leagueFallback(s.code)),
      t.draft.manager.offerIn(from ? teamLabel(from, t) : '?', p(fresh.give), p(fresh.get)),
      `manager-offer-${s.code}`,
    );
  }, [incomingIds.join(',')]);

  // Eigenes Angebot beantwortet (Tab im Hintergrund): angenommen, wenn der Tausch im Protokoll steht, sonst abgelehnt
  const outgoing = (m?.offers ?? []).filter((o) => o.from === myId);
  const prevOutgoing = useRef<ManagerOffer[] | null>(null);
  useEffect(() => {
    const before = prevOutgoing.current;
    prevOutgoing.current = outgoing;
    if (!before || !notify || readOnly) return;
    for (const o of before) {
      if (outgoing.some((x) => x.id === o.id)) continue;
      const accepted = (m?.transfers ?? []).some((x) => x.teamId === o.from && x.with === o.to && x.out === o.give && x.in === o.get);
      const to = s.teams.find((tm) => tm.id === o.to);
      const p = (id: number) => (byId.get(id) ? t.game.pokemon(byId.get(id)!) : `#${id}`);
      showNotify(
        t.draft.manager.notifyOfferHeading(s.settings.name || t.online.leagueFallback(s.code)),
        (accepted ? t.draft.manager.offerAccepted : t.draft.manager.offerDeclined)(to ? teamLabel(to, t) : '?', p(o.give), p(o.get)),
        `manager-offer-${s.code}`,
      );
    }
  }, [outgoing.map((o) => o.id).join(',')]);

  const report = useMatchReport(nameOf, pokemonName, (x) => tx.next(x.round), undefined, (i, match) => {
    const team = s.teams[i];
    if (!team) return null;
    const l = m?.playedLineups?.[match.round]?.[team.id] ?? m?.lineups[team.id];
    return l ? { formation: l.formation, ids: l.slots, jerseys: team.jerseys, captain: team.captain, kit: cleanKit(team.kit), cheer: team.cheer, crest: cleanCrest(team.crest), shinies: s.shinies } : null;
  });

  if (!m || !league) {
    return (
      <div className="boot" role="status">
        <div className="boot__ball" aria-hidden="true" />
        <p>{t.draft.season.preparing}</p>
      </div>
    );
  }

  // Live: Der zuletzt gespielte Spieltag läuft nach dem Anpfiff noch einige Minuten in Echtzeit ab
  const liveMin =
    m.played > 0 && s.season ? liveMinute(kickoffAt(s.season, m.played), now, liveDuration(s.season.stepMs)) : null;
  const shown: LeagueResult =
    liveMin == null
      ? league
      : (() => {
          const matches = league.matches.map((x) => (x.round === m.played ? partialMatch(x, liveMin) : x));
          return { ...league, matches, table: buildTable(league.teams, matches) };
        })();

  const nextNo = m.played + 1;
  const schedule = scheduleOf(m, league.teams.length);
  const upcoming: Match[] = (schedule[m.played] ?? []).map(([home, away]) => ({
    round: nextNo,
    home,
    away,
    hg: 0,
    ag: 0,
    homeScorers: [],
    awayScorers: [],
  }));
  const last = m.played > 0 ? shown.matches.filter((x) => x.round === m.played) : [];
  const lastTransfers = (m.transfers ?? []).filter((x) => x.matchday === m.played);
  const star = liveMin == null ? playerOfRound(last) : null;
  // Ein Tausch steht zweimal im Protokoll (je Team) – angezeigt wird er einmal
  const shownOnce = (x: ManagerTransfer) => !x.with || x.teamId < x.with;
  const teamName = (id: string) => {
    const tm = s.teams.find((y) => y.id === id);
    return tm ? teamLabel(tm, t) : '?';
  };
  const transferItem = (x: ManagerTransfer) => (
    <li key={`${x.matchday}-${x.teamId}-${x.in}`}>
      {x.with
        ? tx.tradeLine(teamName(x.teamId), pokemonName(x.out), teamName(x.with), pokemonName(x.in))
        : tx.transferLine(teamName(x.teamId), pokemonName(x.in), pokemonName(x.out))}
      {x.shiny && (
        <span title={t.shiny.title}>
          {' '}
          ✨<span className="sr-only">{t.shiny.title}</span>
        </span>
      )}
    </li>
  );
  // Nächster Gegner: Tabellenplatz und Form (letzte fünf Spiele)
  const myNext = you != null ? upcoming.find((x) => x.home === you || x.away === you) : undefined;
  const rival = myNext ? (myNext.home === you ? myNext.away : myNext.home) : null;
  const rivalPlace = rival != null ? shown.table.findIndex((r) => r.team === rival) + 1 : 0;
  const when = m.nextAt != null ? new Date(m.nextAt - room.clockOffset).toLocaleString(localeOf(lang), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="manager">
      {report.element}
      <section className="card manager__status" aria-live="polite">
        <span className="kicker">
          {tx.kicker}
          {s.career && ` · ${t.online.careerSeason(s.career.season, t.online.careerTier[s.career.tier])}`}
        </span>
        <h2 className="section-title">{tx.played(m.played, m.total)}</h2>
        {you != null && m.played > 0 && (() => {
          // Eigener Tabellenplatz mit Punkten und Veränderung zum Vorspieltag
          const at = shown.table.findIndex((r) => r.team === you);
          if (at < 0) return null;
          const delta = m.played >= 2 ? leagueTimeline(shown).at(-1)?.delta?.[you] : undefined;
          return (
            <p className="manager__place">
              {tx.yourPlace(at + 1, shown.table[at].pts)} {delta != null && <Trend delta={delta} />}
              {shown.table.length > 1 && (
                <span className="muted">
                  {' · '}
                  {at === 0
                    ? tx.leadBy(shown.table[0].pts - shown.table[1].pts)
                    : tx.behindTop(shown.table[0].pts - shown.table[at].pts)}
                </span>
              )}
              {(() => {
                // Zone wie in der Tabelle: Aufstiegs-/Meisterplatz oben, Abstiegsplatz unten
                const zone = tableZone(at + 1, shown.table.length, (s.career?.tier ?? 2) > 1 ? 3 : 1);
                if (!zone) return null;
                return (
                  <span className={`manager__zone manager__zone--${zone}`}>
                    {' · '}
                    {zone === 'top' ? ((s.career?.tier ?? 2) > 1 ? tx.zonePromotion : tx.zoneChampion) : tx.zoneBottom}
                  </span>
                );
              })()}
              {(() => {
                // Abstiegskampf: Abstand zum rettenden Platz bzw. Vorsprung auf die rote Zone (bis 3 Plätze darüber)
                const n = shown.table.length;
                if (n < TABLE_BOTTOM_MIN || m.played < 3 || m.played >= m.total) return null;
                const firstBottom = n - TABLE_BOTTOM_ZONE;
                if (at >= firstBottom)
                  return (
                    <span className="manager__drop is-in">
                      {' · '}
                      {tx.toSafety(shown.table[firstBottom - 1].pts - shown.table[at].pts)}
                    </span>
                  );
                if (at >= firstBottom - 3)
                  return (
                    <span className="manager__drop">
                      {' · '}
                      {tx.aboveDrop(shown.table[at].pts - shown.table[firstBottom].pts)}
                    </span>
                  );
                return null;
              })()}
              {/* Hochrechnung aufs Saisonende (Punkteschnitt × alle Spiele), erst ab dem 3. Spieltag */}
              {m.played >= 3 && m.played < m.total && shown.table[at].played > 0 && (
                <span className="muted manager__projection">
                  {' · '}
                  {tx.projection(Math.round((shown.table[at].pts / shown.table[at].played) * m.total))}
                </span>
              )}
              {s.teams[you]?.goal && (
                <span className="manager__goal">
                  {' · 🎯 '}
                  {t.online.goal[s.teams[you].goal!]}
                  {goalReached(s.teams[you].goal!, at + 1, shown.table.length)
                    ? ' ✓'
                    : (() => {
                        // Punkte Rückstand auf den Zielplatz (Platz 1, 3, obere Hälfte bzw. letzter Nicht-Abstiegsplatz)
                        const n = shown.table.length;
                        const goal = s.teams[you].goal!;
                        const target = goal === 'title' ? 1 : goal === 'top3' ? 3 : goal === 'upper' ? Math.ceil(n / 2) : n - 3;
                        const gap = (shown.table[target - 1]?.pts ?? 0) - shown.table[at].pts;
                        return m.played > 0 && gap >= 0 ? <span className="muted manager__goalgap">{tx.goalGap(gap)}</span> : null;
                      })()}
                </span>
              )}
            </p>
          );
        })()}
        {you != null && m.played >= 1 && (() => {
          // Eigene Bilanz: Siege–Remis–Niederlagen, Tore und Spiele ohne Gegentor
          const row = shown.table.find((r) => r.team === you);
          if (!row || !row.played) return null;
          const clean = shown.matches.filter((x) => (x.home === you && x.ag === 0) || (x.away === you && x.hg === 0)).length;
          return (
            <p className="small muted manager__record">
              {tx.ownRecord(row.w, row.d, row.l, `${row.gf}:${row.ga}`)}
              {clean > 0 && (
                <span title={t.draft.ticker.cleanSheets(clean)}>
                  {' · 🧤 '}
                  {clean}
                  <span className="sr-only"> – {t.draft.ticker.cleanSheets(clean)}</span>
                </span>
              )}
            </p>
          );
        })()}
        {you != null && m.played >= 3 && (() => {
          // 🔝 Bilanz gegen die aktuellen Top 4 (ohne dich selbst)
          const top = new Set(shown.table.filter((r) => r.team !== you).slice(0, 4).map((r) => r.team));
          let w = 0;
          let d = 0;
          let l = 0;
          for (const x of shown.matches) {
            const opp = x.home === you ? x.away : x.away === you ? x.home : null;
            if (opp == null || !top.has(opp)) continue;
            const gf = x.home === you ? x.hg : x.ag;
            const ga = x.home === you ? x.ag : x.hg;
            if (gf > ga) w++;
            else if (gf === ga) d++;
            else l++;
          }
          return w + d + l > 0 && <p className="small muted manager__vstop">{tx.vsTop(formatRecord({ w, d, l }), w + d + l)}</p>;
        })()}
        {you != null && (() => {
          // 📣 Fan-Stimmung aus den letzten fünf Spielen
          const mood = fanMood(recentForm(shown.matches, you, m.played));
          return mood && <p className={`small manager__mood manager__mood--${mood}`}>{tx.fanMood[mood]}</p>;
        })()}
        {you != null && m.played >= 1 && (() => {
          // Tore nach Mannschaftsteil: gestapelter Balken in den Farben der Positions-Badges (ab drei Toren)
          const lines = goalsByLine(shown.matches, you);
          const total = GOAL_LINES.reduce((a, k) => a + lines[k], 0);
          if (total < 3) return null;
          const parts = GOAL_LINES.filter((k) => lines[k] > 0);
          const text = parts.map((k) => `${tx.lineNames[k]} ${lines[k]}`).join(' · ');
          return (
            <div className="manager__lines">
              <span className="small muted">{tx.linesTitle}</span>
              <span className="manager__lines-bar" role="img" aria-label={`${tx.linesTitle}: ${text}`}>
                {parts.map((k) => (
                  <span key={k} className={`pos-badge--${k}`} style={{ width: `${(lines[k] / total) * 100}%` }} />
                ))}
              </span>
              <span className="small" aria-hidden="true">
                {text}
              </span>
              {(() => {
                // 👥 Verschiedene Torschützen, mit Hinweis auf den Liga-Bestwert (auch geteilt)
                const all = distinctScorers(shown.matches, shown.teams.length);
                const n = all[you] ?? 0;
                return (
                  <span className="small manager__scorers">
                    {tx.distinctScorers(n)}
                    {n > 0 && n >= Math.max(...all) && <strong>{tx.distinctScorersBest}</strong>}
                  </span>
                );
              })()}
              {(() => {
                // ⏱️ Stärkste Torphase (Viertelstunde mit den meisten eigenen Toren)
                const phase = bestGoalPhase(shown.matches, you);
                return phase && <span className="small manager__phase">{tx.goalPhase(phase.from, phase.to, phase.goals)}</span>;
              })()}
            </div>
          );
        })()}
        {you != null && m.played * 2 >= m.total && m.played < m.total && (() => {
          // 🏆 Rechnerischer Titelkampf ab der Saisonhälfte (jedes Team spielt jeden Spieltag)
          const chance = titleChance(shown.table, you, m.total);
          const row = shown.table.find((r) => r.team === you);
          if (!chance || !row) return null;
          const max = (r: { pts: number; played: number }) => r.pts + 3 * Math.max(0, m.total - r.played);
          const lead = shown.table[0].team === you;
          const text =
            chance === 'clinched'
              ? tx.raceClinched
              : chance === 'out'
                ? tx.raceOut
                : lead
                  ? tx.raceLeading(Math.max(...shown.table.filter((r) => r.team !== you).map(max)))
                  : tx.raceOpen(max(row), shown.table[0].pts);
          return <p className={`small manager__race manager__race--${chance}`}>🏆 {text}</p>;
        })()}
        {you != null && m.played >= 3 && (() => {
          // Aktuelle Serie des eigenen Teams: ungeschlagen bzw. sieglos (ab 3 Spielen)
          const r = currentRun(shown.matches, you);
          return r && <SeriesLine run={r} />;
        })()}
        {you != null && (() => {
          // 🏅 Unterwegs zum Erfolg „Siegesserie“ (7 Siege in Folge): ab 3 Siegen in Folge
          const n = winRun(shown.matches, you);
          return n >= 3 && n < WIN_STREAK_GOAL && <p className="small manager__winrun">{tx.winRun(n, WIN_STREAK_GOAL - n)}</p>;
        })()}
        {you != null && (() => {
          // 🧱/🏭 Unterwegs zu den Erfolgen „Bollwerk“ (CLEAN_GOAL Spiele ohne Gegentor) und „Torfabrik“ (GOALS_GOAL Tore) – ab 3 Spielen ohne Gegentor (nur solange noch erreichbar) bzw. 30 Toren
          let clean = 0;
          let goals = 0;
          for (const x of shown.matches) {
            if (x.home !== you && x.away !== you) continue;
            const home = x.home === you;
            if ((home ? x.ag : x.hg) === 0) clean++;
            goals += home ? x.hg : x.ag;
          }
          const parts = [
            clean >= 3 && clean < CLEAN_GOAL && CLEAN_GOAL - clean <= m.total - m.played ? tx.cleanNear(clean, CLEAN_GOAL - clean) : null,
            goals >= 30 && goals < GOALS_GOAL ? tx.goalsNear(goals, GOALS_GOAL - goals) : null,
          ].filter(Boolean);
          return parts.length > 0 && <p className="small manager__achnear">{parts.join(' · ')}</p>;
        })()}
        {you != null && (() => {
          // 💥 Unterwegs zum Erfolg „Schützenfest“ (Sieg mit ROUT_GOAL Toren Abstand): höchster eigener Sieg ab 3 Toren Abstand
          let best: { gf: number; ga: number; opp: number } | null = null;
          for (const x of shown.matches) {
            if (x.home !== you && x.away !== you) continue;
            const home = x.home === you;
            const v = { gf: home ? x.hg : x.ag, ga: home ? x.ag : x.hg, opp: home ? x.away : x.home };
            if (!best || v.gf - v.ga > best.gf - best.ga) best = v;
          }
          const b = best as { gf: number; ga: number; opp: number } | null;
          if (!b || b.gf - b.ga < 3) return null;
          const score = `${b.gf}:${b.ga}`;
          return (
            <p className="small manager__routgoal">
              {b.gf - b.ga >= ROUT_GOAL ? tx.routDone(score, nameOf(b.opp)) : tx.routNear(score, ROUT_GOAL - (b.gf - b.ga))}
            </p>
          );
        })()}
        {you != null && m.played >= 1 && (() => {
          // Tabellenausschnitt: zwei Plätze über und unter dem eigenen Team, mit Punkteabstand
          const at = shown.table.findIndex((r) => r.team === you);
          if (at < 0) return null;
          const from = Math.max(0, Math.min(at - 2, shown.table.length - 5));
          const rows = shown.table.slice(from, from + 5);
          const mine = shown.table[at].pts;
          return (
            <ol className="manager__around" aria-label={tx.aroundLabel} start={from + 1}>
              {rows.map((r, k) => {
                const d = r.pts - mine;
                return (
                  <li key={r.team} className={r.team === you ? 'is-you' : ''}>
                    <span className="manager__around-place">{from + k + 1}.</span>
                    <span className="manager__around-name">{nameOf(r.team)}</span>
                    <span className="manager__around-pts">{r.pts}</span>
                    <span className="manager__around-diff muted">{r.team === you ? '' : d > 0 ? `+${d}` : d === 0 ? '±0' : `−${-d}`}</span>
                  </li>
                );
              })}
            </ol>
          );
        })()}
        {you != null && (() => {
          // Saisonstreifen: je Spieltag ein Kästchen – gespielt in Ergebnisfarbe (eigene Tore zuerst), offen mit Platz des Gegners
          const placeOf = (i: number) => shown.table.findIndex((r) => r.team === i) + 1;
          const cells = schedule.slice(0, m.total).flatMap((round, r) => {
            const pair = round.find(([a, b]) => a === you || b === you);
            if (!pair) return [];
            const opp = pair[0] === you ? pair[1] : pair[0];
            const match = r < m.played ? shown.matches.find((x) => x.round === r + 1 && (x.home === you || x.away === you)) : undefined;
            if (match) {
              const own = match.home === you ? match.hg : match.ag;
              const other = match.home === you ? match.ag : match.hg;
              const kind = own > other ? 'w' : own < other ? 'l' : 'd';
              return [{ r, kind, text: `${own}:${other}`, title: tx.stripPlayed(r + 1, nameOf(opp), `${own}:${other}`) }];
            }
            return [{ r, kind: 'next', text: String(placeOf(opp) || '–'), title: tx.stripNext(r + 1, nameOf(opp), placeOf(opp)) }];
          });
          if (!cells.length) return null;
          return (
            <ol className="manager__strip" aria-label={tx.stripLabel} style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}>
              {cells.map((c) => (
                <li key={c.r} className={`manager__strip-cell is-${c.kind} ${c.r === m.played ? 'is-current' : ''}`} title={c.title}>
                  <span aria-hidden="true">{c.text}</span>
                  <span className="sr-only">{c.title}</span>
                </li>
              ))}
            </ol>
          );
        })()}
        {you != null && m.played >= 3 && m.total - m.played >= 2 && (() => {
          // Restprogramm: Ø aktueller Tabellenplatz der noch ausstehenden Gegner (leicht/mittel/schwer)
          const placeOf = (i: number) => shown.table.findIndex((r) => r.team === i) + 1;
          const opps = schedule.slice(m.played).flatMap((round) => round.flatMap(([a, b]) => (a === you ? [b] : b === you ? [a] : [])));
          if (opps.length < 2 || placeOf(you) === 0) return null;
          const avg = opps.reduce((sum, o) => sum + placeOf(o), 0) / opps.length;
          // Erwartung: Ø Platz aller anderen Teams
          const n = shown.table.length;
          const mid = ((n * (n + 1)) / 2 - placeOf(you)) / (n - 1);
          const level = avg < mid - 1.5 ? 'hard' : avg > mid + 1.5 ? 'easy' : 'medium';
          const shownAvg = avg.toLocaleString(localeOf(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          return (
            <>
              <p className={`small muted manager__rest is-${level}`} title={tx.restTitle}>
                {tx.rest(shownAvg, opps.length, tx.restLevel[level])}
              </p>
              {/* Die nächsten drei Gegner mit aktuellem Platz */}
              <p className="small muted manager__upnext">
                {tx.upNext(opps.slice(0, 3).map((o) => `${nameOf(o)} (${placeOf(o)}.)`).join(' → '))}
              </p>
            </>
          );
        })()}
        {(() => {
          // Eigener Torjäger und sein Platz in der Torjägerliste der Liga (geteilte Plätze bei Gleichstand)
          if (you == null) return null;
          let top: [number, number] | null = null;
          for (const [id, n] of goalsOf(league, you)) if (!top || n > top[1]) top = [id, n];
          if (!top) return null;
          const all = shown.teams.flatMap((_, i) => [...goalsOf(league, i)].map(([id, n]) => ({ team: i, id, n })));
          const rank = 1 + all.filter((x) => x.n > top![1]).length;
          // Nicht vorn: wer die Torjägerliste anführt (bei Gleichstand der zuerst Gefundene)
          const lead = rank > 1 ? all.reduce((a, b) => (b.n > a.n ? b : a)) : null;
          return (
            <p className="small muted manager__ownscorer">
              ⚽ {tx.ownScorer(pokemonName(top[0]), top[1], rank)}
              {lead && <span className="manager__scorerlead"> · {tx.scorerLead(pokemonName(lead.id), nameOf(lead.team), lead.n)}</span>}
            </p>
          );
        })()}
        {m.played >= 2 && (() => {
          // Führungsserie des Tabellenführers (wie im Saison-Ticker) bzw. Wechsel an der Spitze
          const days = leagueTimeline(shown);
          const last = days.at(-1);
          const n = last ? leaderSince(days, last.round) : 0;
          if (!last) return null;
          // Wechsel an der Spitze am letzten Spieltag
          const prev = days.at(-2);
          if (n === 1 && prev)
            return <p className="small manager__leader is-new">👑 {t.draft.ticker.newLeader(nameOf(last.leader.team), nameOf(prev.leader.team))}</p>;
          if (n < 3) return null;
          return <p className="small muted manager__leader">👑 {t.draft.ticker.leaderStreak(nameOf(last.leader.team), n)}</p>;
        })()}
        {/* Karriere: frühere Saisons des eigenen Teams */}
        {(() => {
          const mine = room.me ? (s.career?.history ?? []).filter((h) => h.places[room.me!.id] != null) : [];
          if (!mine.length) return null;
          return (
            <p className="muted small manager__career">
              {t.online.careerHistory}{' '}
              {mine.map((h) => t.online.careerPlace(h.season, h.tier, h.places[room.me!.id])).join(' · ')}
              {(() => {
                // 🏅 Wie oft Platz 1 (Meister der jeweiligen Liga)
                const firsts = mine.filter((h) => h.places[room.me!.id] === 1).length;
                return firsts > 0 && <strong className="manager__career-firsts"> · {t.online.careerFirsts(firsts)}</strong>;
              })()}
            </p>
          );
        })()}
        {m.nextAt != null && (
          <p className="manager__kickoff">
            <strong>{tx.next(nextNo)}</strong> · {tx.kickoffIn(m.nextAt - now)} <span className="muted">{tx.kickoffAt(when)}</span>
          </p>
        )}
        {/* Eigener Neuzugang des letzten Spieltags schillert */}
        {lastTransfers
          .filter((x) => x.shiny && x.teamId === room.me?.id)
          .map((x) => {
            const p = byId.get(x.in);
            return p ? (
              <p key={x.in} className="hint hint--active manager__shiny">
                {t.shiny.transferred(t.game.pokemon(p), shinyTeamBoost(p))}
              </p>
            ) : null;
          })}
        {/* Sprungmenü – die Seite ist lang (vor allem auf dem Handy) */}
        <nav className="manager__jump" aria-label={tx.jumpAria}>
          {(
            [
              ['manager-lineup', tx.jumpLineup, !readOnly && !!room.me],
              ['manager-market', tx.jumpMarket, !readOnly && !!room.me && m.nextAt != null],
              ['manager-trade', tx.jumpTrade, !readOnly && !!room.me && m.nextAt != null],
              ['manager-last', tx.jumpResults, m.played > 0],
              ['manager-table', tx.jumpTable, true],
            ] as const
          )
            .filter(([, , show]) => show)
            .map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
        </nav>
        {!readOnly && incomingIds.length > 0 && (
          <p className="manager__offers-link">
            <a href="#manager-trade">🤝 {tx.offersOpen(incomingIds.length)}</a>
          </p>
        )}
      </section>

      {rival != null && myNext && (
        <section className="card manager__rival" aria-labelledby="manager-rival">
          <h2 id="manager-rival" className="section-title">
            {tx.rivalTitle}
          </h2>
          <p>
            <strong>{nameOf(rival)}</strong> <span className="muted">({myNext.home === you ? tx.rivalHome : tx.rivalAway})</span>
            {/* Aktuelle Formation des Gegners (Aufstellungen stehen für alle im Schnappschuss; Auffüllteams haben keine) */}
            {s.teams[rival] && m.lineups[s.teams[rival].id] && (
              <span className="small muted manager__rival-formation">
                {' · '}
                {tx.rivalFormation(m.lineups[s.teams[rival].id].formation)} <FormationMini formation={m.lineups[s.teams[rival].id].formation} small />
              </span>
            )}
          </p>
          {m.played > 0 && (
            <p className="manager__rival-line">
              {rivalPlace > 0 && <span>{tx.rivalPlace(rivalPlace)}</span>}
              <FormDots form={recentForm(shown.matches, rival, m.played)} />
            </p>
          )}
          {(() => {
            // 🌦️ Wetter-Vorhersage (nur Deko, deterministisch aus Spieltag und Paarung)
            const w = weatherFor(nextNo, myNext.home, myNext.away);
            return <p className="small muted manager__weather">{tx.weather(tx.weatherKinds[w.kind], w.temp)}</p>;
          })()}
          {you != null && myNext.home === you && m.played > 0 && (() => {
            // 🏟️ Erwartete Zuschauer beim Heimspiel (Tabellenplatz + Fan-Stimmung)
            const place = shown.table.findIndex((r) => r.team === you) + 1;
            if (place < 1) return null;
            const crowd = expectedCrowd(place, shown.table.length, fanMood(recentForm(shown.matches, you, m.played)));
            const n = crowd.toLocaleString(localeOf(lang));
            return <p className="small manager__crowd">{crowd >= STADIUM_CAPACITY ? tx.crowdFull(n) : tx.crowd(n)}</p>;
          })()}
          {m.played > 0 && (() => {
            // Bilanz des Gegners am Spielort: auswärts, wenn er zu dir kommt – sonst zu Hause
            const side = myNext.home === you ? 'away' : 'home';
            const row = sideTable(shown.teams, shown.matches, side).find((r) => r.team === rival);
            if (!row || row.played === 0) return null;
            return (
              <p className="small manager__rival-venue">
                {tx.rivalVenue(side, formatRecord({ w: row.w, d: row.d, l: row.l }), row.played)}
              </p>
            );
          })()}
          {(() => {
            // Serie des Gegners (ab 3 Spielen)
            const r = currentRun(shown.matches, rival);
            return r && <SeriesLine run={r} />;
          })()}
          {(() => {
            // ⏮️ Letztes Spiel des Gegners (Ergebnis aus seiner Sicht)
            const last = shown.matches.filter((x) => x.home === rival || x.away === rival).sort((a, b) => b.round - a.round)[0];
            if (!last) return null;
            const home = last.home === rival;
            const gf = home ? last.hg : last.ag;
            const ga = home ? last.ag : last.hg;
            const kind = gf > ga ? 'w' : gf < ga ? 'l' : 'd';
            return <p className="small manager__rival-last">{tx.rivalLast(kind, `${gf}:${ga}`, nameOf(home ? last.away : last.home))}</p>;
          })()}
          {s.teams[rival] && m.lineups[s.teams[rival].id] && (() => {
            // 🎯 Schwachpunkt des Gegners: Starter mit dem niedrigsten Fit (mit Tagesform), wie die eigene Schwachstelle
            const l = m.lineups[s.teams[rival].id];
            const defs = FORMATIONS[l.formation].slots;
            const sc = scale('all');
            let w: { id: number; pos: PosCode; fit: number } | null = null;
            l.slots.forEach((id, i) => {
              const p = id != null ? byId.get(id) : undefined;
              if (!p || !defs[i]) return;
              const fit = formFit(p, defs[i].pos, sc, m.form[id!] ?? 0);
              if (!w || fit < w.fit) w = { id: id!, pos: defs[i].pos, fit };
            });
            const x = w as { id: number; pos: PosCode; fit: number } | null;
            return x && <p className="small manager__rival-weak">{tx.rivalWeak(t.game.posShort[x.pos], pokemonName(x.id), Math.round(x.fit))}</p>;
          })()}
          {s.teams[rival]?.captain != null && (() => {
            // Kapitän des Gegners (zählt doppelt) – mit Sprite
            const cap = s.teams[rival].captain!;
            const p = byId.get(cap);
            return (
              <p className="small manager__rival-captain">
                <span className="captain-badge" title={t.captain.title}>
                  C<span className="sr-only"> – {t.captain.title}</span>
                </span>{' '}
                {p && <Sprite pokemon={p} style={sprite} className="manager__star-sprite" />} {tx.rivalCaptain(pokemonName(cap))}
              </p>
            );
          })()}
          {(() => {
            // Bester Torschütze des Gegners (ab 2 Toren)
            let top: [number, number] | null = null;
            for (const [id, n] of goalsOf(league, rival)) if (!top || n > top[1]) top = [id, n];
            if (!top || top[1] < 2) return null;
            return <p className="small manager__rival-scorer">⚽ {tx.rivalScorer(pokemonName(top[0]), top[1])}</p>;
          })()}
          {(() => {
            // Angriff und Abwehr des Gegners: Rang in der Liga und Schnitt pro Spiel
            const row = shown.table.find((r) => r.team === rival);
            const r = attackDefenseRanks(shown.table, rival);
            if (!row || !r || row.played === 0) return null;
            const per = (n: number) => (n / row.played).toLocaleString(localeOf(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            return <p className="small manager__rival-ranks">{tx.rivalRanks(r.gfRank, per(r.gf), r.gaRank, per(r.ga))}</p>;
          })()}
          {s.teams[rival] && (() => {
            // Ausfälle des Gegners zum nächsten Spieltag
            const absent = absentAt({ out: m.out ?? {} }, m.played + 1);
            const theirs = rosterOf(s.teams[rival]).filter((id) => absent.has(id));
            if (!theirs.length) return null;
            const names = theirs.map((id) => `${pokemonName(id)} ${m.out![id].kind === 'red' ? '🟥' : '🚑'}`);
            return <p className="small manager__rival-out">{tx.rivalOut(names.join(', '))}</p>;
          })()}
          {/* Stärkevergleich der besten Elfen (nur gedraftete Gegner – Auffüllteams haben keinen Kader im Schnappschuss) */}
          {you != null && s.teams[rival] && (() => {
            const sc = scale('all');
            const mine = squadStrength(s.teams[you], byId, sc);
            const theirs = squadStrength(s.teams[rival], byId, sc);
            // Die Kader liegen meist nah beieinander: 1 % Unterschied = 5 Punkte auf dem Balken (5–95 %)
            const rel = mine + theirs > 0 ? (mine - theirs) / ((mine + theirs) / 2) : 0;
            const share = Math.max(5, Math.min(95, 50 + rel * 500));
            return (
              <div className="manager__compare" title={tx.compareTitle}>
                <span className="small">{tx.compareYou}</span>
                <span className="manager__compare-bar" role="img" aria-label={tx.compareAria(Math.round(share))}>
                  <span style={{ width: `${share}%` }} />
                </span>
                <span className="small">{nameOf(rival)}</span>
              </div>
            );
          })()}
          {you != null && !readOnly && (() => {
            // 🔮 Tipp aufs eigene Spiel: Sieg, Remis oder Niederlage – mit Trefferbilanz der gespielten Spieltage
            const score = tipScore(tips, league?.matches ?? [], you, m.played);
            const mineNow = tips[m.played + 1];
            return (
              <div className="manager__predict">
                <span className="small">🔮 {tx.tipLabel}</span>
                <span className="manager__predict-buttons" role="group" aria-label={tx.tipLabel}>
                  {MATCH_TIPS.map((tip) => (
                    <button
                      key={tip}
                      type="button"
                      className={`btn btn--small ${mineNow === tip ? 'btn--primary' : ''}`}
                      aria-pressed={mineNow === tip}
                      onClick={() => setTips(saveTip(s.code, m.played + 1, tip))}
                    >
                      {tx.tipOptions[tip]}
                    </button>
                  ))}
                </span>
                {score.total > 0 && (
                  <span className="small muted manager__predict-score">
                    {score.last && `${tx.tipLast(score.last.round, score.last.hit)} · `}
                    {tx.tipScore(score.hits, score.total)}
                    {score.streak >= 2 && ` · 🔥 ${tx.tipStreak(score.streak)}`}
                  </span>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {room.me && !readOnly && m.lineups[room.me.id] ? (
        <LineupEditor
          key={room.me.id}
          team={s.teams[meIndex]}
          lineup={m.lineups[room.me.id]}
          form={m.form}
          setPiece={s.settings.setPiece}
          onChange={(l) => room.setLineup(l)}
          out={m.out ?? {}}
          next={m.played + 1}
          shinies={s.shinies}
          goals={goalsOf(league, meIndex)}
          assists={assistsOf(league, meIndex)}
          stars={starsOf(league, meIndex)}
          starts={startsOf(m.playedLineups, room.me.id)}
          played={m.played}
        />
      ) : (
        <p className="notice">{tx.spectator}</p>
      )}

      <OutList state={s} out={m.out ?? {}} next={m.played + 1} />

      {m.cup && <ManagerCupView cup={m.cup} you={you} nameOf={nameOf} />}

      {room.me && !readOnly && m.lineups[room.me.id] && meIndex >= 0 && (
        <section className="card">
          <CaptainPicker
            formation={m.lineups[room.me.id].formation}
            slots={m.lineups[room.me.id].slots}
            captain={s.teams[meIndex].captain ?? null}
            bench={rosterOf(s.teams[meIndex]).filter((id) => !m.lineups[room.me!.id].slots.includes(id))}
            onChange={(c) => room.setCaptain(c)}
            hint={t.captain.managerNote}
          />
        </section>
      )}

      {room.me && !readOnly && meIndex >= 0 && (
        <>
          <KitPicker kit={cleanKit(s.teams[meIndex].kit)} onChange={(kit) => room.setKit(kit)} cheer={s.teams[meIndex].cheer ?? ''} onCheer={(c) => room.setCheer(c)} />
          <CrestEditor crest={cleanCrest(s.teams[meIndex].crest)} onChange={(c) => room.setCrest(c)} pokemon={rosterOf(s.teams[meIndex])} />
        </>
      )}

      {room.me && !readOnly && m.lineups[room.me.id] && meIndex >= 0 && (
        <JerseyEditor
          formation={m.lineups[room.me.id].formation}
          slots={m.lineups[room.me.id].slots}
          ss={s.settings.setPiece ? m.lineups[room.me.id].ss : null}
          bench={rosterOf(s.teams[meIndex])}
          jerseys={s.teams[meIndex].jerseys ?? {}}
          onChange={(j) => room.setJerseys(j)}
        />
      )}

      {room.me && !readOnly && m.nextAt != null && meIndex >= 0 && (
        <TransferMarket
          state={s}
          team={s.teams[meIndex]}
          claim={m.claim ?? null}
          matchday={nextNo}
          onTransfer={(inId, outId) => room.setTransfer(inId, outId)}
          goals={goalsOf(league, meIndex)}
        />
      )}

      {room.me && !readOnly && m.nextAt != null && meIndex >= 0 && (
        <TradePanel
          state={s}
          team={s.teams[meIndex]}
          offers={m.offers ?? []}
          done={(m.transfers ?? []).filter((x) => x.with && x.teamId === s.teams[meIndex].id && x.matchday === nextNo)}
          nameOf={(id) => {
            const tm = s.teams.find((x) => x.id === id);
            return tm ? teamLabel(tm, t) : '?';
          }}
          error={room.error}
          goalsOf={(id) => goalsOf(league, s.teams.findIndex((x) => x.id === id))}
          onOffer={(to, give, get) => room.offerTrade(to, give, get)}
          onAnswer={(id, accept) => room.answerOffer(id, accept)}
        />
      )}

      {lastTransfers.length > 0 && (
        <section className="card" aria-labelledby="manager-transfers">
          <h2 id="manager-transfers" className="section-title">
            {tx.transfersTitle(m.played)}
          </h2>
          <ul className="manager__transfers">{lastTransfers.filter(shownOnce).map(transferItem)}</ul>
        </section>
      )}

      {meIndex >= 0 && (() => {
        // 📥 Eigene Neuzugänge der Saison (Markt und Tausch) mit ihren Toren für dein Team
        const myId = s.teams[meIndex].id;
        const ins = [...new Set((m.transfers ?? []).filter((x) => x.teamId === myId).map((x) => x.in))];
        if (!ins.length) return null;
        const goals = goalsOf(league, meIndex);
        const items = ins.map((id) => tx.newcomerItem(pokemonName(id), goals.get(id) ?? 0));
        return <p className="card small manager__newcomers">📥 {tx.newcomers(items.join(', '))}</p>;
      })()}

      {/* Alle Transfers der Saison (ohne die schon oben gezeigten), neueste zuerst */}
      {(() => {
        const earlier = (m.transfers ?? []).filter((x) => x.matchday < m.played).filter(shownOnce);
        if (!earlier.length) return null;
        const days = [...new Set(earlier.map((x) => x.matchday))].sort((a, b) => b - a);
        return (
          <details className="card details manager__history">
            <summary>{tx.transfersAll(earlier.length)}</summary>
            {days.map((d) => (
              <div key={d}>
                <h3 className="small muted">{tx.transfersTitle(d)}</h3>
                <ul className="manager__transfers">{earlier.filter((x) => x.matchday === d).map(transferItem)}</ul>
              </div>
            ))}
          </details>
        );
      })()}

      {upcoming.length > 0 && (
        <section className="card" aria-labelledby="manager-next">
          <h2 id="manager-next" className="section-title">
            {tx.upcoming(nextNo)}
          </h2>
          {m.played > 0 && (() => {
            // Topspiel: die Paarung mit der besten Platzsumme (aktuelle Tabelle), Kellerduell: die mit der schlechtesten
            const placeOf = (i: number) => shown.table.findIndex((r) => r.team === i) + 1;
            const sum = (mt: (typeof upcoming)[number]) => placeOf(mt.home) + placeOf(mt.away);
            const top = [...upcoming].sort((a, b) => sum(a) - sum(b))[0];
            if (!top) return null;
            const cellar = upcoming.length >= 2 ? [...upcoming].sort((a, b) => sum(b) - sum(a))[0] : null;
            const pair = (mt: (typeof upcoming)[number]) => [`${placeOf(mt.home)}. ${nameOf(mt.home)}`, `${placeOf(mt.away)}. ${nameOf(mt.away)}`] as const;
            return (
              <>
                <p className="manager__topgame">🔥 {tx.topGame(...pair(top))}</p>
                {cellar && <p className="manager__topgame manager__cellar">🥶 {tx.cellarGame(...pair(cellar))}</p>}
              </>
            );
          })()}
          <FixtureList matches={upcoming} you={you} nameOf={nameOf} pokemonName={pokemonName} upcoming />
        </section>
      )}

      {last.length > 0 && (
        <section className="card" aria-labelledby="manager-last">
          <h2 id="manager-last" className="section-title">
            {liveMin != null ? (
              <>
                <span className="manager__live" aria-hidden="true">
                  ● LIVE
                </span>{' '}
                {tx.liveTitle(m.played, liveMin)}
              </>
            ) : (
              tx.lastResults(m.played)
            )}
          </h2>
          {liveMin != null ? <p className="muted small">{tx.liveNote}</p> : <ReplayToggle />}
          <FixtureList matches={last} you={you} nameOf={nameOf} pokemonName={pokemonName} onOpen={liveMin == null ? report.open : undefined} />
          {star && (
            <p className={`manager__star ${star.teamIndex === you ? 'is-you' : ''}`}>
              <span aria-hidden="true">⭐</span> <strong>{tx.starTitle}</strong>{' '}
              {byId.get(star.pokemonId) && <Sprite pokemon={byId.get(star.pokemonId)!} style={sprite} className="manager__star-sprite" />}
              {pokemonName(star.pokemonId)} <span className="muted">({nameOf(star.teamIndex)})</span> – {tx.starLine(star.goals, star.assists)}
            </p>
          )}
          {liveMin == null &&
            hatTricks(last).map((h) => (
              // Hattricks des Spieltags (wie im Saison-Ticker)
              <p key={`${h.team}-${h.pokemonId}`} className={`manager__hat ${h.team === you ? 'is-you' : ''}`}>
                <span aria-hidden="true">🎩 </span>
                {t.draft.ticker.hatTrick(pokemonName(h.pokemonId), nameOf(h.team), h.goals)}
              </p>
            ))}
          {liveMin == null &&
            you != null &&
            goalMilestones(shown.matches, you, m.played).map((x) => (
              // 🎯 Eigener Spieler erreicht am Spieltag eine 5er-Marke (5, 10, 15 … Saisontore)
              <p key={x.pokemonId} className="manager__milestone is-you">
                <span aria-hidden="true">🎯 </span>
                {tx.goalMilestone(pokemonName(x.pokemonId), x.mark)}
              </p>
            ))}
          {liveMin == null &&
            you != null &&
            scoringRuns(shown.matches, you, m.played).map((x) => (
              // 🔥 Torserie eines eigenen Spielers (ab drei Spielen in Folge mit Tor)
              <p key={x.pokemonId} className="manager__scorerun is-you">
                <span aria-hidden="true">🔥 </span>
                {tx.scoringRun(pokemonName(x.pokemonId), x.games)}
              </p>
            ))}
          {liveMin == null && (() => {
            // Überraschung des Spieltags (wie im Saison-Ticker): Sieg des Außenseiters mit dem größten Rückstand
            const upset = biggestUpset(last, shown.teams.map((tm) => tm.rating));
            if (!upset) return null;
            const score = upset.match.home === upset.winner ? `${upset.match.hg}:${upset.match.ag}` : `${upset.match.ag}:${upset.match.hg}`;
            return (
              <p className={`manager__upset ${upset.winner === you ? 'is-you' : ''}`}>
                <span aria-hidden="true">⚡ </span>
                {t.draft.ticker.upset(nameOf(upset.winner), nameOf(upset.loser), score)}
              </p>
            );
          })()}
          {liveMin == null && (() => {
            // Kantersieg des Spieltags (wie im Saison-Ticker): mindestens vier Tore Abstand
            const rout = routOf(last);
            if (!rout) return null;
            const score = rout.match.home === rout.winner ? `${rout.match.hg}:${rout.match.ag}` : `${rout.match.ag}:${rout.match.hg}`;
            return (
              <p className={`manager__rout ${rout.winner === you || rout.loser === you ? 'is-you' : ''}`}>
                <span aria-hidden="true">💥 </span>
                {t.draft.ticker.rout(nameOf(rout.winner), nameOf(rout.loser), score)}
              </p>
            );
          })()}
          {liveMin == null && (() => {
            // Comeback des Spieltags (wie im Saison-Ticker): Sieg nach mindestens zwei Toren Rückstand
            const cb = comebackOf(last);
            if (!cb) return null;
            const score = cb.match.home === cb.winner ? `${cb.match.hg}:${cb.match.ag}` : `${cb.match.ag}:${cb.match.hg}`;
            return (
              <p className={`manager__comeback ${cb.winner === you || cb.loser === you ? 'is-you' : ''}`}>
                <span aria-hidden="true">🔄 </span>
                {t.draft.ticker.comeback(nameOf(cb.winner), nameOf(cb.loser), `${cb.behind[0]}:${cb.behind[1]}`, score)}
              </p>
            );
          })()}
          {liveMin == null && (() => {
            // Last-Minute-Sieg des Spieltags (wie im Saison-Ticker)
            const late = lateWinner(last);
            if (!late) return null;
            const score = late.match.home === late.winner ? `${late.match.hg}:${late.match.ag}` : `${late.match.ag}:${late.match.hg}`;
            return (
              <p className={`manager__late ${late.winner === you ? 'is-you' : ''}`}>
                <span aria-hidden="true">⏱ </span>
                {t.draft.ticker.lateWinner(nameOf(late.winner), nameOf(late.loser), score, formatMinute(late.minute))}
              </p>
            );
          })()}
        </section>
      )}

      {m.played > 0 && <SeasonStats league={shown} you={you} nameOf={nameOf} captains={s.teams.map((tm) => tm.captain)} />}

      {you != null && m.played >= 2 && (
        <section className="card" aria-labelledby="manager-places">
          <h2 id="manager-places" className="section-title">
            {t.draft.results.placeChart}
          </h2>
          <PlaceChart places={leagueTimeline(league).map((d) => d.places[you])} teams={league.teams.length} running />
        </section>
      )}

      <section className="card" aria-labelledby="manager-table">
        <h2 id="manager-table" className="section-title">
          {tx.tableTitle}
        </h2>
        <ManagerTable
          rows={shown.table}
          you={you}
          nameOf={nameOf}
          matches={shown.matches}
          played={m.played}
          league={shown}
          crestOf={(i) => cleanCrest(s.teams[i]?.crest)}
          top={(s.career?.tier ?? 2) > 1 ? 3 : 1}
          rival={rival}
        />
      </section>
    </div>
  );
}

/** Eigene Aufstellung: tauschen (Feld, Standardschütze, Bank), Formation, automatisch, Kader mit Tagesform. */
/** Saisontore je Pokémon eines Liga-Teams (gespielte Spiele) */
type SquadSort = 'fit' | 'form' | 'goals' | 'assists' | 'points' | 'starts';

/** Saisonvorlagen je Pokémon eines Liga-Teams */
function assistsOf(league: LeagueResult | null | undefined, team: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of league?.matches ?? []) {
    const own = m.home === team ? m.homeScorers : m.away === team ? m.awayScorers : [];
    for (const g of own) if (g.assist != null) out.set(g.assist, (out.get(g.assist) ?? 0) + 1);
  }
  return out;
}

/** Wie oft jedes Pokémon des Teams „Spieler des Spieltags“ war (je Spieltag eine Auszeichnung) */
function starsOf(league: LeagueResult | null | undefined, team: number): Map<number, number> {
  const out = new Map<number, number>();
  const rounds = new Map<number, Match[]>();
  for (const m of league?.matches ?? []) rounds.set(m.round, [...(rounds.get(m.round) ?? []), m]);
  for (const ms of rounds.values()) {
    const star = playerOfRound(ms);
    if (star && star.teamIndex === team) out.set(star.pokemonId, (out.get(star.pokemonId) ?? 0) + 1);
  }
  return out;
}

function goalsOf(league: LeagueResult | null | undefined, team: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of league?.matches ?? []) {
    const own = m.home === team ? m.homeScorers : m.away === team ? m.awayScorers : [];
    for (const g of own) out.set(g.pokemonId, (out.get(g.pokemonId) ?? 0) + 1);
  }
  return out;
}

/** So viel stärker muss eine andere Formation sein, damit der Formations-Tipp erscheint (kleinere Gewinne sind Rauschen) */
const FORMATION_TIP_MIN = 5;

/** Ziel des Erfolgs „Siegesserie“ (streak_7) */
const WIN_STREAK_GOAL = 7;
/** Tordifferenz für den Erfolg „Schützenfest“ (rout_5) */
const ROUT_GOAL = 5;
/** Ziele der Erfolge „Bollwerk“ (clean_10) und „Torfabrik“ (goals_80) */
const CLEAN_GOAL = 10;
const GOALS_GOAL = 80;

/** Ab so vielen gespielten Spieltagen nennt die Aufstellung Bankspieler ohne Einsatz */
const UNUSED_AFTER = 3;

/** Startelf-Einsätze je Pokémon eines Teams in den gespielten Aufstellungen (inkl. Standardschütze) */
function startsOf(played: Record<string, Record<string, { slots: (number | null)[]; ss?: number | null }>> | undefined, teamId: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const round of Object.values(played ?? {})) {
    const l = round[teamId];
    if (!l) continue;
    const ids = new Set([...l.slots, l.ss].filter((id): id is number => id != null));
    for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** Ab so vielen gespielten Spieltagen nennt die Aufstellung die Dauerbrenner (jedes Spiel von Beginn an) */
const IRONMEN_AFTER = 5;

function LineupEditor({
  team,
  lineup,
  form,
  setPiece,
  onChange,
  out,
  next,
  shinies,
  goals,
  assists,
  stars,
  starts,
  played = 0,
}: {
  /** Startelf-Einsätze je Pokémon des eigenen Teams (gespielte Spieltage) */
  starts?: ReadonlyMap<number, number>;
  /** Gespielte Spieltage */
  played?: number;
  /** Auszeichnungen „Spieler des Spieltags“ je Pokémon des eigenen Teams */
  stars?: ReadonlyMap<number, number>;
  team: DraftTeam;
  lineup: ManagerLineup;
  form: Record<string, number>;
  setPiece: boolean;
  onChange: (l: ManagerLineup) => void;
  /** Ausfälle der Liga (Pokémon-ID → Ausfall) */
  out: Record<string, ManagerAbsence>;
  /** Nächster Spieltag */
  next: number;
  /** Shinys der Liga */
  shinies?: readonly number[];
  /** Saisontore je Pokémon des eigenen Teams */
  goals?: ReadonlyMap<number, number>;
  /** Saisonvorlagen je Pokémon des eigenen Teams */
  assists?: ReadonlyMap<number, number>;
}) {
  const t = useT();
  const tx = t.draft.manager;
  const { byId, scale } = usePokemonData();
  const { sprite } = useSettings();
  const sc = scale('all');
  const [pick, setPick] = useState<Selection>(null);
  const [sortBy, setSortBy] = useState<SquadSort | null>(null);
  const formOf = (id: number) => form[id] ?? 0;
  const defs = FORMATIONS[lineup.formation].slots;
  const inLineup = new Set([...lineup.slots, ...(lineup.ss != null ? [lineup.ss] : [])]);
  const bench = rosterOf(team).filter((id) => !inLineup.has(id));
  const squadOf = (l: Omit<ManagerLineup, 'auto'>) =>
    l.slots.flatMap((id, i) => {
      const p = byId.get(id);
      return p ? [{ p, pos: FORMATIONS[l.formation].slots[i].pos }] : [];
    });
  const shinySet = useMemo(() => (shinies?.length ? new Set(shinies) : undefined), [shinies]);
  const strength = lineupScore(squadOf(lineup), sc, formOf, team.captain, shinySet);
  const absent = absentAt({ out }, next);
  const outText = (id: number): string | null => {
    const a = absent.has(id) ? out[id] : undefined;
    return a ? (a.kind === 'red' ? tx.outRed(a.until) : tx.outInjury(a.until)) : null;
  };
  const best = bestLineup(team, lineup.formation, byId, sc, form, setPiece, absent, shinySet, team.captain);
  const bestStrength = lineupScore(squadOf(best), sc, formOf, team.captain, shinySet);

  const manual = (l: Omit<ManagerLineup, 'auto'>) => {
    setPick(null);
    onChange({ ...l, auto: false });
  };
  const idAtSlot = (i: number) => (i === SS_INDEX ? lineup.ss : lineup.slots[i]);
  const withAtSlot = (l: Omit<ManagerLineup, 'auto'>, i: number, id: number | null) =>
    i === SS_INDEX ? { ...l, ss: id } : { ...l, slots: l.slots.map((x, j) => (j === i ? (id as number) : x)) };
  const swapSlots = (a: number, b: number) => {
    if (a === b) return setPick(null);
    const ia = idAtSlot(a);
    const ib = idAtSlot(b);
    manual(withAtSlot(withAtSlot(lineup, a, ib ?? null), b, ia ?? null));
  };
  const onSlot = (i: number) => {
    if (!pick) return setPick({ kind: 'slot', index: i });
    if (pick.kind === 'slot') return swapSlots(pick.index, i);
    manual(withAtSlot(lineup, i, pick.id));
  };
  const onBench = (k: number) => {
    const id = bench[k];
    if (pick?.kind === 'slot') return manual(withAtSlot(lineup, pick.index, id));
    setPick(pick?.kind === 'bench' && pick.id === id ? null : { kind: 'bench', id });
  };
  // Schwachstelle der Startelf: niedrigster Fit (mit Tagesform) – und ob ein fitter Bankspieler dort besser passt (+5)
  const weak = (() => {
    let w: { index: number; id: number; pos: PosCode; fit: number } | null = null;
    lineup.slots.forEach((id, i) => {
      const p = id != null ? byId.get(id) : undefined;
      if (!p || !defs[i]) return;
      const fit = formFit(p, defs[i].pos, sc, formOf(id));
      if (!w || fit < w.fit) w = { index: i, id, pos: defs[i].pos, fit };
    });
    if (!w) return null;
    const x: { index: number; id: number; pos: PosCode; fit: number } = w;
    let alt: { id: number; fit: number } | null = null;
    for (const id of bench) {
      const p = byId.get(id);
      if (!p || absent.has(id)) continue;
      const fit = formFit(p, x.pos, sc, formOf(id));
      if (fit >= x.fit + 5 && (!alt || fit > alt.fit)) alt = { id, fit };
    }
    return { ...x, fit: Math.round(x.fit), alt: alt && { id: alt.id, fit: Math.round(alt.fit) } };
  })();
  const slotState = (i: number): SlotState => (pick?.kind === 'slot' && pick.index === i ? 'selected' : pick ? 'target' : undefined);
  const pickedName = (() => {
    const id = pick?.kind === 'slot' ? idAtSlot(pick.index) : pick?.kind === 'bench' ? pick.id : null;
    const p = id != null ? byId.get(id) : undefined;
    return p ? t.game.pokemon(p) : null;
  })();

  // Kader-Tabelle: Elf in Formationsreihenfolge, Standardschütze, dann die Bank
  const positions = [...new Set(defs.map((d) => d.pos))];
  const rows: { p: Pokemon; role: PosCode | null; fit: number }[] = [];
  lineup.slots.forEach((id, i) => {
    const p = byId.get(id);
    if (p) rows.push({ p, role: defs[i].pos, fit: formFit(p, defs[i].pos, sc, formOf(id)) });
  });
  if (lineup.ss != null) {
    const p = byId.get(lineup.ss);
    if (p) rows.push({ p, role: 'SS', fit: formFit(p, 'SS', sc, formOf(p.id)) });
  }
  for (const id of bench) {
    const p = byId.get(id);
    if (p) rows.push({ p, role: null, fit: Math.max(...positions.map((pos) => formFit(p, pos, sc, formOf(id)))) });
  }
  // Sortierung per Klick auf den Spaltenkopf (absteigend; ohne: Elf, Standardschütze, Bank)
  const sortVal = (r: (typeof rows)[number]) =>
    sortBy === 'fit'
      ? r.fit
      : sortBy === 'form'
        ? formOf(r.p.id)
        : sortBy === 'goals'
          ? (goals?.get(r.p.id) ?? 0)
          : sortBy === 'assists'
            ? (assists?.get(r.p.id) ?? 0)
            : sortBy === 'starts'
              ? (starts?.get(r.p.id) ?? 0)
              : (goals?.get(r.p.id) ?? 0) + (assists?.get(r.p.id) ?? 0);
  const sorted = sortBy ? [...rows].sort((a, b) => sortVal(b) - sortVal(a)) : rows;
  const sortHead = (key: SquadSort, label: string, title?: string) => (
    <th scope="col" title={title} aria-sort={sortBy === key ? 'descending' : undefined}>
      <button type="button" className="manager__sort" onClick={() => setSortBy(sortBy === key ? null : key)}>
        {label}
        {sortBy === key ? ' ▼' : ''}
      </button>
    </th>
  );

  return (
    <section className="card manager__lineup" aria-labelledby="manager-lineup">
      <div className="manager__lineup-head">
        <h2 id="manager-lineup" className="section-title">
          {tx.lineupTitle}
        </h2>
        <span className="manager__strength" title={tx.strengthTitle}>
          <strong>{tx.strength(strength)}</strong>
          {bestStrength > strength && <span className="muted"> · {tx.bestStrength(bestStrength)}</span>}
          {(() => {
            // Ø Tagesform der Startelf zum nächsten Spieltag (−2 … +2)
            const ids = lineup.slots.filter((id): id is number => id != null);
            if (!ids.length) return null;
            const avg = ids.reduce((a, id) => a + formOf(id), 0) / ids.length;
            return (
              <span className={`muted manager__formavg ${avg > 0 ? 'is-up' : avg < 0 ? 'is-down' : ''}`} title={tx.formAvgTitle}>
                {' · '}
                {tx.formAvg(avg)}
              </span>
            );
          })()}
        </span>
      </div>
      <div className="manager__controls">
        <label className="field manager__formation">
          <span className="field__label">{tx.formation}</span>
          <select
            className="input"
            value={lineup.formation}
            onChange={(e) => {
              const formation = e.target.value as FormationId;
              setPick(null);
              onChange({ ...bestLineup(team, formation, byId, sc, form, setPiece, absent, shinySet, team.captain), auto: lineup.auto });
            }}
          >
            {FORMATION_IDS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="draft-check">
          <input
            type="checkbox"
            checked={lineup.auto}
            onChange={(e) => {
              setPick(null);
              onChange({ ...lineup, auto: e.target.checked });
            }}
          />{' '}
          {tx.auto}
        </label>
        <button type="button" className="btn btn--small" disabled={bestStrength <= strength} onClick={() => manual(best)}>
          {tx.best}
        </button>
      </div>
      <p className="muted small">{lineup.auto ? tx.autoNote : tx.manualNote}</p>
      {(() => {
        // Andere Formation mit spürbar höherer bestmöglicher Stärke? (Tipp mit Knopf zum Übernehmen)
        let tip: { formation: FormationId; strength: number; lineup: Omit<ManagerLineup, 'auto'> } | null = null;
        for (const f of FORMATION_IDS) {
          if (f === lineup.formation) continue;
          const l = bestLineup(team, f, byId, sc, form, setPiece, absent, shinySet, team.captain);
          const n = lineupScore(squadOf(l), sc, formOf, team.captain, shinySet);
          if (n >= bestStrength + FORMATION_TIP_MIN && n > (tip?.strength ?? 0)) tip = { formation: f, strength: n, lineup: l };
        }
        if (!tip) return null;
        const chosen = tip;
        return (
          <p className="hint manager__formation-tip">
            💡 {tx.formationTip(chosen.formation, chosen.strength)}{' '}
            <button
              type="button"
              className="btn btn--small"
              onClick={() => {
                setPick(null);
                onChange({ ...chosen.lineup, auto: lineup.auto });
              }}
            >
              {tx.formationTipApply(chosen.formation)}
            </button>
          </p>
        );
      })()}
      {(() => {
        // Startelf in schlechter Tagesform (nur bei eigener Aufstellung – automatisch rotiert ohnehin)
        const weak = lineup.auto ? [] : lineup.slots.filter((id) => formOf(id) < 0);
        if (!weak.length) return null;
        const names = weak.map((id) => (byId.get(id) ? t.game.pokemon(byId.get(id)!) : `#${id}`));
        return <p className="hint manager__formwarn">⚠️ {tx.formWarning(names)}</p>;
      })()}
      {(() => {
        // 🔥 Bankspieler in Topform (+2) – Gegenstück zur Formwarnung, ebenfalls nur bei eigener Aufstellung
        const hot = lineup.auto ? [] : bench.filter((id) => formOf(id) >= 2 && !absent.has(id) && byId.has(id));
        if (!hot.length) return null;
        return <p className="hint manager__benchhot">🔥 {tx.benchHot(hot.map((id) => t.game.pokemon(byId.get(id)!)))}</p>;
      })()}
      {(() => {
        // Ausfälle in der eigenen Elf: werden zum Anpfiff ersetzt
        const missing = [...lineup.slots, ...(lineup.ss != null ? [lineup.ss] : [])].filter((id) => absent.has(id));
        if (!missing.length) return null;
        const names = missing.map((id) => (byId.get(id) ? t.game.pokemon(byId.get(id)!) : `#${id}`));
        return <p className="hint manager__formwarn">🚑 {tx.outWarning(names)}</p>;
      })()}
      {(() => {
        // Kapitän zählt nur in der Startelf doppelt – auf der Bank oder bei Ausfall verpufft der Bonus
        const c = team.captain;
        const p = c != null ? byId.get(c) : undefined;
        if (!p) return null;
        if (absent.has(p.id)) return <p className="hint manager__formwarn">©️ {tx.captainOut(t.game.pokemon(p))}</p>;
        if (!lineup.slots.includes(p.id)) return <p className="hint manager__formwarn">©️ {tx.captainBench(t.game.pokemon(p))}</p>;
        return null;
      })()}
      <p className={`hint ${pick ? 'hint--active' : ''}`}>{pickedName ? tx.selected(pickedName) : tx.swapHint}</p>
      {weak && (
        <p className="small manager__weak">
          {tx.weakSpot(t.game.posShort[weak.pos], t.game.pokemon(byId.get(weak.id)!), weak.fit)}
          {weak.alt && (
            <>
              {' · '}
              {tx.weakAlt(t.game.pokemon(byId.get(weak.alt.id)!), weak.alt.fit)}{' '}
              <button type="button" className="btn btn--small btn--ghost" onClick={() => manual(withAtSlot(lineup, weak.index, weak.alt!.id))}>
                {tx.weakSwap}
              </button>
            </>
          )}
        </p>
      )}
      <div className="manager__pitch">
        <Pitch
          highlight={weak ? [weak.index] : undefined}
          filledBadge={(i) => {
            // ⚽ Saisontore des Starters (ab 1)
            const id = i === SS_INDEX ? lineup.ss : lineup.slots[i];
            const n = id != null ? (goals?.get(id) ?? 0) : 0;
            return n > 0 ? { text: `⚽ ${n}`, title: tx.slotGoals(n) } : null;
          }}
          formation={lineup.formation}
          slots={lineup.slots}
          ss={setPiece ? lineup.ss : undefined}
          sprite={sprite}
          slotState={slotState}
          onSlotClick={onSlot}
          onSwap={swapSlots}
          ariaLabel={tx.lineupTitle}
          jerseys={team.jerseys}
          captain={team.captain ?? null}
          shinies={shinies}
        />
        <BenchRow
          bench={bench}
          sprite={sprite}
          onClick={onBench}
          state={(k) => (pick?.kind === 'bench' && pick.id === bench[k] ? 'selected' : pick?.kind === 'slot' ? 'target' : undefined)}
          extra={(id) => {
            // Bestpassende Position der Formation (mit Tagesform) – wohin der Bankspieler passt
            const p = byId.get(id);
            let best: { pos: PosCode; fit: number } | null = null;
            for (const pos of positions) {
              const fit = p ? formFit(p, pos, sc, formOf(id)) : 0;
              if (p && (!best || fit > best.fit)) best = { pos, fit };
            }
            return (
              <>
                <FormMark value={formOf(id)} />
                {best && (
                  <span className="manager__bench-best" title={tx.benchBest(t.game.posName[best.pos], Math.round(best.fit))}>
                    {t.game.posShort[best.pos]} {Math.round(best.fit)}
                  </span>
                )}
              </>
            );
          }}
        />
        {starts && played >= IRONMEN_AFTER && (() => {
          // 🔋 Dauerbrenner: in jedem gespielten Spiel von Beginn an dabei
          const iron = [...starts].filter(([id, n]) => n >= played && byId.has(id)).map(([id]) => id);
          return iron.length > 0 && (
            <p className="small muted manager__ironmen">{tx.ironmen(iron.map((id) => t.game.pokemon(byId.get(id)!)).join(', '), played)}</p>
          );
        })()}
        {starts && played >= UNUSED_AFTER && (() => {
          // 🪑 Bankspieler, die noch kein Spiel von Beginn an gemacht haben
          const unused = bench.filter((id) => !starts.has(id) && byId.has(id));
          return unused.length > 0 && (
            <p className="small muted manager__unused">{tx.benchUnused(unused.map((id) => t.game.pokemon(byId.get(id)!)).join(', '))}</p>
          );
        })()}
      </div>
      <h3 className="manager__squad-title">{tx.squadTitle}</h3>
      <p className="muted small">{tx.formNote(FORM_FIT)}</p>
      <div className="table-scroll">
        <table className="league-table manager__squad">
          <thead>
            <tr>
              <th scope="col" className="left">
                {tx.colPokemon}
              </th>
              <th scope="col">{tx.colRole}</th>
              {sortHead('fit', tx.colFit, tx.fitTitle)}
              {sortHead('form', tx.colForm)}
              {sortHead('goals', tx.colGoals, tx.goalsTitle)}
              {sortHead('assists', tx.colAssists, tx.assistsTitle)}
              {sortHead('points', tx.colPoints, tx.pointsTitle)}
              {sortHead('starts', tx.colStarts, tx.startsTitle)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.p.id} className={r.role ? '' : 'is-bench'}>
                <td className="left">
                  <Sprite pokemon={r.p} style={sprite} className="manager__squad-sprite" shiny={shinySet?.has(r.p.id)} /> {t.game.pokemon(r.p)}
                  {team.captain === r.p.id && (
                    <>
                      {' '}
                      <span className="manager__captain captain-badge" title={t.captain.title}>
                        C<span className="sr-only"> – {t.captain.title}</span>
                      </span>
                    </>
                  )}
                  {shinySet?.has(r.p.id) && (
                    <span title={t.shiny.title}>
                      {' '}
                      ✨<span className="sr-only">{t.shiny.title}</span>
                    </span>
                  )}
                  {(stars?.get(r.p.id) ?? 0) > 0 && (
                    <span className="manager__stars" title={tx.starsTitle(stars!.get(r.p.id)!)}>
                      {' '}⭐{stars!.get(r.p.id)! > 1 ? ` ${stars!.get(r.p.id)}` : ''}
                      <span className="sr-only"> – {tx.starsTitle(stars!.get(r.p.id)!)}</span>
                    </span>
                  )}
                  {outText(r.p.id) && (
                    <span className="manager__out" title={outText(r.p.id)!}>
                      {' '}
                      {out[r.p.id].kind === 'red' ? '🟥' : '🚑'}
                      <span className="sr-only"> – {outText(r.p.id)}</span>
                    </span>
                  )}
                </td>
                <td>
                  {r.role ? (
                    <PosBadge pos={r.role} />
                  ) : (
                    <span className="pos-badge pos-badge--bench" title={t.draft.bench.label}>
                      {t.draft.bench.short}
                    </span>
                  )}
                </td>
                <td>{Math.round(r.fit)}</td>
                <td>
                  <FormMark value={formOf(r.p.id)} />
                </td>
                <td>{goals?.get(r.p.id) || '–'}</td>
                <td>{assists?.get(r.p.id) || '–'}</td>
                <td>{(goals?.get(r.p.id) ?? 0) + (assists?.get(r.p.id) ?? 0) || '–'}</td>
                <td className="manager__starts">{starts?.get(r.p.id) || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Pokal der Manager-Saison: Auslosung bzw. gespielte Runden, nächste Runde, eigenes Abschneiden. */
export function ManagerCupView({
  cup,
  you,
  nameOf,
}: {
  cup: NonNullable<ManagerSnapshot['cup']>;
  you: number | null;
  nameOf: (i: number) => string;
}) {
  const t = useT();
  const tx = t.draft.manager;
  const stages = t.draft.cup.stage;
  const alive = cup.rounds.length ? cup.rounds[cup.rounds.length - 1].ties.map((x) => x.winner) : cup.bracket;
  const winner = cup.rounds[cup.rounds.length - 1]?.stage === 'final' ? cup.rounds[cup.rounds.length - 1].ties[0].winner : null;
  const nextStage = (['r16', 'qf', 'sf', 'final'] as const)[cup.rounds.length];
  const nextDay = CUP_MATCHDAYS[cup.rounds.length];
  const youOut = you != null && cup.bracket.includes(you) ? cup.rounds.find((r) => r.ties.some((x) => (x.home === you || x.away === you) && x.winner !== you)) : undefined;
  const score = (r: (typeof cup.rounds)[number], tie: (typeof r.ties)[number]) => {
    const m = cup.matches.find((x) => x.round === r.round && x.home === tie.home && x.away === tie.away);
    return m ? `${m.hg}:${m.ag}${tie.pens ? ` (${t.draft.cup.pens(tie.pens.home, tie.pens.away)})` : ''}` : '–';
  };
  return (
    <section className="card manager__cup" aria-labelledby="manager-cup">
      <h2 id="manager-cup" className="section-title">
        🏆 {tx.cupTitle}
      </h2>
      <p className="muted small">{tx.cupNote}</p>
      {winner != null ? (
        <p className="manager__cup-winner">
          <strong>{winner === you ? tx.cupYouWinner : tx.cupWinner(nameOf(winner))}</strong>
        </p>
      ) : (
        <>
          {nextStage && nextDay && <p>{tx.cupNext(stages[nextStage], nextDay)}</p>}
          {you != null && cup.bracket.includes(you) && (
            <p className="small">{youOut ? tx.cupYouOut(stages[youOut.stage]) : alive.includes(you) ? tx.cupYouAlive : null}</p>
          )}
        </>
      )}
      {cup.rounds.length > 0 && winner == null && nextStage && alive.length >= 2 && (() => {
        // Nächste Runde steht schon fest: die Weitergekommenen der Reihe nach gepaart (wie die Engine)
        const pairs = Array.from({ length: Math.floor(alive.length / 2) }, (_, i) => [alive[2 * i], alive[2 * i + 1]] as const);
        const mine = you != null ? pairs.find(([h, a]) => h === you || a === you) : undefined;
        return (
          <div className="manager__cup-round manager__cup-next">
            <h3 className="manager__cup-stage">
              {stages[nextStage]}
              {nextDay ? ` · ${t.draft.matchday(nextDay)}` : ''}
            </h3>
            {mine && <p className="small manager__cup-opp">⚔️ {tx.cupNextOpp(nameOf(mine[0] === you ? mine[1] : mine[0]))}</p>}
            <ul className="manager__cup-ties">
              {pairs.map(([h, a]) => (
                <li key={`${h}-${a}`} className={h === you || a === you ? 'is-user' : ''}>
                  <span>{nameOf(h)}</span>
                  <span className="manager__cup-score">–</span>
                  <span>{nameOf(a)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      {[...cup.rounds].reverse().map((r) => (
        <div key={r.round} className="manager__cup-round">
          <h3 className="manager__cup-stage">
            {stages[r.stage]} · {t.draft.matchday(r.round)}
          </h3>
          <ul className="manager__cup-ties">
            {r.ties.map((tie) => (
              <li key={`${tie.home}-${tie.away}`} className={tie.home === you || tie.away === you ? 'is-user' : ''}>
                <span className={tie.winner === tie.home ? 'is-winner' : ''}>{nameOf(tie.home)}</span>
                <span className="manager__cup-score">{score(r, tie)}</span>
                <span className={tie.winner === tie.away ? 'is-winner' : ''}>{nameOf(tie.away)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!cup.rounds.length && (
        <div className="manager__cup-round">
          <h3 className="manager__cup-stage">{tx.cupDraw}</h3>
          <ul className="manager__cup-ties">
            {Array.from({ length: cup.bracket.length / 2 }, (_, i) => [cup.bracket[2 * i], cup.bracket[2 * i + 1]]).map(([h, a]) => (
              <li key={`${h}-${a}`} className={h === you || a === you ? 'is-user' : ''}>
                <span>{nameOf(h)}</span>
                <span className="manager__cup-score">–</span>
                <span>{nameOf(a)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Ausfälle der Liga zum nächsten Spieltag (Verletzungen und Sperren) mit Team. */
function OutList({ state, out, next }: { state: DraftSnapshot; out: Record<string, ManagerAbsence>; next: number }) {
  const t = useT();
  const tx = t.draft.manager;
  const { byId } = usePokemonData();
  const rows = [...absentAt({ out }, next)].flatMap((id) => {
    const team = state.teams.find((tm) => rosterOf(tm).includes(id));
    const p = byId.get(id);
    return team && p ? [{ id, team, p, a: out[id] }] : [];
  });
  return (
    <section className="card manager__out-list" aria-labelledby="manager-out">
      <h2 id="manager-out" className="section-title">
        {tx.outTitle}
      </h2>
      <p className="muted small">{tx.outNote}</p>
      {rows.length ? (
        <ul className="manager__out-rows">
          {rows.map(({ id, team, p, a }) => (
            <li key={id}>
              <span aria-hidden="true">{a.kind === 'red' ? '🟥' : '🚑'}</span> <strong>{t.game.pokemon(p)}</strong>{' '}
              <span className="muted">
                ({teamLabel(team, t)}) · {a.kind === 'red' ? tx.outRed(a.until) : tx.outInjury(a.until)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small">{tx.outNone}</p>
      )}
    </section>
  );
}

/** Tabelle der Manager-Saison (Platz, Team, Spiele, S/U/N, Tore, Punkte). */
function ManagerTable({
  rows,
  you,
  nameOf,
  matches,
  played,
  league,
  crestOf,
  top,
  rival = null,
}: {
  /** Nächster Gegner des eigenen Teams (⚔️ in der Tabelle) */
  rival?: number | null;
  /** Grüne/goldene Zone oben: Aufstiegsplätze (Karriere unter der 1. Liga) bzw. nur der Meister */
  top: number;
  /** Wappen eines Teams (null = keins) */
  crestOf: (i: number) => CrestData | null;
  rows: import('../lib/season').TableRow[];
  you: number | null;
  nameOf: (i: number) => string;
  /** Gespielte Spiele und Spieltage – für Formkurve und Platzveränderung */
  matches: Match[];
  played: number;
  league: LeagueResult;
}) {
  const t = useT();
  const c = t.draft.col;
  // Platzveränderung gegenüber dem Vorspieltag (erst ab dem 2. Spieltag)
  const delta = useMemo(() => {
    if (played < 2) return null;
    return leagueTimeline(league).at(-1)?.delta ?? null;
  }, [league, played]);
  // Gesamt-, Heim- oder Auswärtstabelle (wie im Saisonergebnis)
  const [view, setView] = useState<'all' | 'home' | 'away'>('all');
  const shownRows = useMemo(() => (view === 'all' ? rows : sideTable(league.teams, matches, view)), [view, rows, league, matches]);
  return (
    <>
      {played > 0 && (
        <Segmented
          label={t.draft.results.tableView}
          hideLabel
          value={view}
          onChange={setView}
          options={(['all', 'home', 'away'] as const).map((v) => ({ value: v, label: t.draft.results.tableViews[v] }))}
        />
      )}
      <div className="table-scroll">
        <table className="league-table">
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
              <th scope="col" title={c.ptsTitle}>
                {c.pts}
              </th>
              {played > 0 && (
                <th scope="col" title={c.formTitle} className="league-live__form-col">
                  {c.form}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r, i) => (
              <tr key={r.team} className={view === 'all' ? tableRowClass(r.team === you, i + 1, rows.length, top) : r.team === you ? 'is-user' : ''}>
                <td>
                  {i + 1} {view === 'all' && delta && <Trend delta={delta[r.team]} />}
                </td>
                <td className="left">
                  {crestOf(r.team) && (
                    <>
                      <Crest crest={crestOf(r.team)!} size={16} />{' '}
                    </>
                  )}
                  {nameOf(r.team)}
                  {r.team === rival && (
                    <span className="manager__table-rival" title={t.draft.manager.rivalMark}>
                      {' '}
                      <span aria-hidden="true">⚔️</span>
                      <span className="sr-only"> – {t.draft.manager.rivalMark}</span>
                    </span>
                  )}
                </td>
                <td>{r.played}</td>
                <td>{r.w}</td>
                <td>{r.d}</td>
                <td>{r.l}</td>
                <td>{`${r.gf}:${r.ga}`}</td>
                <td>
                  <strong>{r.pts}</strong>
                </td>
                {played > 0 && (
                  <td className="league-live__form-col">
                    <FormDots form={recentForm(matches, r.team, played)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {view === 'all' && <TableLegend total={rows.length} top={top} />}
      </div>
    </>
  );
}

/** Serie eines Teams: „🔥 Seit N Spielen ungeschlagen“ bzw. „🥶 Seit N Spielen sieglos“ */
function SeriesLine({ run }: { run: { kind: 'unbeaten' | 'winless'; length: number } }) {
  const tx = useT().draft.manager;
  return run.kind === 'unbeaten' ? (
    <p className="small manager__series is-up">🔥 {tx.seriesUnbeaten(run.length)}</p>
  ) : (
    <p className="small manager__series is-down">🥶 {tx.seriesWinless(run.length)}</p>
  );
}
