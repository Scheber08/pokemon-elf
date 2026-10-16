/** Trainer-Seite: „Deine Bilanz“ mit Podestplätzen und perfekten Saisons. */
import { describe, expect, it } from 'vitest';
import { installMiniDom, type MiniElement } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { RecordCard } = await import('../src/pages/Trainer');
const { act, createElement: h } = React;

describe('Deine Bilanz', () => {
  it('zeigt Podestplätze und perfekte Saisons über alle Challenges', async () => {
    const stats = {
      runs: 12,
      challenges: { c340: { runs: 8, bestWins: 34, perfect: 2 }, c151: { runs: 4, bestWins: 30, perfect: 1 } },
      dailyDays: 3,
      dailyStreak: 2,
      dailyWins: 0,
      bestPlace: 4,
      draft: { leagues: 5, titles: 1, cups: 0, manager: 1, podiums: 3, managerPodiums: 1 },
    };
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(MemoryRouter, null, h(RecordCard, { stats } as never))));
    const pairs = container.querySelectorAll('dt').map((dt) => [dt.textContent, (dt.parentNode as MiniElement).querySelector('dd')!.textContent]);
    // Podestplätze zählen Manager-Saisons schon mit (kein Doppelzählen)
    expect(pairs).toContainEqual(['Podestplätze', '3']);
    expect(pairs).toContainEqual(['Perfekte Saisons', '3']);
    await act(async () => root.unmount());
  });
});
