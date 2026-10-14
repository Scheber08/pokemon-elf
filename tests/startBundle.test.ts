/**
 * Start-Paket: Was main.tsx statisch (nicht per import()) erreicht, landet im ersten Download.
 * Große, nur für einzelne Seiten nötige Module müssen nachgeladen werden.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

function resolveModule(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ext;
    if (existsSync(p) && !p.endsWith('/')) {
      try {
        readFileSync(p);
        return p;
      } catch {
        // Verzeichnis
      }
    }
  }
  return null;
}

/** Alle statisch importierten Projektdateien ab einer Datei (ohne import type und import()) */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(\.{1,2}\/[^']+)'/gms)) {
      const target = resolveModule(file, m[1]);
      if (target && /\.(ts|tsx)$/.test(target)) stack.push(target);
    }
  }
  return seen;
}

describe('Start-Paket', () => {
  it('lädt Draft-Engine, Turnier und Saison-Ticker nicht statisch', () => {
    const graph = [...staticGraph(resolve(ROOT, 'src/main.tsx'))].map((f) => f.slice(ROOT.length + 1));
    expect(graph).toContain('src/pages/Builder.tsx');
    for (const heavy of ['src/lib/draftEngine.ts', 'src/lib/cup.ts', 'src/components/LeagueTicker.tsx', 'src/components/FriendlyMatch.tsx']) {
      expect(graph, heavy).not.toContain(heavy);
    }
  });
});
