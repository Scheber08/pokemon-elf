/** Über-Seite: alle Tastenkürzel an einer Stelle (Texte aus den Modi, ohne „⌨️ Tastenkürzel:“). */
import { describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { About, keysText } = await import('../src/pages/InfoPages');
const { messages } = await import('../src/i18n');
const { act, createElement: h } = React;

describe('Über: Tastenkürzel', () => {
  it('keysText entfernt den Vorspann in beiden Sprachen', () => {
    for (const lang of ['de', 'en'] as const) {
      const t = messages(lang);
      for (const s of [t.builder.keysHint, t.online.shortcuts, t.draft.local.shortcuts, t.draft.replay.keysHint]) {
        const out = keysText(s);
        expect(out).not.toMatch(/^(⌨️|Tastenkürzel|Shortcuts)/u);
        expect(out.length).toBeGreaterThan(10);
      }
    }
    expect(keysText(messages('de').online.shortcuts)).toMatch(/^\/ Suche · W Wunschliste/);
  });

  it('Abschnitt mit vier Modi', async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(MemoryRouter, null, h(About))));
    const items = container.querySelectorAll('.about__keys li').map((li) => li.textContent);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatch(/^Builder: Strg\/Cmd\+Z rückgängig/);
    expect(items[3]).toMatch(/^Spielwiedergabe: Leertaste/);
    await act(async () => root.unmount());
  });
});
