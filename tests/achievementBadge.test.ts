/** Punkt „Neue Erfolge" am Reiter Trainer: an nach neuen Erfolgen, aus nach dem Besuch der Trainer-Seite. */
import { describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { Header } = await import('../src/components/Layout');
const { setAchievementBadge, hasAchievementBadge } = await import('../src/components/AchievementWatcher');
const { act, createElement: h } = React;

describe('Erfolgs-Punkt im Menü', () => {
  it('erscheint und verschwindet mit dem gespeicherten Zustand', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(MemoryRouter, null, h(Header))));
    const dot = () => container.querySelector('.tab__dot');
    expect(dot()).toBeNull();
    await act(async () => setAchievementBadge(true));
    expect(hasAchievementBadge()).toBe(true);
    expect(dot()).not.toBeNull();
    expect(dot()!.textContent).toBe('Neue Erfolge');
    await act(async () => setAchievementBadge(false));
    expect(dot()).toBeNull();
    await act(async () => root.unmount());
  });
});
