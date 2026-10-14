import type { Pokemon, SpriteStyle } from '../types';

export const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

/** Bitfeld aus scripts/build-data.mjs */
export const SPRITE_FLAG = { BW_ANIMATED: 1, DEFAULT: 2, GEN1: 4, GEN2: 8, ARTWORK: 16 } as const;

type SpriteLike = Pick<Pokemon, 'id' | 's'>;

function pixelUrls(p: SpriteLike): string[] {
  const urls: string[] = [];
  if (p.s & SPRITE_FLAG.BW_ANIMATED) urls.push(`${SPRITE_BASE}versions/generation-v/black-white/animated/${p.id}.gif`);
  if (p.s & SPRITE_FLAG.DEFAULT) urls.push(`${SPRITE_BASE}${p.id}.png`);
  return urls;
}

/**
 * Alle Kandidaten-URLs in Fallback-Reihenfolge.
 * - Pixel: Gen-V-Black/White-Animation, sonst Standard-Sprite
 * - Retro: Gen I (Rot/Blau) bzw. Gen II (Kristall), sonst Pixel
 * - Artwork: Official Artwork, sonst Pixel
 */
export function spriteUrls(p: SpriteLike, style: SpriteStyle, shiny = false): string[] {
  const urls: string[] = [];
  // Shiny: schillernde Varianten zuerst (fehlt eine, folgt die normale)
  if (shiny) {
    if (style === 'artwork' && p.s & SPRITE_FLAG.ARTWORK) urls.push(`${SPRITE_BASE}other/official-artwork/shiny/${p.id}.png`);
    if (p.s & SPRITE_FLAG.BW_ANIMATED) urls.push(`${SPRITE_BASE}versions/generation-v/black-white/animated/shiny/${p.id}.gif`);
    if (p.s & SPRITE_FLAG.DEFAULT) urls.push(`${SPRITE_BASE}shiny/${p.id}.png`);
  }
  if (style === 'retro') {
    if (p.s & SPRITE_FLAG.GEN1) urls.push(`${SPRITE_BASE}versions/generation-i/red-blue/transparent/${p.id}.png`);
    if (p.s & SPRITE_FLAG.GEN2) urls.push(`${SPRITE_BASE}versions/generation-ii/crystal/transparent/${p.id}.png`);
  } else if (style === 'artwork') {
    if (p.s & SPRITE_FLAG.ARTWORK) urls.push(`${SPRITE_BASE}other/official-artwork/${p.id}.png`);
  }
  urls.push(...pixelUrls(p));
  if (p.s & SPRITE_FLAG.ARTWORK && style !== 'artwork') urls.push(`${SPRITE_BASE}other/official-artwork/${p.id}.png`);
  return [...new Set(urls)];
}

export type SpriteKind = 'gif' | 'png96' | 'retro' | 'art';

/**
 * Art des Sprites – bestimmt die Darstellung:
 * gif = Gen-V-Animation (eng beschnitten), png96 = 96×96 mit Rand, retro = Gen I/II, art = Artwork.
 */
export function spriteKind(url: string): SpriteKind {
  if (url.includes('official-artwork')) return 'art';
  if (url.includes('/animated/')) return 'gif';
  if (url.includes('generation-i/') || url.includes('generation-ii/')) return 'retro';
  return 'png96';
}

/** Ob ein URL als Pixelgrafik (scharf skalieren) gerendert werden soll. */
export function isPixelSprite(url: string): boolean {
  return spriteKind(url) !== 'art';
}

export const SPRITE_STYLE_LABEL: Record<SpriteStyle, string> = {
  pixel: 'Pixel',
  retro: 'Retro',
  artwork: 'Artwork',
};
