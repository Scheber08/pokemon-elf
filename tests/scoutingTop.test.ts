/** Scouting-Guide: „🏅 Top 3 je Position“ aus den echten Pokémon-Daten. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom, MiniEvent } from './miniDom';

const doc = installMiniDom();
// Texteingaben: React nimmt das input-Ereignis nur, wenn das DOM es kennt („oninput" in document)
(doc as unknown as Record<string, unknown>).oninput = null;
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

  it('🔍 Wo spielt …?: Suche nach Name (deutsch/englisch), fünf beste Positionen absteigend', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('pokemon.json') ? ALL : []), { status: 200 })));
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, h(Scouting))))));
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    const input = container.querySelector('.scouting__where-input') as unknown as { type: string; value: string; dispatchEvent: (e: unknown) => void };
    const type = async (v: string) =>
      act(async () => {
        input.type = 'text';
        input.value = v;
        input.dispatchEvent(new MiniEvent('input', { bubbles: true }));
      });
    await type('charizard');
    expect(container.querySelector('.scouting__where-name strong')!.textContent).toBe('Glurak');
    // Typen neben dem Namen
    expect(container.querySelector('.scouting__where-types')!.textContent).toBe('FeuerFlug');
    const fits = container.querySelectorAll('.scouting__where .scouting__top-fit').map((f) => Number(f.textContent));
    expect(fits).toHaveLength(5);
    expect([...fits].sort((a, b) => b - a)).toEqual(fits);
    const glurak = ALL.find((p) => p.id === 6)!;
    const scale = buildScale(ALL, 'all');
    const keys = PROFILE_GROUPS.flatMap((g) => g.profiles);
    expect(fits[0]).toBe(Math.round(Math.max(...keys.map((k) => profileFit(glurak, k, scale)))));
    // Rang auf der besten Position unter allen Pokémon
    const bestKey = [...keys].sort((x, y) => profileFit(glurak, y, scale) - profileFit(glurak, x, scale))[0];
    const rank = ALL.filter((p) => profileFit(p, bestKey, scale) > profileFit(glurak, bestKey, scale)).length + 1;
    const { messages } = await import('../src/i18n');
    expect(container.querySelector('.scouting__where-rank')!.textContent).toBe(`🏅 Nr. ${rank} von ${ALL.length.toLocaleString('de-DE')} als ${messages().game.profileTitle[bestKey]}`);
    // Name steht daneben: Sprite ohne Alt-Text
    expect(container.querySelector('.scouting__where-name img')!.getAttribute('alt')).toBe('');
    // Tipp auf ein Pokémon in „Top 3 je Position“ füllt die Suche
    const pick = container.querySelector('.scouting__top-pick')!;
    await act(async () => pick.click());
    expect(container.querySelector('.scouting__where-name strong')!.textContent).toBe(pick.textContent);
    expect(pick.getAttribute('title')).toBe(`Wo spielt ${pick.textContent} sonst noch?`);
    // 🎲 Zufällig trägt ein Pokémon ein (hier das letzte der Liste)
    vi.spyOn(Math, 'random').mockReturnValue(0.9999999);
    await act(async () => container.querySelector('.scouting__where-random')!.click());
    vi.restoreAllMocks();
    expect(container.querySelector('.scouting__where-name strong')!.textContent).toBe(messages().game.pokemon(ALL[ALL.length - 1]));
    expect(input.value).toBe(messages().game.pokemon(ALL[ALL.length - 1]));
    await type('xyzxyz');
    expect(container.querySelector('.scouting__where-hit')).toBeNull();
    expect(container.querySelector('.scouting__where')!.textContent).toContain('Kein Pokémon gefunden.');
    await act(async () => root.unmount());
  });
});
