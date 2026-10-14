import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FORMATION_IDS, FORMATIONS } from '../config/formations';
import { localeOf, useLang, useT } from '../i18n';
import type { DraftTeam, ManagerLineup, ManagerOffer, ManagerTransfer } from '../lib/api/draftContract';
import { rosterOf } from '../lib/draftEngine';
import { leagueTimeline, matchFor, playerOfRound, recentForm, storedLeague } from '../lib/leagueTimeline';
import { showNotify } from '../lib/notify';
import { bestLineup, FORM_FIT, formFit, lineupScore, managerSchedule, squadStrength } from '../lib/manager';
import type { LeagueResult, Match } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { teamLabel, type DraftRoom } from '../state/useDraftRoom';
import type { FormationId, Pokemon, PosCode } from '../types';
import { PosBadge } from './Badges';
import { BenchRow } from './BenchRow';
import { FixtureList, FormDots, Trend } from './LeagueTicker';
import { ReplayToggle, useMatchReport } from './MatchReport';
import { SeasonStats } from './SeasonStats';
import { Sprite } from './Sprite';
import { Pitch, SS_INDEX, type SlotState } from './Pitch';
import { TradePanel, TransferMarket } from './ManagerMarket';
import '../styles/draft.css';

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
function useServerNow(clockOffset: number): number {
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
    const body = r
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
    return l ? { formation: l.formation, ids: l.slots } : null;
  });

  if (!m || !league) {
    return (
      <div className="boot" role="status">
        <div className="boot__ball" aria-hidden="true" />
        <p>{t.draft.season.preparing}</p>
      </div>
    );
  }

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
  const last = m.played > 0 ? league.matches.filter((x) => x.round === m.played) : [];
  const lastTransfers = (m.transfers ?? []).filter((x) => x.matchday === m.played);
  const star = playerOfRound(last);
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
    </li>
  );
  // Nächster Gegner: Tabellenplatz und Form (letzte fünf Spiele)
  const myNext = you != null ? upcoming.find((x) => x.home === you || x.away === you) : undefined;
  const rival = myNext ? (myNext.home === you ? myNext.away : myNext.home) : null;
  const rivalPlace = rival != null ? league.table.findIndex((r) => r.team === rival) + 1 : 0;
  const when = m.nextAt != null ? new Date(m.nextAt - room.clockOffset).toLocaleString(localeOf(lang), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="manager">
      {report.element}
      <section className="card manager__status" aria-live="polite">
        <span className="kicker">{tx.kicker}</span>
        <h2 className="section-title">{tx.played(m.played, m.total)}</h2>
        {m.nextAt != null && (
          <p className="manager__kickoff">
            <strong>{tx.next(nextNo)}</strong> · {tx.kickoffIn(m.nextAt - now)} <span className="muted">{tx.kickoffAt(when)}</span>
          </p>
        )}
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
              <FormDots form={recentForm(league.matches, rival, m.played)} />
            </p>
          )}
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
        />
      ) : (
        <p className="notice">{tx.spectator}</p>
      )}

      {room.me && !readOnly && m.nextAt != null && meIndex >= 0 && (
        <TransferMarket
          state={s}
          team={s.teams[meIndex]}
          claim={m.claim ?? null}
          matchday={nextNo}
          onTransfer={(inId, outId) => room.setTransfer(inId, outId)}
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
            {tx.lastResults(m.played)}
          </h2>
          <ReplayToggle />
          <FixtureList matches={last} you={you} nameOf={nameOf} pokemonName={pokemonName} onOpen={report.open} />
          {star && (
            <p className={`manager__star ${star.teamIndex === you ? 'is-you' : ''}`}>
              <span aria-hidden="true">⭐</span> <strong>{tx.starTitle}</strong>{' '}
              {byId.get(star.pokemonId) && <Sprite pokemon={byId.get(star.pokemonId)!} style={sprite} className="manager__star-sprite" />}
              {pokemonName(star.pokemonId)} <span className="muted">({nameOf(star.teamIndex)})</span> – {tx.starLine(star.goals, star.assists)}
            </p>
          )}
        </section>
      )}

      {m.played > 0 && <SeasonStats league={league} you={you} nameOf={nameOf} />}

      <section className="card" aria-labelledby="manager-table">
        <h2 id="manager-table" className="section-title">
          {tx.tableTitle}
        </h2>
        <ManagerTable rows={league.table} you={you} nameOf={nameOf} matches={league.matches} played={m.played} league={league} />
      </section>
    </div>
  );
}

/** Eigene Aufstellung: tauschen (Feld, Standardschütze, Bank), Formation, automatisch, Kader mit Tagesform. */
function LineupEditor({
  team,
  lineup,
  form,
  setPiece,
  onChange,
}: {
  team: DraftTeam;
  lineup: ManagerLineup;
  form: Record<string, number>;
  setPiece: boolean;
  onChange: (l: ManagerLineup) => void;
}) {
  const t = useT();
  const tx = t.draft.manager;
  const { byId, scale } = usePokemonData();
  const { sprite } = useSettings();
  const sc = scale('all');
  const [pick, setPick] = useState<Selection>(null);
  const formOf = (id: number) => form[id] ?? 0;
  const defs = FORMATIONS[lineup.formation].slots;
  const inLineup = new Set([...lineup.slots, ...(lineup.ss != null ? [lineup.ss] : [])]);
  const bench = rosterOf(team).filter((id) => !inLineup.has(id));
  const squadOf = (l: Omit<ManagerLineup, 'auto'>) =>
    l.slots.flatMap((id, i) => {
      const p = byId.get(id);
      return p ? [{ p, pos: FORMATIONS[l.formation].slots[i].pos }] : [];
    });
  const strength = lineupScore(squadOf(lineup), sc, formOf);
  const best = bestLineup(team, lineup.formation, byId, sc, form, setPiece);
  const bestStrength = lineupScore(squadOf(best), sc, formOf);

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
              onChange({ ...bestLineup(team, formation, byId, sc, form, setPiece), auto: lineup.auto });
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
              <th scope="col" title={tx.fitTitle}>
                {tx.colFit}
              </th>
              <th scope="col">{tx.colForm}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p.id} className={r.role ? '' : 'is-bench'}>
                <td className="left">{t.game.pokemon(r.p)}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
}: {
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
              <td className="left">{nameOf(r.team)}</td>
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
