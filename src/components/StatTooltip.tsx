import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FACTOR_LONG } from '../config/positions';
import { regionName } from '../config/regions';
import type { Pokemon, StatKey } from '../types';
import { TypeBadges } from './Badges';

const STATS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export const fmtNum = (n: number, digits = 1) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function dexNo(id: number) {
  return `Nr. ${String(id).padStart(4, '0')}`;
}

export function StatBars({ pokemon }: { pokemon: Pokemon }) {
  return (
    <dl className="statbars">
      {STATS.map((k) => (
        <div className="statbars__row" key={k}>
          <dt>{FACTOR_LONG[k]}</dt>
          <dd>
            <span className="statbars__val">{pokemon[k]}</span>
            <span className="statbars__track">
              <span
                className={`statbars__fill statbars__fill--${pokemon[k] >= 100 ? 'hi' : pokemon[k] >= 70 ? 'mid' : 'lo'}`}
                style={{ width: `${Math.min(100, (pokemon[k] / 200) * 100)}%` }}
              />
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Werte-Tooltip (Hover am Desktop, Long-Press am Handy) – bewusst ohne Fit-Bewertung. */
export function StatTooltip({ pokemon, anchor }: { pokemon: Pokemon; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    let left: number;
    let top: number;
    if (anchor.right + margin + width <= vw - margin) {
      left = anchor.right + margin; // rechts daneben
      top = anchor.top + anchor.height / 2 - height / 2;
    } else if (anchor.left - margin - width >= margin) {
      left = anchor.left - margin - width; // links daneben
      top = anchor.top + anchor.height / 2 - height / 2;
    } else {
      // schmaler Bildschirm: darüber bzw. darunter, horizontal zentriert
      left = anchor.left + anchor.width / 2 - width / 2;
      top = anchor.top - height - margin;
      if (top < margin) top = anchor.bottom + margin;
    }
    setPos({
      left: clamp(left, margin, vw - width - margin),
      top: clamp(top, margin, vh - height - margin),
    });
  }, [anchor, pokemon]);

  return createPortal(
    <div
      ref={ref}
      className="stat-tip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <div className="stat-tip__head">
        <span className="stat-tip__no">{dexNo(pokemon.id)}</span>
        <strong className="stat-tip__name">{pokemon.de}</strong>
        {pokemon.de !== pokemon.en && <span className="stat-tip__en">{pokemon.en}</span>}
      </div>
      <div className="stat-tip__types">
        <TypeBadges types={pokemon.types} small />
        {(pokemon.leg || pokemon.myth) ? (
          <span className="legend-chip">{pokemon.myth ? 'Mysteriös' : 'Legendär'}</span>
        ) : null}
      </div>
      <StatBars pokemon={pokemon} />
      <div className="stat-tip__meta">
        <span>Größe {fmtNum(pokemon.h)} m</span>
        <span>Gewicht {fmtNum(pokemon.w)} kg</span>
        <span>{regionName(pokemon.gen)}</span>
      </div>
    </div>,
    document.body,
  );
}
