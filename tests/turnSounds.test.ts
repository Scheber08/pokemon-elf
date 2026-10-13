/**
 * Signaltöne im Online-Draft (wann der Gong kommt) und die Kurzfassung „Zählt hier" im
 * Auswahl-Dialog.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PositionKeys } from '../src/components/StatTooltip';
import { POSITIONS, PROFILES } from '../src/config/positions';
import { setCurrentLang } from '../src/i18n/lang';
import { TURN_CHIME_START, turnChimeDue, type TurnChimeMemo, type TurnObservation } from '../src/state/useTurnSounds';

/** Folge von Beobachtungen durchspielen – liefert, bei welchen gegongt wurde. */
function run(observations: Partial<TurnObservation>[]): boolean[] {
  let memo: TurnChimeMemo = TURN_CHIME_START;
  return observations.map((o) => {
    const res = turnChimeDue(memo, { live: true, myTurn: false, pickIndex: 0, ownManualLast: false, ...o });
    memo = res.memo;
    return res.chime;
  });
}

describe('Gong „Du bist dran"', () => {
  it('kommt, wenn man an die Reihe kommt – einmal pro Zug', () => {
    expect(
      run([
        { pickIndex: 0 }, // Lobby/anderer dran
        { pickIndex: 1, myTurn: true },
        { pickIndex: 1, myTurn: true }, // derselbe Zug, neuer Schnappschuss (z. B. online/offline)
        { pickIndex: 2 },
        { pickIndex: 5, myTurn: true },
      ]),
    ).toEqual([false, true, false, false, true]);
  });

  it('nicht beim Laden der Seite, wenn man schon dran ist', () => {
    expect(run([{ pickIndex: 3, myTurn: true }, { pickIndex: 3, myTurn: true }])).toEqual([false, false]);
  });

  it('nicht direkt nach dem eigenen Pick (Snake: zweimal hintereinander) – aber nach einem Auto-Pick', () => {
    expect(
      run([
        { pickIndex: 2 },
        { pickIndex: 3, myTurn: true },
        { pickIndex: 4, myTurn: true, ownManualLast: true },
      ]),
    ).toEqual([false, true, false]);
    expect(
      run([
        { pickIndex: 2 },
        { pickIndex: 3, myTurn: true },
        { pickIndex: 4, myTurn: true, ownManualLast: false }, // der Timer hat für mich gewählt
      ]),
    ).toEqual([false, true, true]);
  });

  it('ohne eigenen Live-Stand (Vorschau) passiert nichts – der erste Live-Stand zählt als Start', () => {
    expect(
      run([
        { live: false, pickIndex: 1, myTurn: true },
        { live: true, pickIndex: 1, myTurn: true },
        { live: true, pickIndex: 2 },
        { live: true, pickIndex: 3, myTurn: true },
      ]),
    ).toEqual([false, false, false, true]);
  });
});

describe('„Zählt hier" im Auswahl-Dialog', () => {
  it('listet die Werte der Position, wichtigste zuerst, ohne „Zählt nicht"', () => {
    setCurrentLang('de');
    const html = renderToStaticMarkup(createElement(PositionKeys, { pos: 'ST' }));
    expect(html).toContain('Zählt hier:');
    const weights = PROFILES[POSITIONS.ST.profile].weights;
    const levels = [...html.matchAll(/pos-keys__factor lvl--(\d)/g)].map((m) => Number(m[1]));
    expect(levels.length).toBe(Object.values(weights).filter((w) => w > 0).length);
    expect([...levels].sort((a, b) => b - a)).toEqual(levels);
    expect(levels).not.toContain(0);
  });

  it('auf Englisch', () => {
    setCurrentLang('en');
    try {
      const html = renderToStaticMarkup(createElement(PositionKeys, { pos: 'TW' }));
      expect(html).toContain('What counts here:');
      expect(html).not.toMatch(/Zählt|Schlüssel|Hilft/);
    } finally {
      setCurrentLang('de');
    }
  });
});
