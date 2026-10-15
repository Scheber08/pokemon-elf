/** Tausch-Karte der Manager-Saison: eingehende und eigene Angebote, Angebot senden, Wirkung auf die beste Elf. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DraftTeam, ManagerOffer } from '../src/lib/api/draftContract';
import { ALL } from './helpers';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom();
// <select>: React liest select.options – im Mini-DOM nachgerüstet (wie in draftRender.test.ts)
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
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider } = await import('../src/state/Settings');
const { TradePanel } = await import('../src/components/ManagerMarket');
const { act, createElement: h } = React;

afterEach(() => vi.unstubAllGlobals());

const ids = ALL.slice(0, 40).map((p) => p.id);
const team = (id: string, from: number, name: string): DraftTeam =>
  ({ id, name, formation: '4-3-3', cpu: id.startsWith('c'), slots: ids.slice(from, from + 11), ss: null, bench: ids.slice(from + 11, from + 14) }) as unknown as DraftTeam;
const me = team('h', 0, 'Host-Elf');
const other = team('g', 14, 'Gast-Elf');
const cpu = team('c1', 28, 'CPU-Elf');

async function render(offers: ManagerOffer[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ALL), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  const onOffer = vi.fn();
  const onAnswer = vi.fn();
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () =>
    root.render(
      h(SettingsProvider, null,
        h(PokemonDataProvider, null,
          h(TradePanel, {
            state: { teams: [me, other, cpu] },
            team: me,
            offers,
            done: [],
            error: null,
            nameOf: (id: string) => ({ h: 'Host-Elf', g: 'Gast-Elf', c1: 'CPU-Elf' })[id] ?? '?',
            onOffer,
            onAnswer,
            goalsOf: (id: string) => new Map(id === 'h' ? [[ids[0], 4]] : id === 'g' ? [[ids[14], 1]] : []),
          }),
        ),
      ),
    ),
  );
  for (let i = 0; i < 10 && !container.querySelector('.manager__trade'); i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return { container, onOffer, onAnswer, unmount: () => act(async () => root.unmount()) };
}

const buttons = (el: MiniElement) => el.querySelectorAll('button') as unknown as { textContent: string; click(): void }[];

describe('Tausch-Karte', () => {
  it('eingehendes Angebot annehmen/ablehnen, eigenes zurückziehen – mit Wirkung auf die beste Elf', async () => {
    const offers: ManagerOffer[] = [
      { id: 1, from: 'g', to: 'h', give: ids[14], get: ids[0] },
      { id: 2, from: 'h', to: 'g', give: ids[1], get: ids[15] },
    ];
    const { container, onAnswer, unmount } = await render(offers);
    const text = container.textContent;
    expect(text).toContain('Gast-Elf bietet');
    expect(text).toContain('Dein Angebot an Gast-Elf');
    // Saisontore in den Auswahlen (eigene und die des Partners)
    const opts = container.querySelectorAll('.manager__trade option').map((o) => o.textContent);
    expect(opts.some((o) => o.endsWith(', 4 Tore)'))).toBe(true);
    expect(opts.some((o) => o.endsWith(', 1 Tor)'))).toBe(true);
    expect(container.querySelectorAll('.manager__effect').length).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/Deine beste Elf: [+−±]\d+,\d/);
    const b = buttons(container);
    await act(async () => b.find((x) => x.textContent === 'Annehmen')!.click());
    await act(async () => b.find((x) => x.textContent === 'Zurückziehen')!.click());
    expect(onAnswer.mock.calls).toEqual([[1, true], [2, false]]);
    await unmount();
  });

  it('Angebot senden: an ein Mitspieler-Team bzw. „Tausch anfragen“ beim CPU-Team', async () => {
    const { container, onOffer, unmount } = await render([]);
    const send = () => buttons(container).find((x) => x.textContent === 'Angebot senden' || x.textContent === 'Tausch anfragen')!;
    expect(send().textContent).toBe('Angebot senden');
    await act(async () => send().click());
    expect(onOffer).toHaveBeenCalledWith('g', ids[0], ids[14]);
    await unmount();
  });
});
