/**
 * A11y-Wächter: ein Emoji-Zeichen in einem span, das seine Bedeutung nur im title trägt (🏅, ✨, 🏆 …),
 * bleibt für Screenreader stumm. Es braucht role="img" + aria-label oder einen sr-only-Text.
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

describe('Emoji mit title auch für Screenreader benannt', () => {
  it('kein span mit title={…}, der nur ein Emoji ohne Rolle oder sr-only-Text enthält', () => {
    const bad: string[] = [];
    for (const f of files('src')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<span\b([^<>]*?)\btitle=\{[^<>]*>/gs)) {
        if (/\b(role|aria-label)=/.test(m[0])) continue;
        const rest = src.slice(m.index! + m[0].length, m.index! + m[0].length + 250);
        const inner = rest.slice(0, Math.max(0, rest.indexOf('</span>')));
        if (inner.includes('sr-only')) continue;
        // {' '} ist nur ein Leerzeichen; jeder andere Ausdruck ({name}, {t.…}) liefert lesbaren Text
        const text = inner.replace(/\{' '\}/g, '').trim();
        if (/\p{Extended_Pictographic}/u.test(text) && !/\p{L}{3,}/u.test(text) && !text.includes('{')) bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
