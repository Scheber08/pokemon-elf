/** Spielbericht: laufender Spielstand nach jedem Tor (nur, wenn alle Tore eine Minute haben) und 🏆 Siegtor. */
import { afterEach, describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
localStorage.setItem('pokemon-elf:settings', JSON.stringify({ replay: 'report' }));
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MatchReport } = await import('../src/components/MatchReport');
const { SettingsProvider } = await import('../src/state/Settings');
const { act, createElement: h } = React;

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function render(match: unknown) {
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  root = createRoot(host as never);
  act(() => {
    root!.render(
      h(SettingsProvider, null, h(MatchReport, { match: match as never, nameOf: (n: number) => `T${n}`, pokemonName: (id: number) => `P${id}`, onClose: () => {} })),
    );
  });
  return doc.body;
}

describe('Spielbericht: laufender Spielstand', () => {
  it('zeigt nach jedem Tor den Stand in zeitlicher Reihenfolge', () => {
    const body = render({
      round: 1, home: 0, away: 1, hg: 2, ag: 1,
      homeScorers: [{ pokemonId: 1, minute: 70 }, { pokemonId: 4, minute: 10 }],
      awayScorers: [{ pokemonId: 7, minute: 40 }],
    });
    const stands = body.querySelectorAll('.match-report__running').map((el) => el.textContent);
    expect(stands).toEqual(['1:0Spielstand 1:0', '1:1Spielstand 1:1', '2:1Spielstand 2:1']);
    // Siegtor: das 2:1 in der 70. Minute
    const winners = body.querySelectorAll('.match-report__winner');
    expect(winners.length).toBe(1);
    expect(winners[0].parentNode!.parentNode!.textContent).toContain('70');
  });

  it('Siegtor beim Auswärtssieg zu null: das erste Tor; bei Remis keins', () => {
    let body = render({
      round: 1, home: 0, away: 1, hg: 0, ag: 2,
      homeScorers: [],
      awayScorers: [{ pokemonId: 7, minute: 80 }, { pokemonId: 9, minute: 20 }],
    });
    let winners = body.querySelectorAll('.match-report__winner');
    expect(winners.length).toBe(1);
    expect(winners[0].parentNode!.parentNode!.textContent).toContain('20');
    act(() => root?.unmount());
    body.childNodes.slice().forEach((n) => body.removeChild(n));
    body = render({ round: 1, home: 0, away: 1, hg: 1, ag: 1, homeScorers: [{ pokemonId: 1, minute: 5 }], awayScorers: [{ pokemonId: 7, minute: 9 }] });
    winners = body.querySelectorAll('.match-report__winner');
    expect(winners.length).toBe(0);
  });

  it('ohne Minuten (Vereinstore) kein laufender Stand', () => {
    const body = render({ round: 1, home: 0, away: 1, hg: 2, ag: 0, homeScorers: [{ pokemonId: 1, minute: 5 }], awayScorers: [] });
    expect(body.querySelectorAll('.match-report__running').length).toBe(0);
  });
});
