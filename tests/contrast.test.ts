/** Kontrast: Textfarben (gedämpft, Grün, Rot) erreichen auf allen Flächen beider Designs WCAG AA (≥ 4,5:1). */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');

/** Variablen eines Theme-Blocks (erster Block nach dem Selektor) */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('Kontrast der Textfarben', () => {
  const dark = tokens(":root[data-theme='dark']");
  const light = { ...dark, ...tokens(":root[data-theme='light']") };
  for (const [name, theme] of [
    ['dunkel', dark],
    ['hell', light],
  ] as const) {
    it(`${name}: --text-dim, --yellow-text, --green-text, --red-text auf bg/surface/surface-2/surface-3`, () => {
      for (const fg of ['text', 'text-dim', 'yellow-text', 'green-text', 'red-text'])
        for (const bg of ['bg', 'surface', 'surface-2', 'surface-3']) {
          expect(theme[fg], `${fg} fehlt`).toBeDefined();
          expect(ratio(theme[fg], theme[bg]), `${fg} auf ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
    });
  }
  it('Typ-Würfelkarte: Schrift auf jeder Typfarbe ≥ 4,5:1, Beschriftung dort ohne Abdunklung', async () => {
    const { TYPES, TYPE_KEYS } = await import('../src/config/pokemonTypes');
    for (const k of TYPE_KEYS) expect(ratio(TYPES[k].text, TYPES[k].color), k).toBeGreaterThanOrEqual(4.5);
    // .rollcard__label hat opacity 0.85 – auf der Typfarbe (Inline-Stil) muss sie 1 sein
    expect(css).toMatch(/\.rollcard\[style\] \.rollcard__label \{\s*opacity: 1;/);
  });
  it('weiße Schrift auf den Grundfarben (Positions- und Ergebnis-Abzeichen)', () => {
    for (const c of ['green', 'blue', 'red']) expect(ratio('#ffffff', dark[c]), c).toBeGreaterThanOrEqual(4.5);
  });
  it('kein hart codiertes Mittelgrün als Textfarbe (dunkel nur 4,3:1) – stattdessen var(--green-text)', () => {
    const dir = new URL('../src/styles/', import.meta.url);
    const bad = readdirSync(dir)
      .filter((f) => f.endsWith('.css'))
      .flatMap((f) => [...readFileSync(new URL(f, dir), 'utf8').matchAll(/(?<![-\w])color:\s*#2e9a44/gi)].map(() => f));
    expect(bad).toEqual([]);
  });
});
