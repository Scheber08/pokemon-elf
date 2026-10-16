/** Fokus retten: nur nach einer echten Eingabe kurz zuvor, nie beim bloßen Laden. */
import { describe, expect, it, vi } from 'vitest';
import { installMiniDom, MiniEvent } from './miniDom';

const doc = installMiniDom();
const { rescueFocus } = await import('../src/lib/focusRescue');

const el = () => {
  const e = doc.createElement('div');
  e.setAttribute('tabindex', '-1');
  doc.body.appendChild(e);
  return e as unknown as HTMLElement;
};

describe('rescueFocus', () => {
  it('ohne vorherige Eingabe (Seite lädt): nichts', async () => {
    // Frisch geladenes Modul: keine Eingabe gemerkt – unabhängig von der Reihenfolge der Tests
    vi.resetModules();
    const fresh = await import('../src/lib/focusRescue');
    doc.activeElement = null;
    const target = el();
    expect(fresh.rescueFocus(target)).toBe(false);
    expect(doc.activeElement).toBeNull();
  });

  it('nach Taste/Klick und verlorenem Fokus: fokussiert – nicht mehr nach 3 s', () => {
    window.dispatchEvent(new MiniEvent('keydown', { bubbles: true }) as unknown as Event);
    doc.activeElement = null;
    const target = el();
    expect(rescueFocus(target, Date.now() + 5000)).toBe(false);
    expect(rescueFocus(target)).toBe(true);
    expect(doc.activeElement).toBe(target);
  });

  it('Fokus noch auf einem eingehängten Element: bleibt dort', () => {
    window.dispatchEvent(new MiniEvent('pointerdown', { bubbles: true }) as unknown as Event);
    const keep = el();
    (keep as unknown as { focus: () => void }).focus();
    expect(rescueFocus(el())).toBe(false);
    expect(doc.activeElement).toBe(keep);
  });
});
