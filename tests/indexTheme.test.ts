/** index.html setzt Design und Browserleisten-Farbe schon vor React – mit denselben Farben wie Settings. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Inline-Skript in index.html', () => {
  it('folgt dem Gerät und nutzt die helle Leistenfarbe aus Settings', () => {
    const html = readFileSync('index.html', 'utf8');
    const settings = readFileSync('src/state/Settings.tsx', 'utf8');
    expect(html).toContain("matchMedia('(prefers-color-scheme: light)')");
    const light = settings.match(/'dark' \? '#[0-9a-f]{6}' : '(#[0-9a-f]{6})'/)![1];
    expect(html).toContain(`'content', '${light}'`);
    // Das Meta-Tag steht vor dem Skript
    expect(html.indexOf('name="theme-color"')).toBeLessThan(html.indexOf("prefers-color-scheme"));
  });
});
