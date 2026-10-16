/** Druckansicht: helles Design auf weißem Papier, Kopf/Navigation/Bedienelemente ausgeblendet. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const print = (() => {
  const i = css.indexOf('@media print {');
  return i < 0 ? '' : css.slice(i, css.indexOf('\n}\n', i));
})();

describe('Druckansicht', () => {
  it('überschreibt auch das dunkle Design mit hellen Farben', () => {
    expect(print).toContain(":root[data-theme='dark']");
    expect(print).toMatch(/--bg: #ffffff;/);
    expect(print).toMatch(/--text: #0d1b2a;/);
    expect(print).toContain('color-scheme: light');
  });
  it('blendet Kopf, Navigation, Hinweise und Knopfleisten aus', () => {
    for (const sel of ['.site-header', '.skip-link', '.back-to-top', '.offline-banner-wrap', '.toasts', '.actionbar']) expect(print).toContain(sel);
    expect(print).toContain('display: none');
  });
});
