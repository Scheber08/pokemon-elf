/** Scouting-Guide: „🏅 Top 3 je Position“ aus den echten Pokémon-Daten. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Scouting } = await import('../src/pages/Scouting');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { buildScale, profileFit } = await import('../src/lib/fit');
const { PROFILE_GROUPS } = await import('../src/config/positions');
const { act, createElement: h } = React;

afterEach(() => vi.unstubAllGlobals());

describe('Scouting: Top 3 je Position', () => {
  it('zeigt je Profil die drei bestpassenden Pokémon mit Fit, absteigend, Legendäre per Schalter', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('pokemon.json') ? ALL : []), { status: 200 })));
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, h(Scouting))))));
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    const card = container.querySelector('.scouting__top')!;
    expect(card.querySelector('h2')!.textContent).toBe('🏅 Top 3 je Position');
    const keys = PROFILE_GROUPS.flatMap((g) => g.profiles);
    const rows = card.querySelectorAll('.scouting__top-mons');
    expect(rows).toHaveLength(keys.length);
    const scale = buildScale(ALL, 'all');
    const { compositeScore } = await import('../src/lib/fit');
    const rank = (pool: typeof ALL) =>
      [...pool].sort((a, b) => profileFit(b, keys[0], scale) - profileFit(a, keys[0], scale) || compositeScore(b, keys[0], scale) - compositeScore(a, keys[0], scale) || a.id - b.id);
    const best = rank(ALL.filter((p) => !p.leg && !p.myth))[0];
    expect(rows[0].querySelector('.scouting__top-name')!.textContent).toBe(best.de);
    const first = rows[0].querySelectorAll('li');
    expect(first).toHaveLength(3);
    expect(first[0].querySelector('.scouting__top-fit')!.textContent).toBe(String(Math.round(profileFit(best, keys[0], scale))));
    for (const r of rows) {
      const fits = r.querySelectorAll('.scouting__top-fit').map((f) => Number(f.textContent));
      expect([...fits].sort((a, b) => b - a)).toEqual(fits);
    }
    // ★ Legendäre mitzählen
    const box = card.querySelector('input')!;
    await act(async () => {
      (box as unknown as { checked: boolean }).checked = true;
      box.click();
    });
    const withLeg = rank(ALL)[0];
    expect(container.querySelector('.scouting__top-name')!.textContent).toBe(withLeg.de);
    await act(async () => root.unmount());
  });
});
