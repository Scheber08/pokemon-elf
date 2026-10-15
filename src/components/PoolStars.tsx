import { useMemo } from 'react';
import { POSITIONS } from '../config/positions';
import { useT } from '../i18n';
import { positionFit, type Scale } from '../lib/fit';
import { useSettings } from '../state/Settings';
import type { Pokemon, PosCode } from '../types';
import { PosBadge } from './Badges';
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

/** Lobby: Vorschau der fünf stärksten Pokémon im Pool – damit man vor dem Draft weiß, um wen es geht. */
export function PoolStars({ pool, scale }: { pool: readonly Pokemon[]; scale: Scale }) {
  const t = useT();
  const { sprite } = useSettings();
  const stars = useMemo(() => poolStars(pool, scale), [pool, scale]);
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
    </section>
  );
}
