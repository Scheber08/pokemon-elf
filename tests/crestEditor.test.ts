/** Wappen-Editor: „⇄ Farben tauschen“. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { CrestEditor } = await import('../src/components/CrestEditor');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { act, createElement: h } = React;

afterEach(() => vi.unstubAllGlobals());

describe('Wappen-Editor', () => {
  it('tauscht Grund- und Zweitfarbe; bei gleichen Farben kein Knopf', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('pokemon.json') ? ALL : []), { status: 200 })));
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const got: unknown[] = [];
    const crest = { shape: 'round', pattern: 'halves', primary: 'red', secondary: 'white', symbol: 'star' } as const;
    const swapBtn = () => container.querySelectorAll('button').find((b) => b.textContent === '⇄ Farben tauschen');
    await act(async () => root.render(h(PokemonDataProvider, null, h(CrestEditor, { crest, onChange: (c: unknown) => void got.push(c) }))));
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => swapBtn()!.click());
    expect(got).toEqual([{ ...crest, primary: 'white', secondary: 'red' }]);
    await act(async () => root.render(h(PokemonDataProvider, null, h(CrestEditor, { crest: { ...crest, secondary: 'red' }, onChange: () => {} }))));
    expect(swapBtn()).toBeUndefined();
    await act(async () => root.unmount());
  });
});
