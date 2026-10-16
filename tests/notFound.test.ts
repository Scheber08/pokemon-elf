/** 404-Seite „Abseits!“: zurück zum Builder oder direkt in einen Modus. */
import { describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { NotFound } = await import('../src/pages/InfoPages');
const { act, createElement: h } = React;

describe('404', () => {
  it('verlinkt Builder und die Hauptmodi', async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(MemoryRouter, null, h(NotFound))));
    const links = container.querySelectorAll('a').map((a) => [a.getAttribute('href'), a.textContent]);
    expect(links).toEqual([
      ['/', 'Zurück zum Builder'],
      ['/taeglich', 'Tägliche Elf'],
      ['/challenge', '34–0 Challenge'],
      ['/draft', 'Fantasy-Draft'],
      ['/rangliste', 'Rangliste'],
    ]);
    await act(async () => root.unmount());
  });
});
