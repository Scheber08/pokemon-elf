/** Datenschutz: wie viel die App auf diesem Gerät gespeichert hat. */
import { afterEach, describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { Privacy } = await import('../src/pages/InfoPages');
const { storageUsage } = await import('../src/lib/storage');
const { act, createElement: h } = React;

afterEach(() => localStorage.clear());

describe('Speicher auf diesem Gerät', () => {
  it('zählt nur eigene Einträge', () => {
    localStorage.setItem('pokemon-elf:a', 'x'.repeat(100));
    localStorage.setItem('pokemon-elf:b', '1');
    localStorage.setItem('fremd', 'x'.repeat(5000));
    expect(storageUsage()).toEqual({ entries: 2, bytes: 'pokemon-elf:a'.length + 100 + 'pokemon-elf:b'.length + 1 });
  });

  it('Datenschutz-Seite nennt Einträge und KB (ohne Einträge keine Zeile)', async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(MemoryRouter, null, h(Privacy))));
    expect(container.querySelector('.privacy__usage')).toBeNull();
    localStorage.setItem('pokemon-elf:big', 'x'.repeat(3000));
    await act(async () => root.render(h(MemoryRouter, { key: 'b' }, h(Privacy))));
    expect(container.querySelector('.privacy__usage')!.textContent).toBe('Auf diesem Gerät gerade: 1 Eintrag, etwa 3 KB.');
    await act(async () => root.unmount());
  });
});
