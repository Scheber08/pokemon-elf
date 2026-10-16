/**
 * A11y-Wächter: aria-label auf generischen Elementen (span, div, p …) ohne Rolle ist laut ARIA verboten
 * (axe „aria-prohibited-attr“) – Screenreader ignorieren es. Jede solche Stelle braucht eine Rolle
 * (img, group, region …) oder aria-labelledby.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('aria-label nur mit Rolle', () => {
  it('kein generisches Element mit aria-label ohne role', () => {
    const bad: string[] = [];
    for (const f of files('src')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<(span|div|p|li|strong|small|em|b)\b([^<>]*?)>/gs)) {
        const attrs = m[2];
        if (/\baria-label=/.test(attrs) && !/\brole=/.test(attrs)) bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
