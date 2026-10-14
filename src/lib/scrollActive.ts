import { useEffect, type DependencyList, type RefObject } from 'react';

/**
 * Horizontal scrollende Reiterleisten (Handy): den aktiven Reiter (.is-active) ins Bild holen,
 * ohne die Seite vertikal zu verschieben. Scrollt den nächsten waagerecht scrollbaren Vorfahren.
 */
export function useScrollActiveIntoView(ref: RefObject<HTMLElement | null>, deps: DependencyList): void {
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('.is-active');
    if (!active || typeof getComputedStyle !== 'function') return;
    let box: HTMLElement | null = active.parentElement;
    while (box && box !== ref.current?.parentElement) {
      const o = getComputedStyle(box).overflowX;
      if ((o === 'auto' || o === 'scroll') && box.scrollWidth > box.clientWidth) break;
      box = box.parentElement;
    }
    if (!box || box === ref.current?.parentElement || typeof box.getBoundingClientRect !== 'function') return;
    const b = box.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (a.left >= b.left && a.right <= b.right) return;
    box.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
