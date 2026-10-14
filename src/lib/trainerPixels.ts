/**
 * Trainer als Pixel-Art: ein 32 × 32-Raster aus Farben (null = durchsichtig), Schicht für Schicht
 * gemalt – Hintergrund, Haare hinten, Kleidung, Kopf, Gesicht, Haare vorn, Kopfbedeckung, Accessoire.
 * Konturen sind eine dunklere Fassung der Fläche (wie bei den Pokémon-Sprites). Deterministisch und
 * zwischengespeichert (gleicher Look → dasselbe Raster).
 */
import { colorOf, type TrainerLook } from './trainer';

export const PX = 32;
export type PixelGrid = (string | null)[][];

/** Farbe heller (amount > 0) bzw. dunkler (amount < 0) */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

type Mask = (x: number, y: number) => boolean;

class Canvas {
  readonly g: PixelGrid = Array.from({ length: PX }, () => Array<string | null>(PX).fill(null));
  set(x: number, y: number, c: string) {
    if (x >= 0 && x < PX && y >= 0 && y < PX) this.g[y][x] = c;
  }
  get(x: number, y: number) {
    return x >= 0 && x < PX && y >= 0 && y < PX ? this.g[y][x] : null;
  }
  /** Fläche mit Kontur (Rand der Maske in `edge`) */
  fill(mask: Mask, c: string, edge: string | null = shade(c, -0.45)) {
    for (let y = 0; y < PX; y++) {
      for (let x = 0; x < PX; x++) {
        if (!mask(x, y)) continue;
        const border = edge && (!mask(x - 1, y) || !mask(x + 1, y) || !mask(x, y - 1) || !mask(x, y + 1));
        this.set(x, y, border ? edge : c);
      }
    }
  }
  /** Einzelne Pixel: [[x, y], …] */
  dots(points: readonly (readonly [number, number])[], c: string) {
    for (const [x, y] of points) this.set(x, y, c);
  }
  rect(x0: number, y0: number, w: number, h: number, c: string) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
  }
}

// ---------------------------------------------------------------- Formen

const HEAD_CX = 15.5;
const HEAD_CY = 14;
const head: Mask = (x, y) => ((x - HEAD_CX) / 7.4) ** 2 + ((y - HEAD_CY) / 8) ** 2 <= 1;
const ellipse = (cx: number, cy: number, rx: number, ry: number): Mask => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
/** Schultern/Oberkörper ab Zeile 24, nach unten breiter */
const body: Mask = (x, y) => y >= 24 && Math.abs(x - HEAD_CX) <= Math.min(15.6, 6.5 + (y - 24) * 1.6);
const union = (...ms: Mask[]): Mask => (x, y) => ms.some((m) => m(x, y));
const below = (row: number): Mask => (_x, y) => y >= row;
const above = (row: number): Mask => (_x, y) => y <= row;
const and = (...ms: Mask[]): Mask => (x, y) => ms.every((m) => m(x, y));

// ---------------------------------------------------------------- Hintergrund

function background(c: Canvas, id: string, color: string) {
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      let col = color;
      switch (id) {
        case 'sky':
          col = y < 10 ? '#8fd0f5' : y < 20 ? '#76c1ee' : '#5fb0e4';
          break;
        case 'sunset':
          col = y < 8 ? '#ffd36e' : y < 14 ? '#ffae5c' : y < 20 ? '#f0764b' : y < 26 ? '#c9566a' : '#8e3f7a';
          break;
        case 'pitch':
          col = Math.floor(x / 4) % 2 ? '#2f8a3e' : '#2a7f39';
          break;
        case 'night':
          col = y < 16 ? '#141c3a' : '#1b2650';
          break;
        case 'gold':
          col = (x + y) % 8 < 4 ? '#e2b83c' : '#d4a72c';
          break;
        case 'ocean':
          col = y < 18 ? '#3b8fd9' : y % 3 === 0 && x % 6 < 3 ? '#9fd4ff' : '#2a6fb8';
          break;
        case 'forest':
          col = y > 20 ? '#2d6b2a' : (x * 7 + y * 3) % 11 < 4 ? '#3d8a36' : '#4f9e45';
          break;
        case 'lava':
          col = y > 22 ? ((x + y) % 5 < 2 ? '#ffb02e' : '#e8501d') : y > 14 ? '#7a2414' : '#3a1410';
          break;
        case 'space':
          col = '#0b0b1e';
          break;
        case 'arena':
          // Arena: Steinwand mit Fugen oben, Kampffeld mit weißer Linie unten
          col = y < 16 ? ((y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 3) % 6 === 0) ? '#5a5f6b' : '#7b808c') : y === 22 ? '#eceff3' : '#b58b4c';
          break;
        case 'center':
          // Pokémon-Center: rosa Wand, Theke, heller Boden
          col = y < 18 ? (x % 8 === 0 ? '#f6b7c8' : '#f9cdd8') : y < 21 ? '#d8342a' : (x + y) % 4 < 2 ? '#f3f3f3' : '#e3e6ea';
          break;
        case 'stadium':
          col = y < 12 ? ((x * 5 + y * 3) % 7 < 2 ? '#d8342a' : (x * 3 + y) % 5 === 0 ? '#f2c230' : '#3a4152') : y < 14 ? '#c9ced6' : Math.floor(x / 4) % 2 ? '#2f8a3e' : '#2a7f39';
          break;
        case 'pokeball': {
          const d = Math.hypot(x - 15.5, y - 15.5);
          col = d > 14 ? '#22324a' : Math.abs(y - 15.5) < 1.5 || (d < 4.5 && d > 2.5) ? '#26282e' : y < 15.5 ? '#d8342a' : '#eceff3';
          break;
        }
      }
      c.set(x, y, col);
    }
  }
  if (id === 'night' || id === 'space') {
    c.dots([[3, 3], [9, 6], [27, 4], [22, 9], [5, 17], [28, 15], [14, 2], [25, 23]], '#ffffff');
    if (id === 'night') c.fill(ellipse(26, 5, 2.6, 2.6), '#f4f1c9', null);
    if (id === 'space') {
      c.fill(ellipse(5, 7, 3, 3), '#d06bd4', null);
      c.rect(1, 7, 9, 1, '#f2c230');
    }
  }
  if (id === 'sky') {
    c.rect(2, 4, 7, 2, '#ffffff');
    c.rect(4, 3, 3, 1, '#ffffff');
    c.rect(23, 7, 6, 2, '#ffffff');
  }
}

// ---------------------------------------------------------------- Haare

function hairBack(c: Canvas, style: string, col: string) {
  if (style === 'long') c.fill(and(ellipse(15.5, 18, 9.6, 11), below(10)), shade(col, -0.15));
  if (style === 'ponytail') {
    c.fill(ellipse(25, 10, 3, 3), shade(col, -0.15));
    c.fill(and(ellipse(26, 17, 2.4, 6), below(12)), shade(col, -0.15));
  }
  if (style === 'afro') c.fill(ellipse(15.5, 11, 11, 9.5), col);
  if (style === 'bob') c.fill(and(ellipse(15.5, 14, 9.4, 9.2), above(19)), shade(col, -0.1));
}

function hairFront(c: Canvas, style: string, col: string, hat: boolean) {
  const top = (row: number) => and(head, above(row));
  switch (style) {
    case 'bald':
    case 'afro':
      return;
    case 'short':
      c.fill(union(top(9), and(head, above(12), (x) => x <= 9 || x >= 22)), col);
      return;
    case 'long':
      c.fill(union(top(9), and(head, above(18), (x) => x <= 9 || x >= 22)), col);
      return;
    case 'bob':
      c.fill(union(top(9), and(head, above(17), (x) => x <= 9 || x >= 22)), col);
      return;
    case 'sidepart':
      c.fill(union(top(9), and(head, above(11), (x) => x <= 13), and(head, above(12), (x) => x >= 22)), col);
      c.dots([[14, 7], [15, 7], [16, 6]], shade(col, -0.45));
      return;
    case 'spiky': {
      const spikes: Mask = (x, y) => {
        if (y > 9) return false;
        const tooth = 6 - Math.abs(((x - 6) % 5) - 2.5) * 1.6;
        return x >= 6 && x <= 25 && y >= 3 + (5 - tooth) && head(x, Math.max(y, 7));
      };
      c.fill(union(top(9), spikes, and(head, above(12), (x) => x <= 9 || x >= 22)), col);
      return;
    }
    case 'mohawk':
      if (!hat) c.fill(union(and(ellipse(15.5, 6, 2, 5), below(1)), and(top(8), (x) => x >= 14 && x <= 17)), col);
      return;
    case 'curly': {
      const curls = union(...[[9, 9], [12, 6], [16, 5], [20, 6], [22, 9], [8, 13], [23, 13]].map(([x, y]) => ellipse(x, y, 2.6, 2.6)));
      c.fill(union(curls, top(8)), col);
      return;
    }
    case 'ponytail':
      c.fill(union(top(9), and(head, above(12), (x) => x <= 9)), col);
      return;
  }
}

// ---------------------------------------------------------------- Kleidung

function outfit(c: Canvas, style: string, col: string, skin: string) {
  // Hals
  c.fill((x, y) => y >= 21 && y <= 25 && x >= 13 && x <= 18, shade(skin, -0.12), shade(skin, -0.45));
  const base = style === 'labcoat' ? '#f3f5f8' : col;
  c.fill(body, base);
  const inside = (x: number, y: number) => body(x, y) && body(x - 1, y) && body(x + 1, y) && body(x, y + 1 < PX ? y + 1 : y);
  switch (style) {
    case 'shirt':
      c.fill((x, y) => y >= 24 && y <= 26 && Math.abs(x - HEAD_CX) <= 2.6 - (y - 24) * 0.9, shade(skin, -0.12), null);
      break;
    case 'jersey':
      for (let y = 25; y < PX; y++) for (const x of [10, 11, 20, 21]) if (inside(x, y)) c.set(x, y, '#f3f3f3');
      c.rect(14, 24, 4, 1, '#f3f3f3');
      // Rückennummer vorn: „11"
      c.rect(13, 27, 1, 4, '#f3f3f3');
      c.rect(17, 27, 1, 4, '#f3f3f3');
      break;
    case 'stripes':
      for (let y = 26; y < PX; y += 2) for (let x = 0; x < PX; x++) if (inside(x, y)) c.set(x, y, '#f3f3f3');
      break;
    case 'hoodie':
      c.fill((x, y) => y >= 22 && y <= 25 && Math.abs(x - HEAD_CX) <= 6 && Math.abs(x - HEAD_CX) >= 3.5, shade(col, -0.25), null);
      c.dots([[14, 26], [14, 27], [14, 28], [17, 26], [17, 27], [17, 28]], '#f3f3f3');
      c.rect(11, 29, 10, 2, shade(col, -0.18));
      break;
    case 'jacket':
      for (let y = 25; y < PX; y++) for (let x = 13; x <= 18; x++) if (inside(x, y)) c.set(x, y, x === 15 || x === 16 ? '#9aa0a8' : '#f3f3f3');
      c.dots([[12, 24], [13, 25], [19, 24], [18, 25]], '#26282e');
      break;
    case 'suit':
      for (let y = 24; y < 31; y++) {
        const w = Math.max(0, 3 - Math.floor((y - 24) / 2.4));
        for (let x = 16 - w; x <= 15 + w; x++) c.set(x, y, '#f6f6f6');
      }
      c.rect(15, 25, 2, 5, '#c62c2c');
      break;
    case 'tracksuit':
      for (let y = 25; y < PX; y++) for (const x of [5, 6, 25, 26]) if (inside(x, y)) c.set(x, y, '#f3f3f3');
      for (let y = 25; y < PX; y++) c.set(15, y, shade(col, -0.35));
      break;
    case 'labcoat':
      for (let y = 25; y < PX; y++) for (let x = 14; x <= 17; x++) if (inside(x, y)) c.set(x, y, col);
      c.dots([[12, 24], [13, 25], [19, 24], [18, 25]], '#9aa0a8');
      break;
  }
}

// ---------------------------------------------------------------- Gesicht

function face(c: Canvas, id: string, skin: string) {
  const eye = '#24201e';
  const mouth = '#7a2f22';
  const cheek = shade('#ff8a8a', 0.2);
  switch (id) {
    case 'happy':
      c.dots([[11, 14], [12, 13], [13, 14], [18, 14], [19, 13], [20, 14]], eye);
      c.rect(13, 17, 6, 1, mouth);
      c.dots([[14, 18], [15, 18], [16, 18], [17, 18]], mouth);
      break;
    case 'cool':
      c.rect(11, 14, 3, 1, eye);
      c.rect(18, 14, 3, 1, eye);
      c.dots([[11, 12], [12, 12], [19, 12], [20, 12]], shade(skin, -0.45));
      c.rect(14, 18, 4, 1, mouth);
      break;
    case 'wink':
      c.rect(12, 13, 1, 2, eye);
      c.rect(18, 14, 3, 1, eye);
      c.dots([[13, 17], [14, 18], [15, 18], [16, 18], [17, 17]], mouth);
      break;
    case 'surprised':
      c.rect(12, 13, 1, 2, eye);
      c.rect(19, 13, 1, 2, eye);
      c.dots([[15, 17], [16, 17], [15, 18], [16, 18]], mouth);
      break;
    case 'sleepy':
      // Halb geschlossene Augen, kleines „z"
      c.rect(11, 14, 3, 1, eye);
      c.rect(18, 14, 3, 1, eye);
      c.rect(15, 18, 2, 1, mouth);
      c.dots([[23, 8], [24, 8], [24, 9], [23, 10], [24, 10]], '#c9ced6');
      break;
    case 'grin':
      // Breites Grinsen mit Zähnen
      c.rect(12, 13, 1, 2, eye);
      c.rect(19, 13, 1, 2, eye);
      c.rect(12, 17, 8, 2, mouth);
      c.rect(13, 17, 6, 1, '#ffffff');
      break;
    case 'determined':
      c.rect(12, 13, 1, 2, eye);
      c.rect(19, 13, 1, 2, eye);
      c.dots([[11, 11], [12, 11], [13, 12], [20, 11], [19, 11], [18, 12]], shade(skin, -0.55));
      c.rect(14, 18, 4, 1, mouth);
      break;
    default:
      c.rect(12, 13, 1, 2, eye);
      c.rect(19, 13, 1, 2, eye);
      c.dots([[13, 17], [14, 18], [15, 18], [16, 18], [17, 18], [18, 17]], mouth);
  }
  c.dots([[10, 16], [21, 16]], cheek);
}

// ---------------------------------------------------------------- Kopfbedeckung

function hat(c: Canvas, id: string, cloth: string) {
  switch (id) {
    case 'cap':
    case 'backcap':
      c.fill(and(ellipse(15.5, 9.5, 8.6, 6.5), above(9)), cloth);
      if (id === 'cap') c.fill((x, y) => y === 10 && x >= 6 && x <= 25, shade(cloth, -0.3), shade(cloth, -0.5));
      else c.fill((x, y) => y === 10 && x >= 22 && x <= 27, shade(cloth, -0.3), shade(cloth, -0.5));
      c.rect(15, 6, 2, 2, '#ffffff');
      break;
    case 'pokecap':
      c.fill(and(ellipse(15.5, 9.5, 8.6, 6.5), above(9)), '#d8342a');
      c.rect(8, 8, 16, 2, '#f3f3f3');
      c.fill((x, y) => y === 10 && x >= 6 && x <= 25, '#b5281f', '#7a1a14');
      c.fill(ellipse(15.5, 7.5, 2, 2), '#f3f3f3', '#26282e');
      break;
    case 'beanie':
      c.fill(and(ellipse(15.5, 10, 8.8, 7.5), above(10)), cloth);
      c.rect(7, 9, 18, 2, shade(cloth, -0.22));
      c.fill(ellipse(15.5, 2.5, 1.8, 1.8), shade(cloth, 0.4));
      break;
    case 'bucket':
      c.fill(and(ellipse(15.5, 9, 7, 6), above(9)), cloth);
      c.fill((x, y) => y >= 9 && y <= 10 && x >= 5 && x <= 26, shade(cloth, -0.2));
      break;
    case 'headband':
      c.fill((x, y) => y >= 9 && y <= 10 && head(x, y), cloth, shade(cloth, -0.4));
      c.dots([[24, 10], [25, 11], [25, 9], [26, 12]], shade(cloth, -0.2));
      break;
    case 'bow':
      c.fill(union(ellipse(21, 6, 2.5, 2), ellipse(26, 6, 2.5, 2)), '#e86fb4');
      c.rect(23, 5, 2, 2, '#c94f93');
      break;
    case 'flower':
      c.fill(union(ellipse(23, 5, 1.6, 1.6), ellipse(26, 5, 1.6, 1.6), ellipse(24.5, 3, 1.6, 1.6), ellipse(24.5, 7, 1.6, 1.6)), '#ffffff', '#c9ced6');
      c.rect(24, 4, 2, 2, '#f2c230');
      break;
    case 'crown':
      c.fill((x, y) => y >= 3 && y <= 8 && x >= 9 && x <= 22 && (y >= 6 || [9, 10, 15, 16, 21, 22].includes(x)), '#f2c230', '#a87b10');
      c.dots([[15, 6], [16, 6]], '#d8342a');
      c.dots([[11, 7], [20, 7]], '#2f62c9');
      break;
    case 'pumpkin':
      c.fill(and(ellipse(15.5, 7, 8.5, 5.5), above(10)), '#e8772a', '#9a4510');
      // Rippen
      c.fill((x, y) => (x === 12 || x === 19) && y >= 3 && y <= 10, '#c45d1a');
      c.rect(15, 0, 2, 2, '#3f7a2e');
      c.dots([[17, 1], [18, 0]], '#4f9a3a');
      break;
    case 'santa':
      // Zipfel nach rechts mit Bommel, weißer Rand
      c.fill(union(and(ellipse(15.5, 9, 8.4, 6), above(9)), (x, y) => y >= 3 && y <= 6 && x >= 20 && x <= 25 - (6 - y)), '#d8342a', '#8f1f18');
      c.fill(ellipse(26, 7, 1.6, 1.6), '#f3f3f3', '#c9ced6');
      c.rect(7, 8, 18, 2, '#f3f3f3');
      break;
    case 'bunny':
      // Zwei Hasenohren mit rosa Innenseite
      for (const cx of [11.5, 19.5]) {
        c.fill(and(ellipse(cx, 2.5, 2, 4.5), above(7)), '#f3f3f3', '#9aa3ae');
        c.fill(and(ellipse(cx, 3, 0.9, 3), above(6)), '#f2a7c3');
      }
      break;
    case 'straw':
      // Breite Krempe, rotes Band
      c.fill(and(ellipse(15.5, 8, 6.5, 5), above(8)), '#e9c46a', '#a8862e');
      c.fill((x, y) => y >= 8 && y <= 9 && x >= 3 && x <= 28, '#f2d27a', '#a8862e');
      c.rect(9, 6, 14, 1, '#d8342a');
      break;
    case 'party':
      // Spitzer Partyhut mit Streifen, Bommel und Gummiband
      c.fill((x, y) => y >= 2 && y <= 9 && Math.abs(x - 15.5) <= (y - 1.5) * 0.8, '#2f62c9');
      c.fill((x, y) => y >= 3 && y <= 8 && Math.abs(x - 15.5) <= (y - 1.5) * 0.8 - 1 && (x + y) % 4 < 2, '#f2c230', null);
      c.fill(ellipse(15.5, 1.5, 1.5, 1.5), '#f27fc0', '#b0447f');
      c.dots([[9, 10], [22, 10]], '#26282e');
      break;
    case 'hearts':
      // Haarreif mit zwei Herzen auf Federn
      c.fill((x, y) => y === 9 && head(x, y), '#e8326e', null);
      for (const cx of [11, 20]) {
        c.rect(cx, 4, 1, 5, '#26282e');
        c.dots([[cx - 2, 1], [cx - 1, 1], [cx + 1, 1], [cx + 2, 1], [cx - 2, 2], [cx - 1, 2], [cx, 2], [cx + 1, 2], [cx + 2, 2], [cx - 1, 3], [cx, 3], [cx + 1, 3], [cx, 4]], '#e8326e');
        c.dots([[cx - 2, 1]], '#f7a1bf');
      }
      break;
    case 'leaves':
      // Herbstkranz: Blätter in Rot, Orange und Gelb auf einem Reif
      c.fill((x, y) => y === 9 && head(x, y), '#7a5236', null);
      for (const [x, y, col] of [[9, 8, '#d8342a'], [12, 7, '#e8772a'], [15, 6, '#f2c230'], [18, 7, '#d8342a'], [21, 8, '#e8772a']] as const) {
        c.fill(ellipse(x, y, 1.6, 1.3), col, shade(col, -0.35));
      }
      c.dots([[15, 4], [16, 5]], '#7a5236');
      break;
    case 'wizard':
      c.fill((x, y) => y <= 9 && y >= 0 && Math.abs(x - 15.5) <= 1 + y * 0.9, '#5b3fb0');
      c.rect(6, 9, 20, 2, '#4a3191');
      c.dots([[14, 4], [17, 6], [13, 7]], '#f2c230');
      break;
  }
}

// ---------------------------------------------------------------- Accessoires

function accessory(c: Canvas, id: string, cloth: string) {
  switch (id) {
    case 'glasses':
      for (const x0 of [10, 17]) {
        c.rect(x0, 12, 4, 1, '#26282e');
        c.rect(x0, 15, 4, 1, '#26282e');
        c.rect(x0, 12, 1, 4, '#26282e');
        c.rect(x0 + 3, 12, 1, 4, '#26282e');
      }
      c.rect(14, 13, 3, 1, '#26282e');
      break;
    case 'sunglasses':
      c.rect(10, 12, 5, 3, '#111111');
      c.rect(17, 12, 5, 3, '#111111');
      c.rect(14, 12, 4, 1, '#111111');
      c.dots([[11, 12], [18, 12]], '#6b7280');
      break;
    case 'scarf': {
      const col = shade(cloth, 0.5);
      c.fill((x, y) => y >= 22 && y <= 24 && Math.abs(x - HEAD_CX) <= 6.5, col, shade(col, -0.35));
      c.fill((x, y) => y >= 24 && y <= 29 && x >= 18 && x <= 19, shade(col, -0.12), null);
      break;
    }
    case 'medal':
      c.dots([[13, 24], [14, 25], [18, 24], [17, 25], [15, 26], [16, 26]], '#2f62c9');
      c.fill(ellipse(15.5, 28.5, 1.8, 1.8), '#f2c230', '#a87b10');
      break;
    case 'bandana':
      c.fill((x, y) => y >= 18 && y <= 21 && head(x, y) && y - 18 <= 3 - Math.abs(x - 15.5) / 3, '#d8342a', '#8a1d16');
      break;
    case 'eyepatch':
      c.rect(11, 12, 4, 4, '#111111');
      c.dots([[10, 11], [9, 10], [15, 11], [16, 10], [17, 10]], '#111111');
      break;
    case 'mustache':
      c.rect(13, 16, 6, 1, '#3a2a20');
      c.dots([[12, 17], [19, 17]], '#3a2a20');
      break;
    case 'freckles':
      c.dots([[11, 16], [12, 17], [10, 17], [19, 17], [20, 16], [21, 17]], '#b8714a');
      break;
    case 'bowtie':
      // Dunkel, damit sie auf jeder Kleidungsfarbe zu sehen ist
      c.fill(union(ellipse(13.5, 24, 1.8, 1.4), ellipse(17.5, 24, 1.8, 1.4)), '#26282e', '#0d0e11');
      c.rect(15, 23, 2, 2, '#f2c230');
      break;
    case 'headphones':
      // Bügel über den Kopf, Muscheln an den Ohren
      c.fill((x, y) => y >= 4 && y <= 5 && Math.abs(x - HEAD_CX) <= 7 && Math.abs(x - HEAD_CX) >= 5 - (y - 4) * 3, '#26282e');
      c.fill((x, y) => y === 3 && Math.abs(x - HEAD_CX) <= 5, '#26282e');
      for (const cx of [7.5, 23.5]) c.fill(ellipse(cx, 13, 1.6, 2.6), '#2f62c9', '#1b3a7a');
      c.fill((x, y) => (x === 7 || x === 24) && y >= 5 && y <= 10, '#26282e');
      break;
    case 'whistle':
      c.dots([[12, 24], [13, 25], [14, 26], [19, 24], [18, 25], [17, 26]], '#26282e');
      c.rect(15, 27, 3, 2, '#c9ced6');
      break;
  }
}

// ---------------------------------------------------------------- Zusammensetzen

const cache = new Map<string, PixelGrid>();

/** Raster eines Looks (zwischengespeichert). */
export function trainerPixels(look: TrainerLook): PixelGrid {
  const key = JSON.stringify(look);
  const hit = cache.get(key);
  if (hit) return hit;
  const c = new Canvas();
  const skin = colorOf('skin', look.skin);
  const hairCol = colorOf('hairColor', look.hairColor);
  const cloth = colorOf('outfitColor', look.outfitColor);
  background(c, look.background, colorOf('background', look.background));
  hairBack(c, look.hair, hairCol);
  outfit(c, look.outfit, cloth, skin);
  // Ohren und Kopf
  c.fill(union(ellipse(8, 15, 1.6, 2), ellipse(23, 15, 1.6, 2)), shade(skin, -0.08));
  c.fill(head, skin);
  face(c, look.face, skin);
  hairFront(c, look.hair, hairCol, look.hat !== 'none');
  hat(c, look.hat, cloth);
  accessory(c, look.accessory, cloth);
  if (cache.size > 300) cache.clear();
  cache.set(key, c.g);
  return c.g;
}

/** Raster als Rechtecke (gleiche Farben in einer Zeile zusammengefasst) – für SVG */
export function pixelRuns(grid: PixelGrid): { x: number; y: number; w: number; c: string }[] {
  const out: { x: number; y: number; w: number; c: string }[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < PX) {
      const c = row[x];
      let w = 1;
      while (x + w < PX && row[x + w] === c) w++;
      if (c) out.push({ x, y, w, c });
      x += w;
    }
  });
  return out;
}
