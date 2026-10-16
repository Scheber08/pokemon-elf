/** Trainerkarte: Begleiter mit Namen, gesammelte Shop-Artikel. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { TrainerEditor } = await import('../src/components/TrainerEditor');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { DEFAULT_LOOK } = await import('../src/lib/trainer');
const { act, createElement: h } = React;

afterEach(() => vi.unstubAllGlobals());

const me = (companion: string, owned: string[] = []) => ({
  player: 'Ash',
  coins: { earned: 0, spent: 0, balance: 0 },
  achievements: [],
  trainer: { ...DEFAULT_LOOK, companion },
  owned,
});

describe('Trainerkarte', () => {
  it('nennt den Begleiter, ohne Begleiter keine Zeile', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('pokemon.json') ? ALL : []), { status: 200 })));
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const view = (c: string) => h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, h(TrainerEditor, { key: c, me: me(c), onMe: () => {} } as never))));
    await act(async () => root.render(view('25')));
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(container.querySelector('.trainer-card__pet')!.textContent).toBe('mit Pikachu');
    await act(async () => root.render(view('none')));
    expect(container.querySelector('.trainer-card__pet')).toBeNull();
    await act(async () => root.unmount());
  });

  it('nennt die gesammelten Shop-Artikel (ohne Käufe keine Zeile)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('pokemon.json') ? ALL : []), { status: 200 })));
    const { TRAINER_ITEMS } = await import('../src/lib/trainer');
    const paid = TRAINER_ITEMS.filter((i) => i.price > 0).slice(0, 3).map((i) => `${i.slot}:${i.id}`);
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const view = (owned: string[]) => h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, h(TrainerEditor, { key: owned.length, me: me('none', owned), onMe: () => {} } as never))));
    await act(async () => root.render(view([])));
    expect(container.querySelector('.trainer-card__items')).toBeNull();
    // Doppelte und unbekannte Schlüssel zählen nicht (wie im Shop-Sammelstand)
    await act(async () => root.render(view([...paid, paid[0], 'hat:gibtsnicht'])));
    expect(container.querySelector('.trainer-card__items')!.textContent).toBe('🛍️ 3 Artikel gesammelt');
    await act(async () => root.unmount());
  });
});
