import { useCallback, useEffect, useMemo, useState } from 'react';
import { FORMATION_IDS, FORMATIONS } from '../config/formations';
import { localeOf, useLang, useT } from '../i18n';
import type { DraftSnapshot, DraftTeam, ManagerClaim, ManagerLineup } from '../lib/api/draftContract';
import { rosterOf } from '../lib/draftEngine';
import { storedLeague } from '../lib/leagueTimeline';
import { bestLineup, FORM_FIT, formFit, freeAgents, lineupScore, managerSchedule } from '../lib/manager';
import { positionFit } from '../lib/fit';
import type { Match } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { teamLabel, type DraftRoom } from '../state/useDraftRoom';
import type { FormationId, Pokemon, PosCode } from '../types';
import { PosBadge } from './Badges';
import { BenchRow } from './BenchRow';
import { FixtureList } from './LeagueTicker';
import { useMatchReport } from './MatchReport';
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
  const { byId } = usePokemonData();
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

  const report = useMatchReport(nameOf, pokemonName, (x) => tx.next(x.round));

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

      {lastTransfers.length > 0 && (
        <section className="card" aria-labelledby="manager-transfers">
          <h2 id="manager-transfers" className="section-title">
            {tx.transfersTitle(m.played)}
          </h2>
          <ul className="manager__transfers">
            {lastTransfers.map((x) => {
              const team = s.teams.find((tm) => tm.id === x.teamId);
              return (
                <li key={`${x.teamId}-${x.in}`}>
                  {tx.transferLine(team ? teamLabel(team, t) : '?', pokemonName(x.in), pokemonName(x.out))}
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
          <FixtureList matches={last} you={you} nameOf={nameOf} pokemonName={pokemonName} onOpen={report.open} />
        </section>
      )}

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
