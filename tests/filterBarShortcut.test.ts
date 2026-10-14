/** Tastenkürzel „/" der Filterleiste: springt ins Suchfeld – nicht beim Tippen und nicht über Dialogen. */
import { afterEach, describe, expect, it } from 'vitest';
import { installMiniDom, MiniEvent, type MiniElement } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { FilterBar } = await import('../src/components/FilterBar');
const { act, createElement: h } = React;

function keydown(target: MiniElement | null, key: string) {
  const ev = Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key, ctrlKey: false, metaKey: false, altKey: false });
  if (target) target.dispatchEvent(ev);
  else window.dispatchEvent(ev as unknown as Event);
  return ev;
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  doc.activeElement = null;
});

function render(slashFocus: boolean, extra?: ReturnType<typeof h>) {
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  act(() =>
    root.render(
      h(
        'div',
        null,
        h(FilterBar, { filters: { query: '', type: null, region: 0 }, onChange: () => {}, slashFocus }),
        h('input', { id: 'other' }),
        extra,
      ),
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    doc.body.removeChild(host);
  };
  return host;
}

describe('FilterBar: Tastenkürzel /', () => {
  it('fokussiert das Suchfeld', () => {
    const host = render(true);
    const ev = keydown(null, '/');
    expect(doc.activeElement).toBe(host.querySelector('input[id="pokemon-search"]'));
    expect(ev.defaultPrevented).toBe(true);
    expect(host.querySelector('input[id="pokemon-search"]')!.getAttribute('aria-keyshortcuts')).toBe('/');
  });

  it('nicht, während man in einem anderen Feld tippt', () => {
    const host = render(true);
    const other = host.querySelector('input[id="other"]')!;
    other.focus();
    const ev = keydown(other, '/');
    expect(doc.activeElement).toBe(other);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('nicht, wenn ein Dialog offen ist oder das Kürzel aus ist', () => {
    render(true, h('div', { role: 'dialog', 'aria-modal': 'true' }));
    keydown(null, '/');
    expect(doc.activeElement).toBe(null);
    cleanup!();
    cleanup = null;
    const host = render(false);
    keydown(null, '/');
    expect(doc.activeElement).toBe(null);
    expect(host.querySelector('input[id="pokemon-search"]')!.getAttribute('aria-keyshortcuts')).toBe(null);
  });
});
