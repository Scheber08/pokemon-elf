import { useId, type ReactNode } from 'react';
import { crestPokemon, type Crest as CrestData, type CrestIcon, type CrestShape } from '../lib/crest';
import { kitColor } from '../lib/kits';
import { SPRITE_BASE } from '../lib/sprites';

/** Umriss je Form (viewBox 0 0 40 48) */
const SHAPES: Record<CrestShape, (props: { fill?: string; stroke?: string; strokeWidth?: number }) => ReactNode> = {
  shield: (p) => <path d="M4 4 H36 V22 C36 34 28 42 20 46 C12 42 4 34 4 22 Z" {...p} />,
  round: (p) => <circle cx="20" cy="24" r="18" {...p} />,
  square: (p) => <rect x="4" y="6" width="32" height="36" rx="6" {...p} />,
  diamond: (p) => <polygon points="20,3 37,24 20,45 3,24" {...p} />,
};

/** Einfache Icons, um (20, 24) zentriert */
const ICONS: Record<CrestIcon, (fill: string, stroke: string) => ReactNode> = {
  ball: (f, s) => (
    <g stroke={s} strokeWidth="1.4">
      <path d="M11 24 A9 9 0 0 1 29 24 Z" fill={f} />
      <path d="M11 24 A9 9 0 0 0 29 24 Z" fill="#ffffff" />
      <circle cx="20" cy="24" r="2.8" fill="#ffffff" />
    </g>
  ),
  star: (f, s) => <polygon points="20,14 22.9,20.6 30,21.1 24.6,25.7 26.2,32.6 20,28.9 13.8,32.6 15.4,25.7 10,21.1 17.1,20.6" fill={f} stroke={s} strokeWidth="1.2" />,
  bolt: (f, s) => <polygon points="22,13 13,26 19,26 17,35 27,21 21,21" fill={f} stroke={s} strokeWidth="1.2" strokeLinejoin="round" />,
  flame: (f, s) => <path d="M20 13 C24 18 28 21 27 27 C26 32 22 34 20 34 C16 34 13 31 13 27 C13 23 16 22 17 18 C18 21 19 22 20 22 C21 19 21 16 20 13 Z" fill={f} stroke={s} strokeWidth="1.2" />,
  drop: (f, s) => <path d="M20 13 C24 19 28 23 28 27 A8 8 0 0 1 12 27 C12 23 16 19 20 13 Z" fill={f} stroke={s} strokeWidth="1.2" />,
  leaf: (f, s) => (
    <g stroke={s} strokeWidth="1.2">
      <path d="M12 33 C12 22 19 15 29 14 C29 25 22 32 12 33 Z" fill={f} />
      <path d="M13 32 L25 19" fill="none" />
    </g>
  ),
  crown: (f, s) => <polygon points="11,31 11,18 16,23 20,15 24,23 29,18 29,31" fill={f} stroke={s} strokeWidth="1.2" strokeLinejoin="round" />,
};

interface Props {
  crest: CrestData;
  /** Breite in px (Höhe = 1,2 × Breite) */
  size?: number;
  /** Bildquelle des Wappentiers (z. B. Data-URL für den Bild-Export) – sonst das Sprite */
  spriteHref?: string;
  /** Vorlesetext; ohne ist das Wappen dekorativ */
  label?: string;
  className?: string;
}

/** Vereinswappen als SVG: Form, Muster in zwei Farben, Symbol bzw. Wappentier in der Mitte. */
export function Crest({ crest, size = 32, spriteHref, label, className = '' }: Props) {
  // useId enthält Sonderzeichen – für url(#…) nur Buchstaben/Ziffern
  const clip = `crest${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const p = kitColor(crest.primary);
  const s = kitColor(crest.secondary);
  const Shape = SHAPES[crest.shape];
  const mon = crestPokemon(crest.symbol);
  const pattern = (() => {
    switch (crest.pattern) {
      case 'stripes':
        return [6, 18, 30].map((x) => <rect key={x} x={x} y="0" width="6" height="48" fill={s.fill} />);
      case 'halves':
        return <rect x="20" y="0" width="20" height="48" fill={s.fill} />;
      case 'hoop':
        return <rect x="0" y="18" width="40" height="12" fill={s.fill} />;
      case 'diagonal':
        return <polygon points="40,0 40,48 0,48" fill={s.fill} />;
      default:
        return null;
    }
  })();
  return (
    <svg
      className={`crest ${className}`}
      width={size}
      height={size * 1.2}
      viewBox="0 0 40 48"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <clipPath id={clip}>{Shape({})}</clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="0" width="40" height="48" fill={p.fill} />
        {pattern}
      </g>
      {/* Symbol auf einem hellen Grund, damit es auf jedem Muster lesbar bleibt */}
      <circle cx="20" cy="24" r="11" fill="rgba(255,255,255,0.88)" stroke={p.stroke} strokeWidth="1" />
      {mon != null ? (
        <image href={spriteHref ?? `${SPRITE_BASE}${mon}.png`} x="8" y="12" width="24" height="24" style={{ imageRendering: 'pixelated' }} />
      ) : (
        ICONS[crest.symbol as CrestIcon]?.(p.fill, p.stroke)
      )}
      {Shape({ fill: 'none', stroke: '#0d1b2a', strokeWidth: 2 })}
    </svg>
  );
}
