import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FORMATION_IDS, FORMATIONS } from '../config/formations';
import { localeOf, useLang, useT } from '../i18n';
import type { DraftSnapshot, DraftTeam, ManagerClaim, ManagerLineup, ManagerOffer, ManagerTransfer } from '../lib/api/draftContract';
import { rosterOf } from '../lib/draftEngine';
import { matchFor, playerOfRound, recentForm, storedLeague } from '../lib/leagueTimeline';
import { showNotify } from '../lib/notify';
import { bestLineup, FORM_FIT, formFit, freeAgents, lineupScore, managerSchedule, squadStrength } from '../lib/manager';
import { positionFit } from '../lib/fit';
import type { Match } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { teamLabel, type DraftRoom } from '../state/useDraftRoom';
import type { FormationId, Pokemon, PosCode } from '../types';
import { PosBadge } from './Badges';
import { BenchRow } from './BenchRow';
import { FixtureList, FormDots } from './LeagueTicker';
import { ReplayToggle, useMatchReport } from './MatchReport';
import { SeasonStats } from './SeasonStats';
import { Sprite } from './Sprite';
import { Pitch, SS_INDEX, type SlotState } from './Pitch';
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
          <ul className="manager__transfers">
            {lastTransfers
              // Ein Tausch steht zweimal im Protokoll (je Team) – angezeigt wird er einmal
              .filter((x) => !x.with || x.teamId < x.with)
              .map((x) => {
                const label = (id: string) => {
                  const tm = s.teams.find((y) => y.id === id);
                  return tm ? teamLabel(tm, t) : '?';
                };
                return (
                  <li key={`${x.teamId}-${x.in}`}>
                    {x.with
                      ? tx.tradeLine(label(x.teamId), pokemonName(x.out), label(x.with), pokemonName(x.in))
                      : tx.transferLine(label(x.teamId), pokemonName(x.in), pokemonName(x.out))}
                  </li>
                );
              })}
          </ul>
        </section>
      )}

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
        <ManagerTable rows={league.table} you={you} nameOf={nameOf} />
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

/** Transfermarkt: eigenen Wunsch setzen (wen abgeben, wen holen) bzw. zurückziehen. */
function TransferMarket({
  state,
  team,
  claim,
  matchday,
  onTransfer,
}: {
  state: Pick<DraftSnapshot, 'settings' | 'teams'>;
  team: DraftTeam;
  claim: ManagerClaim | null;
  matchday: number;
  onTransfer: (inId: number | null, outId: number | null) => void;
}) {
  const t = useT();
  const tx = t.draft.manager;
  const { all: list, byId, scale } = usePokemonData();
  const sc = scale('all');
  const roster = rosterOf(team);
  const defs = FORMATIONS[team.formation].slots;
  const positions = [...new Set(defs.map((d) => d.pos))];
  /** Beste Position der Formation samt Fit */
  const best = (p: Pokemon) =>
    positions.reduce(
      (a, pos) => {
        const fit = positionFit(p, pos, sc);
        return fit > a.fit ? { pos, fit } : a;
      },
      { pos: positions[0], fit: -1 },
    );
  // Vorschlag zum Abgeben: der schwächste im Kader
  const [out, setOut] = useState<number>(
    () => claim?.out ?? roster.reduce((a, id) => ((byId.get(id) ? best(byId.get(id)!).fit : 999) < (byId.get(a) ? best(byId.get(a)!).fit : 999) ? id : a), roster[0]),
  );
  const [query, setQuery] = useState('');
  const teamsKey = state.teams.map((tm) => rosterOf(tm).join(',')).join('|');
  const free = useMemo(
    () => freeAgents(state, list).map((p) => ({ p, ...best(p) })).sort((a, b) => b.fit - a.fit || a.p.id - b.p.id),
    [teamsKey, list, team.formation],
  );
  const q = query.trim().toLowerCase();
  const shown = (q ? free.filter((x) => t.game.pokemon(x.p).toLowerCase().includes(q)) : free).slice(0, 12);
  const name = (id: number) => {
    const p = byId.get(id);
    return p ? t.game.pokemon(p) : `#${id}`;
  };
  const validOut = roster.includes(out) ? out : roster[0];
  return (
    <section className="card manager__market" aria-labelledby="manager-market">
      <h2 id="manager-market" className="section-title">
        {tx.marketTitle} <small className="muted">{tx.marketFree(free.length)}</small>
      </h2>
      <p className="muted small">{tx.marketNote(matchday)}</p>
      {claim && (
        <p className="hint hint--active manager__claim">
          {tx.marketClaim(name(claim.in), name(claim.out), matchday)}{' '}
          <button type="button" className="btn btn--small btn--ghost" onClick={() => onTransfer(null, null)}>
            {tx.marketCancel}
          </button>
        </p>
      )}
      <div className="manager__controls">
        <label className="field">
          <span className="field__label">{tx.marketOut}</span>
          <select className="input" value={validOut} onChange={(e) => setOut(Number(e.target.value))}>
            {roster.map((id) => {
              const p = byId.get(id);
              const b = p ? best(p) : null;
              return (
                <option key={id} value={id}>
                  {name(id)}
                  {b ? ` (${tx.marketFit(t.game.posShort[b.pos], Math.round(b.fit))})` : ''}
                </option>
              );
            })}
          </select>
        </label>
        <label className="field manager__search">
          <span className="field__label">{tx.marketSearch}</span>
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {shown.length ? (
        <ul className="manager__free">
          {shown.map(({ p, pos, fit }) => (
            <li key={p.id} className={claim?.in === p.id ? 'is-claimed' : ''}>
              <span className="manager__free-name">{t.game.pokemon(p)}</span>
              <PosBadge pos={pos} />
              <span className="manager__free-fit">{Math.round(fit)}</span>
              <button
                type="button"
                className="btn btn--small"
                aria-label={tx.marketTakeAria(t.game.pokemon(p), name(validOut))}
                disabled={claim?.in === p.id && claim.out === validOut}
                onClick={() => onTransfer(p.id, validOut)}
              >
                {tx.marketTake}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{tx.marketNone}</p>
      )}
    </section>
  );
}

/** Tabelle der Manager-Saison (Platz, Team, Spiele, S/U/N, Tore, Punkte). */
function ManagerTable({ rows, you, nameOf }: { rows: import('../lib/season').TableRow[]; you: number | null; nameOf: (i: number) => string }) {
  const t = useT();
  const c = t.draft.col;
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team} className={r.team === you ? 'is-user' : ''}>
              <td>{i + 1}</td>
              <td className="left">{nameOf(r.team)}</td>
              <td>{r.played}</td>
              <td>{r.w}</td>
              <td>{r.d}</td>
              <td>{r.l}</td>
              <td>{`${r.gf}:${r.ga}`}</td>
              <td>
                <strong>{r.pts}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Tausch mit anderen gedrafteten Teams: eigenes Pokémon gegen eins aus einem anderen Kader anbieten;
 * eingehende Angebote annehmen oder ablehnen, eigene zurückziehen. CPU-Teams antworten sofort.
 */
function TradePanel({
  state,
  team,
  offers,
  done,
  error,
  nameOf,
  onOffer,
  onAnswer,
}: {
  state: Pick<DraftSnapshot, 'teams'>;
  team: DraftTeam;
  offers: ManagerOffer[];
  /** Eigene Tausche vor dem nächsten Spieltag (Bestätigung) */
  done: ManagerTransfer[];
  /** Letzter Fehler des Raums – nach eigenem Senden auch hier angezeigt (z. B. Absage des CPU-Teams) */
  error: string | null;
  nameOf: (teamId: string) => string;
  onOffer: (to: string, give: number, get: number) => void;
  onAnswer: (id: number, accept: boolean) => void;
}) {
  const t = useT();
  const tx = t.draft.manager;
  const { byId, scale } = usePokemonData();
  const sc = scale('all');
  const others = state.teams.filter((x) => x.id !== team.id);
  const roster = rosterOf(team);
  const [give, setGive] = useState<number>(roster[0]);
  const [to, setTo] = useState<string>(others[0]?.id ?? '');
  const partner = others.find((x) => x.id === to) ?? others[0];
  const theirs = partner ? rosterOf(partner) : [];
  const [get, setGet] = useState<number | null>(null);
  /** Gerade gesendet: ein Fehler gehört dann zu diesem Tausch */
  const [sent, setSent] = useState(false);
  // Erfolgreicher Tausch: eine ältere Absage gehört nicht mehr dazu
  useEffect(() => setSent(false), [done.length]);
  const positions = [...new Set(FORMATIONS[team.formation].slots.map((d) => d.pos))];
  const fitFor = (id: number) => {
    const p = byId.get(id);
    return p ? Math.round(Math.max(...positions.map((pos) => positionFit(p, pos, sc)))) : 0;
  };
  const name = (id: number) => {
    const p = byId.get(id);
    return p ? t.game.pokemon(p) : `#${id}`;
  };
  const validGive = roster.includes(give) ? give : roster[0];
  const validGet = get != null && theirs.includes(get) ? get : theirs[0];
  // Wirkung eines Tauschs auf die eigene beste Elf (gewichtete Fit-Punkte, ohne Tagesform)
  const base = squadStrength(team, byId, sc);
  const effect = (out: number, inn: number) => {
    const swap = (ids: (number | null)[]) => ids.map((id) => (id === out ? inn : id));
    const after = { ...team, slots: swap(team.slots), ss: team.ss === out ? inn : team.ss, ...(team.bench ? { bench: swap(team.bench) as number[] } : {}) };
    return squadStrength(after, byId, sc) - base;
  };
  const Effect = ({ out, inn }: { out: number; inn: number }) => {
    const d = effect(out, inn);
    return (
      <small className={`manager__effect ${d > 0.05 ? 'is-up' : d < -0.05 ? 'is-down' : ''}`} title={tx.effectTitle}>
        {tx.effect(d)}
      </small>
    );
  };
  const incoming = offers.filter((o) => o.to === team.id);
  const outgoing = offers.filter((o) => o.from === team.id);
  if (!partner) return null;
  return (
    <section className="card manager__trade" aria-labelledby="manager-trade">
      <h2 id="manager-trade" className="section-title">
        {tx.tradeTitle}
      </h2>
      <p className="muted small">{tx.tradeNote}</p>
      {done.map((x) => (
        <p key={`${x.in}-${x.out}`} className="hint hint--active">
          ✓ {tx.tradeDone(name(x.out), nameOf(x.with!), name(x.in))}
        </p>
      ))}
      {incoming.length > 0 && (
        <ul className="manager__offers">
          {incoming.map((o) => (
            <li key={o.id} className="hint hint--active">
              <span>
                {tx.offerIn(nameOf(o.from), name(o.give), name(o.get))}
                {state.teams.find((x) => x.id === o.from)?.cpu && <small className="muted"> · {tx.offerCpuExpires}</small>}{' '}
                <Effect out={o.get} inn={o.give} />
              </span>
              <span className="manager__offer-actions">
                <button type="button" className="btn btn--small" onClick={() => onAnswer(o.id, true)}>
                  {tx.offerAccept}
                </button>
                <button type="button" className="btn btn--small btn--ghost" onClick={() => onAnswer(o.id, false)}>
                  {tx.offerDecline}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {outgoing.length > 0 && (
        <ul className="manager__offers">
          {outgoing.map((o) => (
            <li key={o.id}>
              <span>{tx.offerOut(nameOf(o.to), name(o.give), name(o.get))}</span>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => onAnswer(o.id, false)}>
                {tx.offerWithdraw}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="manager__controls">
        <label className="field">
          <span className="field__label">{tx.tradeGive}</span>
          <select
            className="input"
            value={validGive}
            onChange={(e) => {
              setGive(Number(e.target.value));
              setSent(false);
            }}
          >
            {roster.map((id) => (
              <option key={id} value={id}>
                {name(id)} ({fitFor(id)})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{tx.tradeTeam}</span>
          <select
            className="input"
            value={partner.id}
            onChange={(e) => {
              setTo(e.target.value);
              setGet(null);
              setSent(false);
            }}
          >
            {others.map((x) => (
              <option key={x.id} value={x.id}>
                {nameOf(x.id)}
                {x.cpu ? ` (${tx.tradeCpu})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{tx.tradeGet}</span>
          <select
            className="input"
            value={validGet}
            onChange={(e) => {
              setGet(Number(e.target.value));
              setSent(false);
            }}
          >
            {theirs.map((id) => (
              <option key={id} value={id}>
                {name(id)} ({fitFor(id)})
              </option>
            ))}
          </select>
        </label>
      </div>
      {validGet != null && (
        <p className="small manager__effect-preview">
          <Effect out={validGive} inn={validGet} />
        </p>
      )}
      <button
        type="button"
        className="btn btn--small"
        onClick={() => {
          if (validGet == null) return;
          setSent(true);
          onOffer(partner.id, validGive, validGet);
        }}
      >
        {partner.cpu ? tx.tradeAskCpu : tx.tradeSend}
      </button>
      {sent && error && (
        <p className="notice notice--error manager__trade-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

