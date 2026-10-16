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
    case 'jester': {
      // Narrenkappe: zwei Zipfel in Rot und Gelb, die zur Seite fallen, mit Glöckchen an den Spitzen
      const horn = (sx: number): Mask => (x, y) =>
        [0, 1, 2, 3, 4].some((i) => ((x - (15.5 + sx * (3 + i * 2))) / (3.2 - i * 0.55)) ** 2 + ((y - (6 - i * 0.6 + (i > 2 ? (i - 2) * 1.4 : 0))) / (3 - i * 0.5)) ** 2 <= 1);
      const cap = union(horn(-1), horn(1), and(ellipse(15.5, 9.5, 8, 5), above(9)));
      const inner: Mask = (x, y) => cap(x, y) && cap(x - 1, y) && cap(x + 1, y) && cap(x, y - 1) && cap(x, y + 1);
      c.fill(cap, '#d8342a', '#5a1a14');
      c.fill((x, y) => x >= 16 && inner(x, y), '#f2c230', null);
      c.rect(7, 9, 18, 1, '#26282e');
      for (const cx of [4, 27]) c.dots([[cx, 8], [cx, 9]], '#f2c230');
      break;
    }
    case 'tyrolean':
      // Tirolerhut: grüner Filz mit schmaler Krempe, rotem Band und Feder
      c.fill(and(ellipse(15.5, 9, 6.5, 6), above(9)), '#3f6b3a', '#24401f');
      c.fill((x, y) => y >= 8 && y <= 9 && x >= 6 && x <= 25, '#4f7f48', '#24401f');
      c.rect(10, 7, 12, 1, '#d8342a');
      c.dots([[21, 6], [22, 5], [23, 4], [23, 3], [24, 2], [24, 1]], '#f3f3f3');
      c.dots([[22, 6], [23, 5]], '#c9ced6');
      break;
    case 'leaves':
      // Herbstkranz: Blätter in Rot, Orange und Gelb auf einem Reif
      c.fill((x, y) => y === 9 && head(x, y), '#7a5236', null);
      for (const [x, y, col] of [[9, 8, '#d8342a'], [12, 7, '#e8772a'], [15, 6, '#f2c230'], [18, 7, '#d8342a'], [21, 8, '#e8772a']] as const) {
        c.fill(ellipse(x, y, 1.6, 1.3), col, shade(col, -0.35));
      }
      c.dots([[15, 4], [16, 5]], '#7a5236');
      break;
    case 'advent':
      // Adventskranz (Advent): Tannengrün-Reif mit roten Beeren und vier Kerzen, eine davon brennt
      c.fill(and(ellipse(15.5, 8.5, 9, 2.6), (_x, y) => y >= 7), '#2f7a3a', '#1c4f25');
      c.dots([[9, 9], [14, 10], [19, 10], [23, 9]], '#d8342a');
      for (const x of [9, 13, 18, 22]) c.rect(x, 3, 2, 5, '#f3efe4');
      c.rect(9, 1, 2, 2, '#f7a21b');
      c.dots([[9, 0]], '#ffd84a');
      break;
    case 'snowcap':
      // Schneeflockenmütze (Winterzauber): hellblaue Strickmütze mit weißen Flocken, Umschlag und großem Bommel
      c.fill(and(ellipse(15.5, 10, 8.8, 7.5), above(10)), '#7fb8e6', '#4a7fb0');
      c.rect(7, 9, 18, 2, '#ffffff');
      c.dots([[10, 6], [20, 6], [13, 7], [18, 7]], '#ffffff');
      c.fill(ellipse(15.5, 2, 2.6, 2.2), '#ffffff', '#c9d6e3');
      break;
    case 'praline':
      // Praline (Tag der Schokolade): Schokokuppel mit heller Glasur-Streifen und einer Kirsche obendrauf
      c.fill(and(ellipse(15.5, 9.5, 8.5, 6.5), above(10)), '#6b3f22', '#3e2312');
      c.rect(8, 9, 16, 1, '#4a2a16');
      c.dots([[10, 6], [12, 5], [14, 6], [16, 5], [18, 6], [20, 5], [22, 6]], '#c8925e');
      c.fill(ellipse(15.5, 2.3, 1.8, 1.6), '#d0213a', '#7d1020');
      c.dots([[16, 0]], '#3c7a2e');
      break;
    case 'crescent':
      // Mondsichel-Reif (Tag des Mondes): dunkelblauer Haarreif mit goldener Mondsichel und zwei Sternen
      c.fill(and(ellipse(15.5, 10, 9, 3), (_x, y) => y >= 8), '#2b3a7a', '#18214a');
      c.fill(and(ellipse(15.5, 4.5, 4, 4), (x, y) => (x - 17.3) ** 2 + (y - 3.6) ** 2 > 10), '#f5d04a', '#b8922a');
      c.dots([[8, 4], [23, 3], [22, 7]], '#fff4b0');
      break;
    case 'penguin':
      // Pinguinmütze (Weltpinguintag): schwarze Strickmütze mit weißem Gesicht, zwei Augen und orangem Schnabel
      c.fill(and(ellipse(15.5, 10, 8.8, 7.5), above(10)), '#26282e', '#111216');
      c.fill(ellipse(15.5, 6.5, 4.2, 3), '#ffffff', null);
      c.dots([[14, 6], [17, 6]], '#26282e');
      c.rect(15, 7, 2, 1, '#f08a24');
      c.rect(7, 9, 18, 2, '#3a3d45');
      break;
    case 'wheat':
      // Erntekranz (Erntedank): goldene Ähren auf einem Strohreif, dazwischen ein roter Apfel
      c.fill((x, y) => y === 9 && head(x, y), '#b8862c', null);
      for (const [x, y] of [[9, 7.5], [12, 6.5], [19, 6.5], [22, 7.5]] as const) {
        c.fill(ellipse(x, y, 1.4, 2.2), '#f2c230', null);
        c.dots([[Math.round(x - 0.5), Math.round(y)]], '#c99a1c');
      }
      c.fill(ellipse(15.5, 6.5, 2.2, 2), '#d8342a', null);
      c.dots([[14, 6]], '#f08070');
      c.dots([[16, 4], [17, 4]], '#6b8f2a');
      break;
    case 'mortarboard':
      // Doktorhut: Kappe, flaches Brett mit hellem Rand und goldene Quaste
      c.fill(and(ellipse(15.5, 9.5, 7.2, 4), above(9)), '#2b2d36', '#15161b');
      c.fill((x, y) => y >= 4 && y <= 6 && Math.abs(x - 15.5) <= 10 - Math.abs(y - 5) * 2, '#2b2d36', '#6a7182');
      c.dots([[15, 5], [16, 5]], '#f2c230');
      c.dots([[17, 5], [18, 5], [19, 5], [20, 5], [21, 6], [21, 7], [21, 8]], '#f2c230');
      c.dots([[21, 9], [22, 9]], '#c99a1c');
      break;
    case 'mitre':
      // Bischofsmütze (Nikolaus): hohe weiße Mitra mit rotem Mittelstreifen, goldenem Band und Kreuz, oben gespalten
      c.fill((x, y) => y >= 0 && y <= 9 && Math.abs(x - 15.5) <= 2.5 + y * 0.55 && !(y <= 1 && Math.abs(x - 15.5) < 1), '#f3efe0', '#b8ad8f');
      c.fill((x, y) => y >= 2 && y <= 9 && Math.abs(x - 15.5) <= 1 && !(y >= 4 && y <= 6), '#d8342a', null);
      c.dots([[15, 4], [16, 4], [14, 5], [15, 5], [16, 5], [17, 5], [15, 6], [16, 6]], '#f2c230');
      c.fill((x, y) => y === 9 && Math.abs(x - 15.5) <= 7, '#f2c230', null);
      break;
    case 'propeller':
      // Propellermütze (Weltkindertag): bunte Kappe in vier Feldern, kurzer Stiel und Propeller obendrauf
      c.fill(and(ellipse(15.5, 9.5, 8.4, 5.5), above(9)), '#d8342a', '#8f1f18');
      c.fill((x, y) => and(ellipse(15.5, 9.5, 7.4, 4.5), above(9))(x, y) && x >= 12 && x <= 15, '#f2c230', null);
      c.fill((x, y) => and(ellipse(15.5, 9.5, 7.4, 4.5), above(9))(x, y) && x >= 16 && x <= 19, '#2f62c9', null);
      c.fill((x, y) => and(ellipse(15.5, 9.5, 7.4, 4.5), above(9))(x, y) && x >= 20, '#2f9a57', null);
      c.rect(7, 9, 18, 1, '#26282e');
      c.rect(15, 2, 2, 2, '#26282e');
      c.rect(10, 1, 5, 1, '#e86fb4');
      c.rect(17, 1, 5, 1, '#3fb8e6');
      c.rect(15, 1, 2, 1, '#f2c230');
      break;
    case 'pikaears':
      // Pikachu-Ohren (Pokémon Day): Haarreif mit zwei langen, schräg abstehenden gelben Ohren und schwarzen Spitzen
      c.fill((x, y) => y === 9 && head(x, y), '#26282e', null);
      for (const side of [-1, 1] as const) {
        const ear: Mask = (x, y) => y >= 0 && y <= 9 && Math.abs(x - (15.5 + side * (4 + (9 - y) * 0.7))) <= 0.7 + y * 0.22;
        c.fill(ear, '#f7d02c', '#8a6d08');
        c.fill((x, y) => ear(x, y) && y <= 2, '#26282e', null);
      }
      break;
    case 'antennae':
      // Bienen-Fühler (Weltbienentag): schwarzer Haarreif mit zwei gebogenen Fühlern und gelb-schwarzen Kugeln
      c.fill((x, y) => y === 9 && head(x, y), '#26282e', null);
      c.dots([[11, 8], [10, 7], [10, 6], [9, 6], [20, 8], [21, 7], [21, 6], [22, 6]], '#26282e');
      for (const cx of [8, 23]) {
        c.fill(ellipse(cx, 4, 2.4, 2.1), '#f2c230', null);
        c.fill((x, y) => ellipse(cx, 4, 2.4, 2.1)(x, y) && y === 5, '#26282e', null);
      }
      break;
    case 'flowercrown':
      // Blumenkranz (Tag der Freundschaft): grünes Band um den Kopf mit bunten Blüten
      c.fill((x, y) => (y === 7 || y === 8) && Math.abs(x - 15.5) <= 6.5 + (y - 7), '#4f9a3c', null);
      for (const [cx, col] of [[9, '#f08a8a'], [12, '#f2c230'], [15.5, '#9fc9f2'], [19, '#f08ac8'], [22, '#f2c230']] as const) {
        c.fill(ellipse(cx, 6.2, 1.5, 1.5), col, null);
        c.dots([[Math.round(cx), 6]], '#ffffff');
      }
      break;
    case 'dogears':
      // Hundeohren (Welthundetag): brauner Haarreif mit zwei Schlappohren, die seitlich am Kopf herunterhängen
      c.fill((x, y) => y === 9 && head(x, y), '#7a4f2a', null);
      for (const cx of [6.5, 24.5]) {
        c.fill(ellipse(cx, 13, 2.4, 6), '#c8955a', '#4a2f14');
        c.fill(ellipse(cx, 14, 1, 3.6), '#8f5e30', null);
      }
      break;
    case 'beret':
      // Baskenmütze (Fête de la Musique): flache, schräg sitzende schwarze Mütze mit kleinem Stiel und Notenanstecker
      c.fill((x, y) => y >= 4 && y <= 8 && ((x - 14.5) / 9.5) ** 2 + ((y - 7) / 3.2) ** 2 <= 1, '#26282e', '#0d0e11');
      c.rect(14, 2, 2, 2, '#26282e');
      c.dots([[20, 6], [20, 5], [21, 4], [19, 7], [20, 7]], '#f2c230');
      break;
    case 'sprout':
      // Keimling (Weltumwelttag): grüner Stiel aus dem Scheitel mit zwei runden Blättern
      c.rect(15, 3, 2, 6, '#3f8f3a');
      c.fill(ellipse(11.5, 3.5, 3.4, 1.9), '#6cc04a', '#2f6b2a');
      c.fill(ellipse(20.5, 2.5, 3.4, 1.9), '#6cc04a', '#2f6b2a');
      c.dots([[10, 3], [19, 2]], '#a8e07a');
      break;
    case 'book':
      // Offenes Buch (Welttag des Buches): aufgeschlagen wie ein Dach auf dem Kopf, roter Einband, helle Seiten mit Zeilen
      c.fill((x, y) => y >= 3 && y <= 9 && Math.abs(x - 15.5) <= 2 + (y - 3) * 1.6, '#b8342a', '#6e1c16');
      c.fill((x, y) => y >= 4 && y <= 8 && Math.abs(x - 15.5) >= 1 && Math.abs(x - 15.5) <= 1 + (y - 3) * 1.6, '#f4ecd8', null);
      c.dots([[12, 6], [13, 6], [18, 6], [19, 6], [10, 8], [11, 8], [12, 8], [19, 8], [20, 8], [21, 8]], '#9a8f78');
      c.rect(15, 2, 2, 7, '#6e1c16');
      break;
    case 'piggy':
      // Sparschwein (Weltspartag): rosa Schwein auf dem Kopf mit Münzschlitz, Ohren, Rüssel und goldener Münze
      c.fill(ellipse(15.5, 5.5, 6.5, 3.6), '#f4a6c0', '#b0566f');
      c.dots([[10, 2], [11, 2], [20, 2], [21, 2]], '#e07d9c');
      c.rect(14, 2, 3, 1, '#6e2b3e');
      c.fill(ellipse(22.5, 6, 1.6, 1.4), '#e88aa8', '#b0566f');
      c.dots([[22, 6], [23, 6]], '#6e2b3e');
      c.dots([[12, 5]], '#26282e');
      c.fill(ellipse(15.5, 0.8, 1.6, 1.2), '#f2c230', '#9a7410');
      break;
    case 'chef':
      // Kochmütze (Tag der Familie): hohe weiße Haube mit Bauschen über einem schmalen Band
      c.fill(ellipse(12, 3.5, 3.2, 2.8), '#f7f7f2', '#a9a9a0');
      c.fill(ellipse(15.5, 2.5, 3.4, 3), '#f7f7f2', '#a9a9a0');
      c.fill(ellipse(19, 3.5, 3.2, 2.8), '#f7f7f2', '#a9a9a0');
      c.fill((x, y) => y >= 5 && y <= 8 && x >= 10 && x <= 21, '#f7f7f2', '#a9a9a0');
      c.rect(10, 8, 12, 1, '#d8d8cf');
      break;
    case 'catears':
      // Katzenohren (Weltkatzentag): schwarzer Haarreif mit zwei spitzen Ohren, innen rosa
      c.fill((x, y) => y === 9 && head(x, y), '#26282e', null);
      for (const cx of [10.5, 20.5]) {
        const ear: Mask = (x, y) => y >= 2 && y <= 8 && Math.abs(x - cx) <= (y - 2) * 0.55;
        c.fill(ear, '#26282e', '#0d0e11');
        c.fill((x, y) => y >= 5 && y <= 7 && Math.abs(x - cx) <= (y - 4.5) * 0.5, '#f29ab8', null);
      }
      break;
    case 'birdnest':
      // Vogelnest (Tag des Baumes): geflochtenes Nest mit abstehenden Zweigen und drei hellblauen Eiern
      for (const [cx, cy] of [[12.5, 5], [15.5, 4.2], [18.5, 5]] as const) c.fill(ellipse(cx, cy, 1.8, 2.3), '#a8e4f2', '#3f7f94');
      c.dots([[12, 4], [15, 3], [18, 4]], '#e6f8fc');
      c.fill((x, y) => y >= 6 && y <= 10 && Math.abs(x - 15.5) <= 8.5 - (y - 6) * 0.8, '#c08a4a', '#4a2f14');
      c.dots([[6, 5], [7, 6], [25, 5], [24, 6], [9, 8], [13, 7], [17, 8], [21, 7], [11, 9], [19, 9]], '#6b4420');
      c.dots([[10, 7], [15, 7], [20, 8], [14, 9], [22, 7]], '#e0b070');
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
    case 'divemask':
      // Taucherbrille (Tag der Ozeane): großes blau getöntes Glas mit gelbem Rahmen, Band und Schnorchel rechts
      c.rect(8, 10, 16, 1, '#26282e');
      c.rect(9, 11, 14, 5, '#f2c230');
      c.rect(10, 12, 12, 3, '#7fd0f0');
      c.dots([[11, 12], [12, 12], [18, 12]], '#d9f3ff');
      c.rect(15, 12, 2, 3, '#f2c230');
      c.rect(24, 6, 2, 9, '#ff7a3c');
      c.rect(23, 15, 2, 2, '#ff7a3c');
      c.rect(24, 5, 2, 1, '#26282e');
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
    case 'clownnose':
      // Clownsnase (Weltlachtag): rote Kugel mitten im Gesicht mit hellem Glanzpunkt
      c.fill(ellipse(15.5, 15.2, 2.1, 1.7), '#e8323a', '#a8202a');
      c.dots([[14, 14], [15, 14]], '#ffc2c2');
      break;
    case 'facepaint':
      // Fanschminke: Streifen in Vereinsfarbe und Weiß auf beiden Wangen
      for (const x0 of [9, 20]) {
        c.rect(x0, 15, 1, 3, cloth);
        c.rect(x0 + 1, 15, 1, 3, '#f3f3f3');
        c.rect(x0 + 2, 15, 1, 3, cloth);
      }
      break;
    case 'locket':
      // Herz-Medaillon: goldene Kette mit goldenem Herz und rosa Stein (sichtbar auf jeder Trikotfarbe)
      c.dots([[12, 24], [13, 25], [14, 26], [19, 24], [18, 25], [17, 26]], '#f2c230');
      c.dots([[14, 27], [15, 27], [17, 27], [18, 27], [14, 28], [18, 28], [15, 29], [17, 29]], '#f2c230');
      c.dots([[16, 30]], '#a87b10');
      c.rect(15, 28, 3, 1, '#f08a8a');
      c.dots([[16, 29]], '#f08a8a');
      break;
    case 'lantern':
      // Laterne am Stab: dunkler Stab über der Schulter, leuchtend orange Laterne mit Rahmen
      c.dots([[20, 23], [21, 22], [22, 21], [23, 20], [24, 20], [25, 21]], '#b07a3e');
      c.dots([[25, 22]], '#26282e');
      c.rect(24, 23, 3, 1, '#26282e');
      c.rect(23, 24, 5, 4, '#f08a2a');
      c.rect(24, 25, 3, 2, '#ffd34d');
      c.dots([[23, 24], [27, 24], [23, 27], [27, 27]], '#26282e');
      c.rect(24, 28, 3, 1, '#26282e');
      break;
    case 'sapling':
      // Setzling (Tag der Erde): Tontopf mit Erde, Stiel und zwei grünen Blättern vor der Brust
      c.rect(21, 22, 6, 1, '#a0522d');
      c.rect(22, 23, 4, 3, '#c46a3a');
      c.dots([[22, 25], [25, 25]], '#8a4523');
      c.rect(22, 21, 4, 1, '#4a3222');
      c.rect(24, 17, 1, 4, '#3f7a2e');
      c.dots([[22, 17], [23, 17], [23, 18]], '#4fbf5a');
      c.dots([[25, 16], [26, 16], [25, 15]], '#4fbf5a');
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
