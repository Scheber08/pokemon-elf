/** Suchleiste: ↓ springt ins Pokémon-Raster darunter (Draft-Pool, Lobby) – wie im Auswahl-Dialog. */
import { describe, expect, it } from 'vitest';
import { installMiniDom, MiniEvent } from './miniDom';

const doc = installMiniDom();
// Texteingaben: React nimmt Eingabe-Ereignisse nur, wenn das DOM sie kennt
(doc as unknown as Record<string, unknown>).oninput = null;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { FilterBar } = await import('../src/components/FilterBar');
const { SettingsProvider } = await import('../src/state/Settings');
const { act, createElement: h } = React;

describe('FilterBar: ↓ ins Raster', () => {
  it('fokussiert die erste Karte des Rasters im selben Bereich', async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const filters = { query: '', type: null, region: 0 as const };
    await act(async () =>
      root.render(
        h(
          SettingsProvider,
          null,
          h('section', null, h(FilterBar, { filters, onChange: () => {} }), h('div', { className: 'pgrid' }, h('button', { 'data-grid-item': '', id: 'first' }, 'A'), h('button', { 'data-grid-item': '' }, 'B'))),
        ),
      ),
    );
    const input = container.querySelector('input')!;
    const press = (key: string) =>
      act(async () => {
        const ev = Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key });
        input.dispatchEvent(ev);
      });
    await press('ArrowUp');
    expect(doc.activeElement?.getAttribute('id')).not.toBe('first');
    await press('ArrowDown');
    expect(doc.activeElement?.getAttribute('id')).toBe('first');
    await act(async () => root.unmount());
  });
});
