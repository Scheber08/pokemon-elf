import { describe, expect, it } from 'vitest';
import { createClickGuard } from '../src/lib/clickGuard';

describe('createClickGuard (Doppelklick-Schutz der Reroll-Knöpfe)', () => {
  it('nimmt den ersten Klick an und ignoriert einen Doppelklick', () => {
    let t = 1000;
    const accept = createClickGuard(400, () => t);
    expect(accept()).toBe(true);
    t += 80; // zweiter Klick eines Doppelklicks – unabhängig von Render/Animation
    expect(accept()).toBe(false);
    t += 200;
    expect(accept()).toBe(false);
  });

  it('nach Ablauf der Sperre zählt der nächste Klick wieder', () => {
    let t = 0;
    const accept = createClickGuard(400, () => t);
    expect(accept()).toBe(true);
    t = 399;
    expect(accept()).toBe(false);
    t = 400;
    expect(accept()).toBe(true);
    // Ignorierte Klicks verlängern die Sperre nicht
    t = 700;
    expect(accept()).toBe(false);
    t = 800;
    expect(accept()).toBe(true);
  });

  it('der allererste Klick zählt auch bei Uhrzeit 0', () => {
    expect(createClickGuard(400, () => 0)()).toBe(true);
  });

  it('jede Sperre ist eigenständig', () => {
    const t = 0;
    const a = createClickGuard(400, () => t);
    const b = createClickGuard(400, () => t);
    expect(a()).toBe(true);
    expect(b()).toBe(true);
  });
});
