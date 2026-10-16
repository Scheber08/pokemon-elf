import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { useT } from '../i18n';
import { spriteKind, spriteUrls, type SpriteKind } from '../lib/sprites';
import type { Pokemon, SpriteStyle } from '../types';

export interface SpriteSource {
  url: string;
  kind: SpriteKind;
  /** Faktor, um den die Data-URL gegenüber dem Original vergrößert ist */
  scale: number;
}

interface Props {
  /** Schillernde Variante (Shiny) */
  shiny?: boolean;
  pokemon: Pokemon;
  style: SpriteStyle;
  className?: string;
  /** Lazy-Loading (Standard). Für sichtbare Feldspieler auf „eager" setzen. */
  loading?: 'lazy' | 'eager';
  /** Vorbereitete Quelle (Data-URL) für den Bild-Export */
  source?: SpriteSource;
  /** Name steht schon daneben: leerer Alt-Text, damit Screenreader ihn nicht doppelt vorlesen */
  decorative?: boolean;
}

/**
 * Pokémon-Sprite mit Fallback-Kette, CORS-tauglich für den Bild-Export.
 * Die natürliche Größe landet als --nw/--nh am Element, damit Pixel-Sprites
 * ihre relative Größe behalten (ein Wattzapf bleibt kleiner als ein Wailord).
 */
export function Sprite({ pokemon, style, className = '', loading = 'lazy', source, shiny = false, decorative = false }: Props) {
  const t = useT();
  const urls = useMemo(() => spriteUrls(pokemon, style, shiny), [pokemon, style, shiny]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [urls]);

  const url = source?.url ?? urls[Math.min(index, urls.length - 1)];
  const kind = source?.kind ?? spriteKind(url);
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const k = source?.scale ?? 1;
    img.style.setProperty('--nw', `${img.naturalWidth / k}px`);
    img.style.setProperty('--nh', `${img.naturalHeight / k}px`);
  };
  return (
    <img
      className={`sprite sprite--${kind} ${kind === 'art' ? '' : 'sprite--pixel'} ${className}`}
      src={url}
      alt={decorative ? '' : t.game.pokemon(pokemon)}
      loading={loading}
      decoding="async"
      crossOrigin={source ? undefined : 'anonymous'}
      draggable={false}
      onLoad={onLoad}
      onError={() => setIndex((i) => (i < urls.length - 1 ? i + 1 : i))}
    />
  );
}
