/** Trikot & Torjubel: Vorschläge für den Torjubel übernehmen den Spruch sofort. */
import { describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { KitPicker } = await import('../src/components/KitPicker');
const { act, createElement: h } = React;

describe('Torjubel-Vorschläge', () => {
  it('Klick übernimmt den Spruch, der gewählte ist markiert; ohne onCheer keine Vorschläge', async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const got: string[] = [];
    await act(async () => root.render(h(KitPicker, { kit: null, onChange: () => {}, cheer: '', onCheer: (c: string) => void got.push(c) })));
    const ideas = container.querySelectorAll('.kit-picker__idea');
    expect(ideas.map((b) => b.textContent)).toEqual(['Auf geht’s!', 'Wir sind die Elf!', 'Pika-Pika-Tor!', 'Volltreffer!', 'Was für ein Ding!']);
    await act(async () => ideas[1].click());
    expect(got).toEqual(['Wir sind die Elf!']);
    await act(async () => root.render(h(KitPicker, { kit: null, onChange: () => {}, cheer: 'Wir sind die Elf!', onCheer: (c: string) => void got.push(c) })));
    expect(container.querySelectorAll('.kit-picker__idea').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false', 'false']);
    await act(async () => root.render(h(KitPicker, { kit: null, onChange: () => {} })));
    expect(container.querySelectorAll('.kit-picker__idea')).toHaveLength(0);
    await act(async () => root.unmount());
  });
});
