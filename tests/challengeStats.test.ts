/** Challenge-Statistik auf dem Gerät: Bestwerte, Runs und „Letzter Run“ in den Statistik-Karten. */
import { afterEach, describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { loadStats, recordRun } = await import('../src/lib/challengeStats');
const { StatCards } = await import('../src/components/ChallengeParts');
const { act, createElement: h } = React;

afterEach(() => localStorage.clear());

describe('Challenge-Statistik', () => {
  it('merkt sich den letzten Run neben den Bestwerten', () => {
    expect(loadStats('c340').last).toBeUndefined();
    recordRun('c340', 731, { w: 30, d: 2, l: 2 });
    const s = recordRun('c340', 700, { w: 25, d: 4, l: 5 });
    expect(s.runs).toBe(2);
    expect(s.bestScore).toBe(731);
    expect(s.last).toEqual({ score: 700, record: { w: 25, d: 4, l: 5 } });
    expect(loadStats('c340').last?.score).toBe(700);
  });

  it('„Letzter Run“ als vierte Karte nur mit showLast und vorhandenem Run', async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const stats = { bestScore: 731, bestRecord: { w: 30, d: 2, l: 2 }, runs: 2, last: { score: 700, record: { w: 25, d: 4, l: 5 } } };
    await act(async () => root.render(h(StatCards, { stats })));
    expect(container.querySelectorAll('.statcard')).toHaveLength(3);
    await act(async () => root.render(h(StatCards, { stats, showLast: true })));
    expect(container.querySelectorAll('.statcard')).toHaveLength(4);
    const last = container.querySelector('.statcard--last')!;
    expect(last.textContent).toBe('Letzter Run70025–4–5');
    // Alte Daten ohne letzten Run: weiter drei Karten
    await act(async () => root.render(h(StatCards, { stats: { ...stats, last: undefined }, showLast: true })));
    expect(container.querySelectorAll('.statcard')).toHaveLength(3);
    await act(async () => root.unmount());
  });
});
