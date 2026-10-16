/** Trainer-Seite: „Deine Bilanz“ mit Podestplätzen und perfekten Saisons, benannte Fortschrittsbalken der Erfolge. */
import { describe, expect, it } from 'vitest';
import { installMiniDom, type MiniElement } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { AchievementItem, RecordCard } = await import('../src/pages/Trainer');
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

describe('Erfolge', () => {
  it('Fortschrittsbalken trägt den Namen des Erfolgs (Screenreader)', async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const a = { id: 'x-unbekannt', done: false, goal: 10, value: 4, coins: 50 };
    await act(async () => root.render(h('ul', null, h(AchievementItem, { a, fresh: false } as never))));
    const bar = container.querySelector('.achievement__bar')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('Fortschritt „x-unbekannt“');
    expect(bar.getAttribute('aria-valuenow')).toBe('4');
    await act(async () => root.unmount());
  });
});
