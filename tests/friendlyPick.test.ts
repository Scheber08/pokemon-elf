/** Testspiel: Auswahl der eigenen Elf – aktuelle Builder-Elf oder eine aus „Meine Teams". */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom, MiniElement, MiniEvent } from './miniDom';

const doc = installMiniDom();
// <select>: React liest select.options – im Mini-DOM nachgerüstet (wie in i18n_draft.test.ts)
Object.defineProperty(MiniElement.prototype, 'options', {
  configurable: true,
  get(this: MiniElement) {
    if (this.localName !== 'select') return undefined;
    return this.querySelectorAll('option').map((o) => {
      if (o.value == null) o.value = o.getAttribute('value') ?? o.textContent;
      return o;
    });
  },
});
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { FriendlyMatch } = await import('../src/components/FriendlyMatch');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider } = await import('../src/state/Settings');
const { act, createElement: h } = React;

const eleven = (start: number) => ALL.slice(start, start + 11).map((p) => p.id);

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Testspiel mit gespeicherter Elf', () => {
  it('Auswahl zeigt aktuelle und gespeicherte Elfen; Wechsel spielt mit der gewählten', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('pokemon.json') ? ALL : []), { status: 200 })),
    );
    localStorage.setItem('pokemon-elf:settings', JSON.stringify({ lang: 'de' }));
    localStorage.setItem('pokemon-elf:lineup', JSON.stringify({ formation: '4-3-3', slots: eleven(0), teamName: 'Builder-Elf' }));
    localStorage.setItem(
      'pokemon-elf:saved-teams',
      JSON.stringify([
        { id: '1', name: 'Gespeichert', formation: '4-4-2', at: 1, state: { formation: '4-4-2', slots: eleven(100), teamName: 'Gespeichert' } },
        { id: '2', name: 'Halb', formation: '4-3-3', at: 2, state: { formation: '4-3-3', slots: [1, 2, 3], teamName: 'Halb' } },
      ]),
    );
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const opponent = { name: 'Gegner', formation: '4-3-3' as const, slots: eleven(200), ss: null };
    await act(async () =>
      root.render(h(MemoryRouter, null, h(SettingsProvider, null, h(PokemonDataProvider, null, h(FriendlyMatch, { opponent }))))),
    );
    for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    const select = container.querySelector('select') as MiniElement;
    const options = select.querySelectorAll('option').map((o) => o.textContent);
    // Die unvollständige Elf fehlt
    expect(options).toEqual(['Builder-Elf (aktuelle Elf)', 'Gespeichert']);
    expect(container.querySelector('h3')!.textContent).toContain('Builder-Elf – Gegner');
    // 📈 Prognose bleibt beim Nochmal-Spielen gleich (feste Seeds)
    const odds = () => container.querySelector('.friendly__odds')!.textContent!;
    expect(odds()).toMatch(/^📈 Prognose aus 100 Testspielen: \d+ % Sieg · \d+ % Remis · \d+ % Niederlage$/);
    const before = odds();
    // Torschützen beider Seiten: Gegner-Zeile genau dann, wenn der Gegner im Spiel getroffen hat
    for (const li of container.querySelectorAll('.friendly__legs li')) {
      const m = li.textContent!.match(/(?:Builder-Elf (\d+):(\d+) Gegner|Gegner (\d+):(\d+) Builder-Elf)/)!;
      const oppGoals = Number(m[2] ?? m[3]);
      const opp = li.querySelector('.friendly__scorers--opp');
      expect(!!opp).toBe(oppGoals > 0);
      if (opp) expect(opp.textContent).toMatch(/^ · Gegner: .+/);
      // Eigene Torschützen genauso unter dem Teamnamen
      const ownGoals = Number(m[1] ?? m[4]);
      const own = li.querySelectorAll('.friendly__scorers').find((x) => !x.className.includes('--opp'));
      expect(!!own).toBe(ownGoals > 0);
      if (own) expect(own.textContent).toMatch(/^ · Builder-Elf: .+/);
    }
    // Bilanz erst ab dem zweiten Testspiel; „Nochmal spielen" zählt weiter
    const tally = () => container.querySelector('.friendly__tally')?.textContent ?? null;
    expect(tally()).toBeNull();
    const again = () => container.querySelectorAll('button').find((b) => b.textContent === 'Nochmal spielen')!;
    await act(async () => again().dispatchEvent(new MiniEvent('click', { bubbles: true })));
    await act(async () => again().dispatchEvent(new MiniEvent('click', { bubbles: true })));
    const m = tally()!.match(/Bilanz aus 3 Testspielen: (\d+) S · (\d+) U · (\d+) N/)!;
    expect(m).not.toBeNull();
    expect(Number(m[1]) + Number(m[2]) + Number(m[3])).toBe(3);
    expect(odds()).toBe(before);
    await act(async () => {
      select.value = '1';
      select.dispatchEvent(new MiniEvent('change', { bubbles: true }));
    });
    expect(container.querySelector('h3')!.textContent).toContain('Gespeichert – Gegner');
    // Andere Elf: Bilanz beginnt neu
    expect(tally()).toBeNull();
    await act(async () => root.unmount());
  });
});
