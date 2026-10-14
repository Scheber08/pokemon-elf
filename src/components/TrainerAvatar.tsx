import { useMemo } from 'react';
import { useT } from '../i18n';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import type { TrainerLook } from '../lib/trainer';
import { pixelRuns, PX, trainerPixels } from '../lib/trainerPixels';
import { Sprite } from './Sprite';
import '../styles/trainer.css';

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

/** Selbst gestalteter Trainer als Pixel-Art (32 × 32, SVG mit harten Kanten) – optional mit Begleiter-Pokémon. */
export function TrainerAvatar({ look, size = 120, companion = true, className = '', label }: Props) {
  const { byId } = usePokemonData();
  const { sprite } = useSettings();
  const t = useT();
  const runs = useMemo(() => pixelRuns(trainerPixels(look)), [look]);
  const pet = companion && look.companion !== 'none' ? byId.get(Number(look.companion)) : undefined;
  return (
    <span
      className={`trainer-avatar ${className}`}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox={`0 0 ${PX} ${PX}`} width={size} height={size} shapeRendering="crispEdges" focusable="false">
        {runs.map((r) => (
          <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
        ))}
      </svg>
      {pet && (
        <span className="trainer-avatar__pet" title={t.game.pokemon(pet)}>
          <Sprite pokemon={pet} style={sprite} />
        </span>
      )}
    </span>
  );
}
