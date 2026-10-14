import { useId } from 'react';
import { useT } from '../i18n';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { colorOf, type TrainerLook } from '../lib/trainer';
import { Sprite } from './Sprite';
import '../styles/trainer.css';

/** Farbe heller (amount > 0) bzw. dunkler (amount < 0) – amount −1 … 1 */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

interface Props {
  look: TrainerLook;
  /** Kantenlänge in px */
  size?: number;
  /** Begleiter-Pokémon zeigen (klein: aus) */
  companion?: boolean;
  className?: string;
  /** Beschriftung für Screenreader (sonst dekorativ) */
  label?: string;
}

/** Selbst gestalteter Trainer als SVG – optional mit Begleiter-Pokémon (Sprite) unten rechts. */
export function TrainerAvatar({ look, size = 120, companion = true, className = '', label }: Props) {
  const uid = useId().replace(/:/g, '');
  const { byId } = usePokemonData();
  const { sprite } = useSettings();
  const t = useT();
  const skin = colorOf('skin', look.skin);
  const hair = colorOf('hairColor', look.hairColor);
  const cloth = colorOf('outfitColor', look.outfitColor);
  const bg = colorOf('background', look.background);
  const pet = companion && look.companion !== 'none' ? byId.get(Number(look.companion)) : undefined;
  const g = (name: string) => `${uid}-${name}`;

  return (
    <span
      className={`trainer-avatar ${className}`}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 120 120" width={size} height={size} focusable="false">
        <defs>
          <clipPath id={g('clip')}>
            <rect width="120" height="120" rx="18" />
          </clipPath>
          <clipPath id={g('body')}>
            <path d="M12 120 C12 94 32 84 60 84 C88 84 108 94 108 120 Z" />
          </clipPath>
          <linearGradient id={g('sky')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a8dcf8" />
            <stop offset="1" stopColor="#4f9fdb" />
          </linearGradient>
          <linearGradient id={g('sunset')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd36e" />
            <stop offset="0.55" stopColor="#f0764b" />
            <stop offset="1" stopColor="#a8427c" />
          </linearGradient>
          <radialGradient id={g('gold')} cx="0.5" cy="0.45" r="0.7">
            <stop offset="0" stopColor="#fff2b0" />
            <stop offset="0.6" stopColor="#e2b83c" />
            <stop offset="1" stopColor="#9c7417" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${g('clip')})`}>
          <Background id={look.background} color={bg} g={g} />
          <HairBack style={look.hair} color={hair} />
          <Outfit style={look.outfit} color={cloth} skin={skin} g={g} />
          <Accessory id={look.accessory} layer="body" cloth={cloth} />
          {/* Kopf */}
          <circle cx="36" cy="53" r="5" fill={shade(skin, -0.08)} />
          <circle cx="84" cy="53" r="5" fill={shade(skin, -0.08)} />
          <circle cx="60" cy="50" r="24" fill={skin} />
          <circle cx="50" cy="52" r="2.6" fill="#24201e" />
          <circle cx="70" cy="52" r="2.6" fill="#24201e" />
          <circle cx="45" cy="59" r="3.2" fill="#ff8a8a" opacity="0.3" />
          <circle cx="75" cy="59" r="3.2" fill="#ff8a8a" opacity="0.3" />
          <path d="M53 61 Q60 67 67 61" fill="none" stroke="#6b3324" strokeWidth="2" strokeLinecap="round" />
          <HairFront style={look.hair} color={hair} hat={look.hat !== 'none'} />
          <Hat id={look.hat} cloth={cloth} />
          <Accessory id={look.accessory} layer="face" cloth={cloth} />
        </g>
      </svg>
      {pet && (
        <span className="trainer-avatar__pet" title={t.game.pokemon(pet)}>
          <Sprite pokemon={pet} style={sprite} />
        </span>
      )}
    </span>
  );
}

function Background({ id, color, g }: { id: string; color: string; g: (n: string) => string }) {
  switch (id) {
    case 'sky':
      return (
        <>
          <rect width="120" height="120" fill={`url(#${g('sky')})`} />
          <ellipse cx="22" cy="24" rx="14" ry="6" fill="#fff" opacity="0.8" />
          <ellipse cx="98" cy="34" rx="12" ry="5" fill="#fff" opacity="0.7" />
        </>
      );
    case 'pitch':
      return (
        <>
          <rect width="120" height="120" fill={color} />
          {[0, 2, 4].map((i) => (
            <rect key={i} x={i * 24} width="24" height="120" fill="#ffffff" opacity="0.07" />
          ))}
          <circle cx="60" cy="60" r="30" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.45" />
          <line x1="0" y1="60" x2="120" y2="60" stroke="#fff" strokeWidth="1.5" opacity="0.45" />
        </>
      );
    case 'sunset':
      return (
        <>
          <rect width="120" height="120" fill={`url(#${g('sunset')})`} />
          <circle cx="60" cy="78" r="26" fill="#ffe08a" opacity="0.55" />
        </>
      );
    case 'night':
      return (
        <>
          <rect width="120" height="120" fill={color} />
          {[
            [14, 16],
            [34, 30],
            [92, 14],
            [104, 40],
            [20, 52],
            [100, 70],
            [78, 24],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="#fff" opacity="0.85" />
          ))}
          <circle cx="98" cy="22" r="8" fill="#f4f1c9" />
          <circle cx="102" cy="19" r="7" fill={color} />
        </>
      );
    case 'gold':
      return <rect width="120" height="120" fill={`url(#${g('gold')})`} />;
    default:
      return <rect width="120" height="120" fill={color} />;
  }
}

function HairBack({ style, color }: { style: string; color: string }) {
  if (style === 'long') return <path d="M35 46 C29 70 30 90 37 96 L83 96 C90 90 91 70 85 46 Z" fill={shade(color, -0.12)} />;
  if (style === 'ponytail')
    return (
      <>
        <circle cx="86" cy="40" r="8" fill={shade(color, -0.12)} />
        <path d="M88 44 C98 54 96 72 88 80 C90 66 88 56 82 48 Z" fill={shade(color, -0.12)} />
      </>
    );
  return null;
}

function HairFront({ style, color, hat }: { style: string; color: string; hat: boolean }) {
  switch (style) {
    case 'bald':
      return null;
    case 'spiky':
      return (
        <path
          d="M34 50 L31 33 L42 38 L43 21 L53 31 L60 14 L67 31 L77 21 L78 38 L89 33 L86 50 C80 40 72 36 60 36 C48 36 40 40 34 50 Z"
          fill={color}
        />
      );
    case 'curly':
      return (
        <g fill={color}>
          {[
            [39, 41, 8],
            [47, 32, 9],
            [60, 28, 10],
            [73, 32, 9],
            [81, 41, 8],
            [36, 50, 5.5],
            [84, 50, 5.5],
          ].map(([x, y, r]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
          ))}
        </g>
      );
    case 'long':
      return (
        <path d={hat ? 'M35 50 C35 40 40 36 46 36 L40 64 C36 60 35 55 35 50 Z M85 50 C85 40 80 36 74 36 L80 64 C84 60 85 55 85 50 Z' : 'M35 52 C33 28 46 23 60 23 C74 23 87 28 85 52 C82 42 74 34 62 36 C52 37 44 40 40 64 C36 60 35 56 35 52 Z'} fill={color} />
      );
    default:
      // short (auch ponytail vorn)
      return <path d="M35 50 C33 28 46 23 60 23 C75 23 88 30 85 50 C80 40 72 35 60 35 C49 35 41 40 35 50 Z" fill={color} />;
  }
}

function Hat({ id, cloth }: { id: string; cloth: string }) {
  switch (id) {
    case 'cap':
      return (
        <>
          <path d="M34 42 C34 20 86 20 86 42 Z" fill={cloth} />
          <path d="M30 43 C46 38 74 38 90 43 C74 48 46 48 30 43 Z" fill={shade(cloth, -0.25)} />
          <circle cx="60" cy="31" r="4" fill="#fff" opacity="0.9" />
        </>
      );
    case 'pokecap':
      return (
        <>
          <path d="M34 42 C34 20 86 20 86 42 Z" fill="#fff" />
          <path d="M34 36 C36 20 84 20 86 36 Z" fill="#d8342a" />
          <path d="M30 43 C46 38 74 38 90 43 C74 48 46 48 30 43 Z" fill="#b5281f" />
          <circle cx="60" cy="35" r="5" fill="#fff" stroke="#222" strokeWidth="1.6" />
          <circle cx="60" cy="35" r="1.8" fill="#222" />
        </>
      );
    case 'beanie':
      return (
        <>
          <path d="M33 44 C33 16 87 16 87 44 Z" fill={cloth} />
          <rect x="32" y="38" width="56" height="9" rx="4" fill={shade(cloth, -0.22)} />
          <circle cx="60" cy="16" r="5" fill={shade(cloth, 0.35)} />
        </>
      );
    case 'headband':
      return (
        <>
          <path d="M36 38 C44 32 76 32 84 38 L84 44 C76 38 44 38 36 44 Z" fill={cloth} />
          <path d="M84 40 L95 35 L93 44 Z M84 42 L94 48 L90 52 Z" fill={shade(cloth, -0.2)} />
        </>
      );
    case 'crown':
      return (
        <>
          <path d="M38 33 L41 14 L51 25 L60 9 L69 25 L79 14 L82 33 Z" fill="#f2c230" stroke="#a87b10" strokeWidth="1.2" />
          <circle cx="60" cy="27" r="2.6" fill="#d8342a" />
          <circle cx="47" cy="29" r="2" fill="#2f62c9" />
          <circle cx="73" cy="29" r="2" fill="#2f9a57" />
        </>
      );
    default:
      return null;
  }
}

function Outfit({ style, color, skin, g }: { style: string; color: string; skin: string; g: (n: string) => string }) {
  const body = 'M12 120 C12 94 32 84 60 84 C88 84 108 94 108 120 Z';
  const neck = <path d="M52 66 L68 66 L69 86 C64 90 56 90 51 86 Z" fill={shade(skin, -0.1)} />;
  switch (style) {
    case 'jersey':
      return (
        <>
          {neck}
          <path d={body} fill={color} />
          <g clipPath={`url(#${g('body')})`} fill="#fff" opacity="0.85">
            <rect x="40" y="84" width="7" height="40" />
            <rect x="73" y="84" width="7" height="40" />
          </g>
          <path d="M50 85 C55 91 65 91 70 85" fill="none" stroke="#fff" strokeWidth="3" />
          <text x="60" y="113" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="Oswald, sans-serif">
            11
          </text>
        </>
      );
    case 'hoodie':
      return (
        <>
          <path d="M36 92 C34 72 86 72 84 92 Z" fill={shade(color, -0.2)} />
          {neck}
          <path d={body} fill={color} />
          <path d="M44 86 C52 94 68 94 76 86" fill="none" stroke={shade(color, -0.3)} strokeWidth="3" />
          <line x1="55" y1="92" x2="54" y2="106" stroke="#f3f3f3" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="65" y1="92" x2="66" y2="106" stroke="#f3f3f3" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="44" y="108" width="32" height="10" rx="4" fill={shade(color, -0.15)} />
        </>
      );
    case 'jacket':
      return (
        <>
          {neck}
          <path d={body} fill={color} />
          <g clipPath={`url(#${g('body')})`}>
            <rect x="50" y="84" width="20" height="40" fill="#f3f3f3" />
            <line x1="60" y1="88" x2="60" y2="120" stroke="#9aa0a8" strokeWidth="1.5" />
            <rect x="12" y="104" width="22" height="20" fill={shade(color, -0.25)} />
            <rect x="86" y="104" width="22" height="20" fill={shade(color, -0.25)} />
          </g>
          <path d="M46 85 L54 94 L60 86 L66 94 L74 85" fill="none" stroke="#26282e" strokeWidth="3" strokeLinejoin="round" />
        </>
      );
    case 'suit':
      return (
        <>
          {neck}
          <path d={body} fill={color} />
          <path d="M49 84 L60 108 L71 84 Z" fill="#f6f6f6" />
          <path d="M57 88 L63 88 L61.5 92 L64 106 L60 111 L56 106 L58.5 92 Z" fill="#c62c2c" />
          <path d="M49 84 L58 104 L46 96 Z M71 84 L62 104 L74 96 Z" fill={shade(color, -0.25)} />
        </>
      );
    default:
      return (
        <>
          {neck}
          <path d={body} fill={color} />
          <path d="M51 85 L60 96 L69 85 Z" fill={shade(skin, -0.1)} />
          <path d="M50 84 L60 97 L70 84" fill="none" stroke={shade(color, -0.25)} strokeWidth="2.5" />
        </>
      );
  }
}

function Accessory({ id, layer, cloth }: { id: string; layer: 'body' | 'face'; cloth: string }) {
  if (layer === 'body') {
    if (id === 'scarf') {
      const c = shade(cloth, 0.45);
      return (
        <>
          <path d="M44 80 C52 88 68 88 76 80 L79 89 C70 96 50 96 41 89 Z" fill={c} />
          <path d="M66 90 L72 112 L64 113 L60 92 Z" fill={shade(c, -0.12)} />
        </>
      );
    }
    if (id === 'medal')
      return (
        <>
          <path d="M50 84 L60 104 L70 84 L65 84 L60 96 L55 84 Z" fill="#2f62c9" />
          <circle cx="60" cy="106" r="7" fill="#f2c230" stroke="#a87b10" strokeWidth="1.4" />
          <path d="M60 102 L61.5 105 L65 105.4 L62.4 107.6 L63.2 111 L60 109.2 L56.8 111 L57.6 107.6 L55 105.4 L58.5 105 Z" fill="#fff6c4" />
        </>
      );
    return null;
  }
  if (id === 'glasses')
    return (
      <g fill="none" stroke="#26282e" strokeWidth="1.8">
        <circle cx="50" cy="52" r="6" />
        <circle cx="70" cy="52" r="6" />
        <line x1="56" y1="52" x2="64" y2="52" />
      </g>
    );
  if (id === 'sunglasses')
    return (
      <>
        <path d="M42 48 L58 48 L57 55 C56 59 45 59 44 55 Z M62 48 L78 48 L76 55 C75 59 64 59 63 55 Z" fill="#111" />
        <line x1="58" y1="49" x2="62" y2="49" stroke="#111" strokeWidth="2" />
        <path d="M46 50 L50 50" stroke="#fff" strokeWidth="1.2" opacity="0.6" />
      </>
    );
  return null;
}
