/** Breite Tabellen und Draft-Board: tabindex="0" nur, solange der Container seitlich überläuft. */
import { describe, expect, it, vi } from 'vitest';
import { installMiniDom, type MiniElement } from './miniDom';
import { installScrollFocus, syncScrollFocus } from '../src/lib/scrollFocus';

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

describe('installScrollFocus', () => {
  it('erfasst Tabellen und das Draft-Board (online und lokal)', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
    const root = doc.createElement('div');
    const table = box(600, 320);
    const board = box(900, 320);
    board.setAttribute('class', 'draft__board');
    const narrow = box(300, 320);
    root.appendChild(table);
    root.appendChild(board);
    root.appendChild(narrow);
    const stop = installScrollFocus(root as never);
    expect([table, board, narrow].map((el) => el.getAttribute('tabindex'))).toEqual(['0', '0', null]);
    stop();
    vi.unstubAllGlobals();
  });
});
