/** Fußzeile: „Stand: <Tag des Builds>“ – __BUILD_DAY__ kommt aus vite.config.ts (define, auch in Vitest gesetzt). */
import { describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { Footer } = await import('../src/components/Layout');
const { messages } = await import('../src/i18n');
const { act, createElement: h } = React;

describe('Fußzeile', () => {
  it('nennt den Stand der Version als Datum', async () => {
    expect(__BUILD_DAY__).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as never);
    await act(async () => root.render(h(MemoryRouter, null, h(Footer))));
    const t = messages('de');
    expect(container.querySelector('.site-footer__build')!.textContent).toBe(`Stand: ${t.game.day(__BUILD_DAY__)}`);
    await act(async () => root.unmount());
  });
});
