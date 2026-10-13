import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FACTOR_LABEL, FACTOR_LONG, POSITIONS, PROFILES, type Level } from '../config/positions';
import { regionName } from '../config/regions';
import type { FactorKey, PosCode, Pokemon, StatKey } from '../types';
import '../styles/tips.css';
import { PosBadge, TypeBadge, TypeBadges } from './Badges';
import { LevelIcon } from './LevelIcon';

const STATS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export const fmtNum = (n: number, digits = 1) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function dexNo(id: number) {
  return `Nr. ${String(id).padStart(4, '0')}`;
}

/** Gewichtung eines Faktors auf einer Position (Schlüssel 3 … Zählt nicht 0). */
const levelAt = (pos: PosCode, f: FactorKey): Level => PROFILES[POSITIONS[pos].profile].weights[f];

/** Basiswerte als Balken; mit `pos` markiert ein Symbol, wie wichtig jeder Wert dort ist. */
export function StatBars({ pokemon, pos }: { pokemon: Pokemon; pos?: PosCode }) {
  return (
    <dl className={`statbars ${pos ? 'statbars--pos' : ''}`}>
      {STATS.map((k) => (
        <div className={`statbars__row ${pos && levelAt(pos, k) === 0 ? 'statbars__row--muted' : ''}`} key={k}>
          <dt>
            {pos && (
              <span className={`lvl lvl--${levelAt(pos, k)}`}>
                <LevelIcon level={levelAt(pos, k)} size={12} />
              </span>
            )}
            {FACTOR_LONG[k]}
          </dt>
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

/** Schwebendes Feld neben dem Anker (rechts, sonst links, auf schmalen Bildschirmen darüber/darunter). */
function FloatingTip({ anchor, className, children }: { anchor: DOMRect; className: string; children: ReactNode }) {
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
  }, [anchor, children]);

  return createPortal(
    <div
      ref={ref}
      className={className}
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Typ-Bonus der Position; Typen, die das Pokémon hat, werden hervorgehoben. */
function TypeBonusLine({ pos, pokemon }: { pos: PosCode; pokemon?: Pokemon }) {
  const types = PROFILES[POSITIONS[pos].profile].types;
  if (!types.length) return <p className="pos-tip__types muted small">Kein Typ-Bonus</p>;
  return (
    <p className="pos-tip__types">
      <span className="pos-tip__label">Typ-Bonus</span>
      <span className="type-badges">
        {types.map((t) => (
          <span key={t} className={pokemon && !pokemon.types.includes(t) ? 'pos-tip__type--off' : ''}>
            <TypeBadge type={t} small />
          </span>
        ))}
      </span>
    </p>
  );
}

/**
 * Werte-Tooltip (Hover am Desktop, Long-Press am Handy) – bewusst ohne Fit-Bewertung.
 * Mit `pos` zeigt er zusätzlich, welche Werte auf dieser Position zählen.
 */
export function StatTooltip({ pokemon, anchor, pos }: { pokemon: Pokemon; anchor: DOMRect; pos?: PosCode }) {
  return (
    <FloatingTip anchor={anchor} className="stat-tip">
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
      {pos && (
        <p className="pos-tip__as" title="● Schlüssel · ◕ Hilft · ◔ Kleiner Anteil · ○ Zählt nicht">
          <PosBadge pos={pos} /> Wichtig als {POSITIONS[pos].name}
        </p>
      )}
      <StatBars pokemon={pokemon} pos={pos} />
      <div className="stat-tip__meta">
        <span>
          {pos && (
            <span className={`lvl lvl--${levelAt(pos, 'height')}`}>
              <LevelIcon level={levelAt(pos, 'height')} size={11} />
            </span>
          )}
          Größe {fmtNum(pokemon.h)} m
        </span>
        <span>
          {pos && (
            <span className={`lvl lvl--${levelAt(pos, 'weight')}`}>
              <LevelIcon level={levelAt(pos, 'weight')} size={11} />
            </span>
          )}
          Gewicht {fmtNum(pokemon.w)} kg
        </span>
        <span>{regionName(pokemon.gen)}</span>
      </div>
      {pos && <TypeBonusLine pos={pos} pokemon={pokemon} />}
    </FloatingTip>
  );
}

const LEVEL_GROUPS: { level: Level; label: string }[] = [
  { level: 3, label: 'Schlüssel' },
  { level: 2, label: 'Hilft' },
  { level: 1, label: 'Kleiner Anteil' },
];

/** Was auf einer Position zählt – für leere Slots (z. B. beim Draften). */
export function PositionTooltip({ pos, anchor }: { pos: PosCode; anchor: DOMRect }) {
  const def = POSITIONS[pos];
  const profile = PROFILES[def.profile];
  const factorsAt = (level: Level) => (Object.keys(profile.weights) as FactorKey[]).filter((f) => profile.weights[f] === level);
  return (
    <FloatingTip anchor={anchor} className="stat-tip pos-tip">
      <div className="pos-tip__head">
        <PosBadge pos={pos} />
        <strong className="stat-tip__name">{def.name}</strong>
      </div>
      <p className="pos-tip__role">{profile.role}</p>
      <dl className="pos-tip__groups">
        {LEVEL_GROUPS.map(({ level, label }) => {
          const factors = factorsAt(level);
          if (!factors.length) return null;
          return (
            <div key={level} className="pos-tip__group">
              <dt className={`lvl lvl--${level}`}>
                <LevelIcon level={level} size={13} /> {label}
              </dt>
              <dd>
                {factors.map((f) => (
                  <span key={f} className="pos-tip__factor" title={FACTOR_LONG[f]}>
                    {FACTOR_LABEL[f]}
                    {profile.notes?.[f] && <small> ({profile.notes[f]})</small>}
                  </span>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
      <TypeBonusLine pos={pos} />
      {pos !== 'SS' && (
        <p className="pos-tip__weight muted small">
          Gewicht im Team-Score: {def.teamWeight.toLocaleString('de-DE')}
        </p>
      )}
    </FloatingTip>
  );
}
