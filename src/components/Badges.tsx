import { POSITIONS } from '../config/positions';
import { TYPES } from '../config/pokemonTypes';
import type { PosCode, TypeKey } from '../types';

export function TypeBadge({ type, small }: { type: TypeKey; small?: boolean }) {
  const t = TYPES[type];
  return (
    <span className={`type-badge ${small ? 'type-badge--sm' : ''}`} style={{ background: t.color, color: t.text }}>
      {t.de}
    </span>
  );
}

export function TypeBadges({ types, small }: { types: TypeKey[]; small?: boolean }) {
  return (
    <span className="type-badges">
      {types.map((t) => (
        <TypeBadge key={t} type={t} small={small} />
      ))}
    </span>
  );
}

/** Positionskürzel im farbigen Kasten (TW gelb, Abwehr blau, Mittelfeld grün, Angriff rot). */
export function PosBadge({ pos, className = '' }: { pos: PosCode; className?: string }) {
  const line = pos === 'SS' ? 'ss' : POSITIONS[pos].line;
  return (
    <span className={`pos-badge pos-badge--${line} ${className}`} title={POSITIONS[pos].name}>
      {pos}
    </span>
  );
}
