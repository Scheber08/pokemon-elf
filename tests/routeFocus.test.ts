/** Seitenwechsel: Fokus an den Hauptbereich (nicht beim ersten Laden). */
import { describe, expect, it, vi } from 'vitest';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, Link, Routes, Route } = await import('react-router-dom');
const { RouteEffects } = await import('../src/App');
const { SettingsProvider } = await import('../src/state/Settings');
const { act, createElement: h } = React;

describe('Fokus nach Seitenwechsel', () => {
  for (const strict of [false, true])
  it(`erst nach einem Wechsel, nicht beim ersten Laden${strict ? ' (StrictMode: Effekte doppelt)' : ''}`, async () => {
    (window as unknown as { scrollTo: () => void }).scrollTo = vi.fn();
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const wrap = (el: ReturnType<typeof h>) => (strict ? h(React.StrictMode, null, el) : el);
    await act(async () =>
      root.render(wrap(
        h(
          MemoryRouter,
          { initialEntries: ['/'] },
          h(
            SettingsProvider,
            null,
            h(RouteEffects),
            h('main', { id: 'main', tabIndex: -1 }, h(Routes, null, h(Route, { path: '/', element: h(Link, { to: '/rangliste' }, 'weiter') }), h(Route, { path: '/rangliste', element: h('p', null, 'Rangliste') }))),
          ),
        ),
      )),
    );
    const main = container.querySelector('main')!;
    expect(doc.activeElement).not.toBe(main);
    await act(async () => container.querySelector('a')!.click());
    expect(container.textContent).toContain('Rangliste');
    expect(doc.activeElement).toBe(main);
    await act(async () => root.unmount());
  });
});
