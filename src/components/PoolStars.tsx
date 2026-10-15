import { useMemo } from 'react';
import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { useT } from '../i18n';
import { positionFit, type Scale } from '../lib/fit';
import { useSettings } from '../state/Settings';
import type { FormationId, Pokemon, PosCode, TypeKey } from '../types';
import { PosBadge, TypeBadge } from './Badges';
import { TYPE_KEYS } from '../config/pokemonTypes';
import { KindMarks } from './DraftBoard';
import { limitKindsOf } from '../lib/draftEngine';
import { Sprite } from './Sprite';

/** Feldpositionen (ohne Standardschütze) */
const FIELD = (Object.keys(POSITIONS) as PosCode[]).filter((p) => p !== 'SS');

export interface PoolStar {
  pokemon: Pokemon;
  pos: PosCode;
  fit: number;
}

/** Summe der Basiswerte */
const statTotal = (p: Pokemon) => p.hp + p.atk + p.def + p.spa + p.spd + p.spe;

/**
 * Die stärksten Pokémon des Pools: bester Positions-Fit je Pokémon, absteigend; bei Gleichstand (Fit ist bei 100
 * gedeckelt) die höhere Basiswert-Summe, dann die kleinere Nummer.
 */
export function poolStars(pool: readonly Pokemon[], scale: Scale, n = 5): PoolStar[] {
  const rated = pool.map((p) => {
    let best: PoolStar = { pokemon: p, pos: FIELD[0], fit: -1 };
    for (const pos of FIELD) {
      const fit = positionFit(p, pos, scale);
      if (fit > best.fit) best = { pokemon: p, pos, fit };
    }
    return best;
  });
  rated.sort((a, b) => b.fit - a.fit || statTotal(b.pokemon) - statTotal(a.pokemon) || a.pokemon.id - b.pokemon.id);
  return rated.slice(0, n).map((x) => ({ ...x, fit: Math.round(x.fit) }));
}

/** Ab diesem Positions-Fit gilt ein Pokémon als stark auf der Position */
export const SCARCE_FIT = 85;

export interface ScarcePos {
  pos: PosCode;
  /** Starke Kandidaten im Pool (Fit ≥ SCARCE_FIT) */
  strong: number;
  /** Plätze dieser Position in allen Formationen */
  need: number;
}

/**
 * Knappe Positionen: weniger starke Kandidaten im Pool, als die Formationen aller Teams Plätze haben –
 * die knappsten zuerst (Verhältnis, dann Formationsreihenfolge), höchstens n.
 */
export function poolScarcity(pool: readonly Pokemon[], scale: Scale, formations: readonly FormationId[], n = 3): ScarcePos[] {
  const need = new Map<PosCode, number>();
  for (const f of formations) for (const d of FORMATIONS[f].slots) need.set(d.pos, (need.get(d.pos) ?? 0) + 1);
  const out: ScarcePos[] = [];
  for (const [pos, k] of need) {
    const strong = pool.filter((p) => positionFit(p, pos, scale) >= SCARCE_FIT).length;
    if (strong < k) out.push({ pos, strong, need: k });
  }
  const order: readonly PosCode[] = FIELD;
  out.sort((a, b) => a.strong / a.need - b.strong / b.need || order.indexOf(a.pos) - order.indexOf(b.pos));
  return out.slice(0, n);
}

/** Häufigste Typen im Pool (Doppeltypen zählen für beide), absteigend; bei Gleichstand Reihenfolge von TYPE_KEYS */
export function poolTypes(pool: readonly Pokemon[], n = 3): { type: TypeKey; count: number }[] {
  const count = new Map<TypeKey, number>();
  for (const p of pool) for (const type of p.types) count.set(type, (count.get(type) ?? 0) + 1);
  return [...count]
    .map(([type, c]) => ({ type, count: c }))
    .sort((a, b) => b.count - a.count || TYPE_KEYS.indexOf(a.type) - TYPE_KEYS.indexOf(b.type))
    .slice(0, n);
}

/** Lobby: Vorschau der fünf stärksten Pokémon im Pool – damit man vor dem Draft weiß, um wen es geht. */
export function PoolStars({ pool, scale, formations }: { pool: readonly Pokemon[]; scale: Scale; formations?: readonly FormationId[] }) {
  const t = useT();
  const { sprite } = useSettings();
  const stars = useMemo(() => poolStars(pool, scale), [pool, scale]);
  const types = useMemo(() => poolTypes(pool), [pool]);
  const formationKey = formations?.join(',') ?? '';
  const scarce = useMemo(() => (formations?.length ? poolScarcity(pool, scale, formations) : []), [pool, scale, formationKey]);
  if (!stars.length) return null;
  return (
    <section className="card pool-stars" aria-labelledby="pool-stars-title">
      <h2 id="pool-stars-title" className="section-title">
        ⭐ {t.online.poolStars}
      </h2>
      <ol className="pool-stars__list">
        {stars.map((s) => (
          <li key={s.pokemon.id}>
            <Sprite pokemon={s.pokemon} style={sprite} className="pool-stars__sprite" loading="eager" />
            <span className="pool-stars__name">
              <strong>{t.game.pokemon(s.pokemon)}</strong>
              <KindMarks kinds={limitKindsOf(s.pokemon)} />
            </span>
            <span className="pool-stars__pos">
              <PosBadge pos={s.pos} /> <span title={t.draft.board.feedFitTitle(s.fit)}>{s.fit}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="hint">{t.online.poolStarsNote}</p>
      {types.length > 0 && (
        <p className="small pool-stars__types">
          <span className="muted">{t.online.poolTypes}</span>
          {types.map((x) => (
            <span key={x.type} className="type-goals__item">
              <TypeBadge type={x.type} small /> <strong>{x.count}</strong>
            </span>
          ))}
        </p>
      )}
      {scarce.length > 0 && (
        <p className="small pool-stars__scarce" title={t.online.poolScarceTitle(SCARCE_FIT)}>
          ⚠️ {t.online.poolScarce(scarce.map((x) => t.online.poolScarceItem(t.game.posShort[x.pos], x.strong, x.need)).join(', '))}
        </p>
      )}
    </section>
  );
}

export interface LandedStar {
  pokemon: Pokemon;
  /** Team, das den Star bekam (Anzeigename), und Pick-Nummer (1-basiert) – fehlt: nicht gedraftet */
  team?: string;
  pick?: number;
  /** Eigenes Team */
  mine?: boolean;
}

/** Ergebnis: „Wo landeten die Stars?" – die Stars des Pools mit Team und Pick (online und lokal). */
export function StarsLanded({ stars }: { stars: readonly LandedStar[] }) {
  const t = useT();
  const tx = t.draft.results;
  const { sprite } = useSettings();
  if (!stars.length) return null;
  return (
    <section className="card draft-results__stars" aria-labelledby="draft-results-stars-title">
      <h2 id="draft-results-stars-title" className="section-title">
        ⭐ {tx.starsTitle}
      </h2>
      <ol className="pool-stars__list">
        {stars.map((x) => (
          <li key={x.pokemon.id} className={x.mine ? 'is-you' : ''}>
            <Sprite pokemon={x.pokemon} style={sprite} className="pool-stars__sprite" />
            <span className="pool-stars__name">
              <strong>{t.game.pokemon(x.pokemon)}</strong>
              <KindMarks kinds={limitKindsOf(x.pokemon)} />
            </span>
            <span className="pool-stars__pos small">
              {x.team != null && x.pick != null ? tx.starsPick(x.team, x.pick) : <span className="muted">{tx.starsFree}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
