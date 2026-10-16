/** Breite Tabellen: tabindex="0" nur, solange .table-scroll seitlich überläuft. */
import { describe, expect, it } from 'vitest';
import { installMiniDom, type MiniElement } from './miniDom';
import { syncScrollFocus } from '../src/lib/scrollFocus';

const doc = installMiniDom();

function box(scrollWidth: number, clientWidth: number) {
  const el = doc.createElement('div') as MiniElement & { scrollWidth: number; clientWidth: number };
  el.setAttribute('class', 'table-scroll');
  el.scrollWidth = scrollWidth;
  el.clientWidth = clientWidth;
  return el;
}

describe('syncScrollFocus', () => {
  it('setzt den Tab-Stopp bei Überlauf und nimmt ihn ohne wieder weg', () => {
    const el = box(600, 320);
    syncScrollFocus(el as never);
    expect(el.getAttribute('tabindex')).toBe('0');
    el.scrollWidth = 320;
    syncScrollFocus(el as never);
    expect(el.getAttribute('tabindex')).toBeNull();
  });

  it('ignoriert Rundungsreste (1 px)', () => {
    const el = box(321, 320);
    syncScrollFocus(el as never);
    expect(el.getAttribute('tabindex')).toBeNull();
  });

  it('fasst einen fremden tabindex nicht an', () => {
    const el = box(320, 320);
    el.setAttribute('tabindex', '-1');
    syncScrollFocus(el as never);
    expect(el.getAttribute('tabindex')).toBe('-1');
  });
});
