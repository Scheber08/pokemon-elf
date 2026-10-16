/** Design beim ersten Besuch: wie das Gerät (hell/dunkel); eine gespeicherte Wahl gewinnt. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMiniDom } from './miniDom';

installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { SettingsProvider, detectTheme } = await import('../src/state/Settings');
const { act, createElement: h } = React;

const media = (light: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: light && q.includes('light'), media: q }));
const savedTheme = () => JSON.parse(localStorage.getItem('pokemon-elf:settings') ?? '{}').theme;
const mount = async () => {
  const root = createRoot(document.createElement('div') as unknown as Element);
  await act(async () => root.render(h(SettingsProvider, null, h('p'))));
  await act(async () => root.unmount());
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Design-Vorgabe', () => {
  it('folgt dem Gerät, ohne matchMedia dunkel', () => {
    media(true);
    expect(detectTheme()).toBe('light');
    media(false);
    expect(detectTheme()).toBe('dark');
    vi.stubGlobal('matchMedia', undefined);
    expect(detectTheme()).toBe('dark');
  });

  it('erster Besuch übernimmt das Gerät, gespeicherte Wahl gewinnt', async () => {
    media(true);
    await mount();
    expect(savedTheme()).toBe('light');
    localStorage.setItem('pokemon-elf:settings', JSON.stringify({ theme: 'dark' }));
    await mount();
    expect(savedTheme()).toBe('dark');
  });
});
