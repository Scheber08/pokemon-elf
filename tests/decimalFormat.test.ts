/** Dezimalzahlen in der Oberfläche im Format der Sprache (fmtNumber: de 1,5 · en 1.5) – kein toFixed in Komponenten/Seiten. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fmtNumber } from '../src/i18n/lang';

/** Nur SVG-Koordinaten dürfen toFixed nutzen */
const ALLOWED = new Set(['src/components/PlaceChart.tsx']);

describe('Dezimaltrennzeichen', () => {
  it('fmtNumber: Komma im Deutschen, Punkt im Englischen', () => {
    expect(fmtNumber(26.94, 1, 'de')).toBe('26,9');
    expect(fmtNumber(26.94, 1, 'en')).toBe('26.9');
  });

  it('kein toFixed in Komponenten und Seiten (außer SVG-Koordinaten)', () => {
    const hits: string[] = [];
    for (const dir of ['src/components', 'src/pages']) {
      for (const f of readdirSync(dir)) {
        const path = join(dir, f);
        if (!/\.tsx?$/.test(f) || ALLOWED.has(path)) continue;
        if (readFileSync(path, 'utf8').includes('.toFixed(')) hits.push(path);
      }
    }
    expect(hits).toEqual([]);
  });
});
