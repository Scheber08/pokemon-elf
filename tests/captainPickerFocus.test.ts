/** Kapitänswahl: „Beste Wahl“ wird danach deaktiviert – der Fokus wandert zur Auswahl, nicht an den Seitenanfang. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
// <select>: React liest select.options – im Mini-DOM nachgerüstet (wie in friendlyPick.test.ts)
const { MiniElement } = await import('./miniDom');
Object.defineProperty(MiniElement.prototype, 'options', {
  configurable: true,
  get(this: InstanceType<typeof MiniElement>) {
    if (this.localName !== 'select') return undefined;
    return this.querySelectorAll('option').map((o) => {
      if (o.value == null) o.value = o.getAttribute('value') ?? o.textContent;
      return o;
    });
  },
});
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { CaptainPicker } = await import('../src/components/CaptainPicker');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { act, createElement: h, useState } = React;

afterEach(() => vi.unstubAllGlobals());

function Harness() {
  const [captain, setCaptain] = useState<number | null>(null);
  return h(CaptainPicker, { formation: '4-3-3', slots: [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135], captain, onChange: setCaptain });
}

describe('Kapitänswahl', () => {
  it('„Beste Wahl“: Kapitän gesetzt, Knopf deaktiviert, Fokus auf der Auswahl', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('pokemon.json') ? ALL : []), { status: 200 })));
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(PokemonDataProvider, null, h(Harness))));
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    const best = container.querySelector('.captain-picker__best')!;
    await act(async () => best.click());
    const select = container.querySelector('select')!;
    expect((select as unknown as { value: string }).value).not.toBe('');
    expect(best.hasAttribute('disabled')).toBe(true);
    expect(doc.activeElement).toBe(select);
    await act(async () => root.unmount());
  });
});
