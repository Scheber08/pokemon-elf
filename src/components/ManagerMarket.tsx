/** Manager-Saison: Transfermarkt (freie Pokémon) und Tausch mit anderen Teams – samt Wirkung auf die beste Elf. */
import { useEffect, useMemo, useState } from 'react';
import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import type { DraftSnapshot, DraftTeam, ManagerClaim, ManagerOffer, ManagerTransfer } from '../lib/api/draftContract';
import { rosterOf } from '../lib/draftEngine';
import { positionFit } from '../lib/fit';
import { claimError, freeAgents, squadStrength } from '../lib/manager';
import { usePokemonData } from '../state/PokemonData';
import type { Pokemon } from '../types';
import { PosBadge } from './Badges';
import { Sprite } from './Sprite';
import { useSettings } from '../state/Settings';
import '../styles/draft.css';

/** Transfermarkt: eigenen Wunsch setzen (wen abgeben, wen holen) bzw. zurückziehen. */
export function TransferMarket({
  state,
  team,
  claim,
  matchday,
  onTransfer,
  goals,
}: {
  state: Pick<DraftSnapshot, 'settings' | 'teams'>;
  team: DraftTeam;
  claim: ManagerClaim | null;
  matchday: number;
  onTransfer: (inId: number | null, outId: number | null) => void;
  /** Saisontore je Pokémon des eigenen Teams (für die Auswahl „Abgeben“) */
  goals?: ReadonlyMap<number, number>;
}) {
  const { sprite } = useSettings();
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
  // Tipp: der Tausch, der die beste Elf am meisten stärkt (die 40 freien mit dem besten Fit, Limits beachtet)
  const tip = useMemo(() => {
    const before = squadStrength(team, byId, sc);
    let top: { in: number; out: number; gain: number } | null = null;
    for (const out of roster) {
      for (const { p } of free.slice(0, 40)) {
        const swap = (ids: (number | null)[]) => ids.map((id) => (id === out ? p.id : id));
        const after = { ...team, slots: swap(team.slots), ss: team.ss === out ? p.id : team.ss, ...(team.bench ? { bench: swap(team.bench) as number[] } : {}) };
        const gain = squadStrength(after, byId, sc) - before;
        if (gain > 0.5 && (!top || gain > top.gain) && !claimError(state, team.id, { in: p.id, out }, list)) top = { in: p.id, out, gain };
      }
    }
    return top;
  }, [free, teamsKey, team.formation]);
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
      {tip && !(claim?.in === tip.in && claim.out === tip.out) && (
        <p className="hint manager__tip">
          <span>
            💡 {tx.marketTip(name(tip.in), name(tip.out))} <small className="manager__effect is-up">{tx.effectShort(tip.gain)}</small>
          </span>
          <button type="button" className="btn btn--small btn--ghost" onClick={() => onTransfer(tip.in, tip.out)}>
            {tx.marketTipTake}
          </button>
        </p>
      )}
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
                  {b ? ` (${tx.marketFit(t.game.posShort[b.pos], Math.round(b.fit))}${goals?.get(id) ? `, ${tx.marketGoals(goals.get(id)!)}` : ''})` : ''}
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
      {validOut === team.captain && <p className="hint manager__formwarn">©️ {tx.marketCaptainOut(name(validOut))}</p>}
      {shown.length ? (
        <ul className="manager__free">
          {shown.map(({ p, pos, fit }) => (
            <li key={p.id} className={claim?.in === p.id ? 'is-claimed' : ''}>
              <span className="manager__free-name">
                <Sprite pokemon={p} style={sprite} className="manager__free-sprite" /> {t.game.pokemon(p)}
              </span>
              <PosBadge pos={pos} />
              <span className="manager__free-fit">{Math.round(fit)}</span>
              <TradeEffect team={team} out={validOut} inn={p.id} short />
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

/**
 * Tausch mit anderen gedrafteten Teams: eigenes Pokémon gegen eins aus einem anderen Kader anbieten;
 * eingehende Angebote annehmen oder ablehnen, eigene zurückziehen. CPU-Teams antworten sofort.
 */
export function TradePanel({
  state,
  team,
  offers,
  done,
  error,
  nameOf,
  onOffer,
  onAnswer,
  goalsOf,
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
  /** Saisontore je Pokémon eines Teams (Team-ID) */
  goalsOf?: (teamId: string) => ReadonlyMap<number, number>;
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
  const myGoals = goalsOf?.(team.id);
  const theirGoals = partner ? goalsOf?.(partner.id) : undefined;
  const goalText = (g: ReadonlyMap<number, number> | undefined, id: number) => (g?.get(id) ? `, ${tx.marketGoals(g.get(id)!)}` : '');

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
                <TradeEffect team={team} out={o.get} inn={o.give} />
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
                {name(id)} ({fitFor(id)}
                {goalText(myGoals, id)})
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
                {name(id)} ({fitFor(id)}
                {goalText(theirGoals, id)})
              </option>
            ))}
          </select>
        </label>
      </div>
      {validGet != null && (
        <p className="small manager__effect-preview">
          <TradeEffect team={team} out={validGive} inn={validGet} />
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

/** Wirkung eines Tauschs out → in auf die beste Elf des Teams (gewichtete Fit-Punkte, ohne Tagesform). */
function TradeEffect({ team, out, inn, short = false }: { team: DraftTeam; out: number; inn: number; short?: boolean }) {
  const tx = useT().draft.manager;
  const { byId, scale } = usePokemonData();
  const sc = scale('all');
  const swap = (ids: (number | null)[]) => ids.map((id) => (id === out ? inn : id));
  const after = { ...team, slots: swap(team.slots), ss: team.ss === out ? inn : team.ss, ...(team.bench ? { bench: swap(team.bench) as number[] } : {}) };
  const d = squadStrength(after, byId, sc) - squadStrength(team, byId, sc);
  return (
    <small className={`manager__effect ${d > 0.05 ? 'is-up' : d < -0.05 ? 'is-down' : ''}`} title={short ? `${tx.effect(d)} – ${tx.effectTitle}` : tx.effectTitle}>
      {short ? tx.effectShort(d) : tx.effect(d)}
    </small>
  );
}
