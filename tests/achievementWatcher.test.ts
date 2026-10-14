/** Hinweis „Erfolg freigeschaltet" nach einem gewerteten Run (AchievementWatcher). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { AchievementWatcher, requestAchievementCheck } = await import('../src/components/AchievementWatcher');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { act, createElement: h } = React;

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const meWith = (done: string[]) => ({
  player: 'Ash',
  coins: { earned: 0, spent: 0, balance: 0 },
  achievements: ['first_run', 'runs_10', 'c340_perfect'].map((id) => ({ id, done: done.includes(id), value: 0, goal: 1, coins: 50 })),
  trainer: {},
  owned: [],
});

describe('AchievementWatcher', () => {
  it('meldet nur neu erreichte Erfolge – beim ersten Mal (ohne gesehene Liste) gar keine', async () => {
    let done = ['first_run'];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(meWith(done)), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    localStorage.setItem('pokemon-elf:settings', JSON.stringify({ lang: 'de' }));
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(SettingsProvider, null, h(ToastProvider, null, h(AchievementWatcher)))));
    const settle = async () => {
      for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    };
    await act(async () => requestAchievementCheck());
    await settle();
    expect(doc.body.textContent).not.toContain('Erfolg freigeschaltet');
    expect(JSON.parse(localStorage.getItem('pokemon-elf:achievements-seen')!)).toEqual(['first_run']);
    done = ['first_run', 'c340_perfect'];
    await act(async () => requestAchievementCheck());
    await settle();
    expect(doc.body.textContent).toContain('Erfolg freigeschaltet: 34–0! (+50 ◎)');
    // Punkt „neue Erfolge" am Menü ist gesetzt
    expect(localStorage.getItem('pokemon-elf:achievements-new')).toBe('true');
    expect(doc.body.textContent).not.toContain('Anpfiff');
    await act(async () => root.unmount());
  });
});
