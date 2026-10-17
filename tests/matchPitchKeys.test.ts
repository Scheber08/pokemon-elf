/** 2D-Wiedergabe: ←/→ springen 5 Spielminuten (Schieberegler folgt, Grenzen 0 und Spielende), Kürzel-Zeile. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMiniDom, MiniEvent } from './miniDom';

const doc = installMiniDom();
// Keine Animation im Test: die Zeit bewegt sich nur über die Tasten
vi.stubGlobal('requestAnimationFrame', () => 0);
vi.stubGlobal('cancelAnimationFrame', () => {});
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MatchPitch } = await import('../src/components/MatchPitch');
const { act, createElement: h } = React;

const match = { round: 1, home: 0, away: 1, hg: 1, ag: 0, homeScorers: [{ id: 25, minute: 30 }], awayScorers: [] } as never;

function key(k: string) {
  const e = new MiniEvent('keydown', { bubbles: true, cancelable: true }) as MiniEvent & { key: string };
  e.key = k;
  act(() => {
    (globalThis.window as unknown as { dispatchEvent(e: unknown): void }).dispatchEvent(e);
  });
}

describe('MatchPitch Pfeiltasten', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('springt mit ← / → in 5-Minuten-Schritten', () => {
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    root = createRoot(host as never);
    act(() => {
      root!.render(h(MatchPitch, { match, lineups: [null, null], nameOf: (n: number) => `T${n}`, pokemonName: (id: number) => `P${id}` }));
    });
    const slider = () => host.querySelector('.match-pitch__slider')!;
    expect(Number(slider().value)).toBe(0);
    expect(slider().getAttribute('title')).toContain('5 Minuten');
    // Kürzel-Zeile unter den Knöpfen
    expect(host.querySelector('.match-pitch__keys')!.textContent).toBe('⌨️ Leertaste ⏯ · N nächstes Tor · ← / → ±5 Min.');
    key('ArrowRight');
    key('ArrowRight');
    expect(Number(slider().value)).toBe(10);
    key('ArrowLeft');
    expect(Number(slider().value)).toBe(5);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(Number(slider().value)).toBe(0);
  });

  it('Tempo wird gemerkt: 1× → 2× gespeichert, neuer Dialog startet mit 2×; Unsinn im Speicher → 1×', () => {
    localStorage.removeItem('pokemon-elf:replay-rate');
    const mount = () => {
      const host = doc.createElement('div');
      doc.body.appendChild(host);
      root = createRoot(host as never);
      act(() => {
        root!.render(h(MatchPitch, { match, lineups: [null, null], nameOf: (n: number) => `T${n}`, pokemonName: (id: number) => `P${id}` }));
      });
      return host;
    };
    let host = mount();
    const rate = () => host.querySelector('.match-pitch__rate')!;
    expect(rate().textContent).toBe('1×');
    act(() => (rate() as unknown as { click(): void }).click());
    expect(rate().textContent).toBe('2×');
    expect(localStorage.getItem('pokemon-elf:replay-rate')).toBe('2');
    act(() => root?.unmount());
    host = mount();
    expect(rate().textContent).toBe('2×');
    act(() => root?.unmount());
    localStorage.setItem('pokemon-elf:replay-rate', '3');
    host = mount();
    expect(rate().textContent).toBe('1×');
    localStorage.removeItem('pokemon-elf:replay-rate');
  });
});

