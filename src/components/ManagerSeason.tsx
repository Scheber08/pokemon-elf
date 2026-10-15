import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FORMATION_IDS, FORMATIONS } from '../config/formations';
import { localeOf, useLang, useT } from '../i18n';
import type { DraftSnapshot, DraftTeam, ManagerSnapshot, ManagerLineup, ManagerOffer, ManagerTransfer } from '../lib/api/draftContract';
import { rosterOf } from '../lib/draftEngine';
import { leagueTimeline, matchFor, playerOfRound, recentForm, storedLeague } from '../lib/leagueTimeline';
import { liveDuration, liveMinute, partialMatch } from '../lib/liveMatchday';
import { showNotify } from '../lib/notify';
import { shinyTeamBoost } from '../lib/shiny';
import { bestLineup, FORM_FIT, formFit, kickoffAt, lineupScore, managerSchedule, squadStrength } from '../lib/manager';
import { buildTable, type LeagueResult, type Match } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { teamLabel, type DraftRoom } from '../state/useDraftRoom';
import type { FormationId, Pokemon, PosCode } from '../types';
import { PosBadge } from './Badges';
import { BenchRow } from './BenchRow';
import { FixtureList, FormDots, Trend } from './LeagueTicker';
import { ReplayToggle, useMatchReport } from './MatchReport';
import { CaptainPicker } from './CaptainPicker';
import { JerseyEditor } from './JerseyEditor';
import { PlaceChart } from './PlaceChart';
import { SeasonStats } from './SeasonStats';
import { Sprite } from './Sprite';
import { Pitch, SS_INDEX, type SlotState } from './Pitch';
import { TradePanel, TransferMarket } from './ManagerMarket';
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
    const body = live
      ? t.draft.manager.notifyLive(playedNow)
      : r
        ? t.draft.manager.notifyResult(t.draft.outcome[r.outcome], r.gf, r.ga, nameOf(r.opponent))
        : t.draft.manager.notifyPlayed(playedNow);
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
  const schedule = managerSchedule(league.teams.length);
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
            </p>
          );
        })()}
        {/* Karriere: frühere Saisons des eigenen Teams */}
        {(() => {
          const mine = room.me ? (s.career?.history ?? []).filter((h) => h.places[room.me!.id] != null) : [];
          if (!mine.length) return null;
          return (
            <p className="muted small manager__career">
              {t.online.careerHistory}{' '}
              {mine.map((h) => t.online.careerPlace(h.season, h.tier, h.places[room.me!.id])).join(' · ')}
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
          </p>
          {m.played > 0 && (
            <p className="manager__rival-line">
              {rivalPlace > 0 && <span>{tx.rivalPlace(rivalPlace)}</span>}
              <FormDots form={recentForm(shown.matches, rival, m.played)} />
            </p>
          )}
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
        />
      </section>
    </div>
  );
}

/** Eigene Aufstellung: tauschen (Feld, Standardschütze, Bank), Formation, automatisch, Kader mit Tagesform. */
/** Saisontore je Pokémon eines Liga-Teams (gespielte Spiele) */
type SquadSort = 'fit' | 'form' | 'goals' | 'assists';

/** Saisonvorlagen je Pokémon eines Liga-Teams */
function assistsOf(league: LeagueResult | null | undefined, team: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of league?.matches ?? []) {
    const own = m.home === team ? m.homeScorers : m.away === team ? m.awayScorers : [];
    for (const g of own) if (g.assist != null) out.set(g.assist, (out.get(g.assist) ?? 0) + 1);
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
}: {
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
    sortBy === 'fit' ? r.fit : sortBy === 'form' ? formOf(r.p.id) : sortBy === 'goals' ? (goals?.get(r.p.id) ?? 0) : (assists?.get(r.p.id) ?? 0);
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
        // Startelf in schlechter Tagesform (nur bei eigener Aufstellung – automatisch rotiert ohnehin)
        const weak = lineup.auto ? [] : lineup.slots.filter((id) => formOf(id) < 0);
        if (!weak.length) return null;
        const names = weak.map((id) => (byId.get(id) ? t.game.pokemon(byId.get(id)!) : `#${id}`));
        return <p className="hint manager__formwarn">⚠️ {tx.formWarning(names)}</p>;
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
      <div className="manager__pitch">
        <Pitch
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
          extra={(id) => <FormMark value={formOf(id)} />}
        />
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.p.id} className={r.role ? '' : 'is-bench'}>
                <td className="left">
                  {t.game.pokemon(r.p)}
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
}: {
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
  return (
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
          {rows.map((r, i) => (
            <tr key={r.team} className={r.team === you ? 'is-user' : ''}>
              <td>
                {i + 1} {delta && <Trend delta={delta[r.team]} />}
              </td>
              <td className="left">
                {crestOf(r.team) && (
                  <>
                    <Crest crest={crestOf(r.team)!} size={16} />{' '}
                  </>
                )}
                {nameOf(r.team)}
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
    </div>
  );
}
