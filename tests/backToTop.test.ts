/** „↑ Nach oben“: erst nach längerem Scrollen, Klick scrollt nach oben. */
import { describe, expect, it, vi } from 'vitest';
import { installMiniDom, MiniEvent } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { BackToTop, BACK_TO_TOP_AFTER } = await import('../src/components/BackToTop');
const { act, createElement: h } = React;

describe('Nach oben', () => {
  it('erscheint nach dem Scrollen und scrollt nach oben', async () => {
    const w = window as unknown as { scrollY: number; scrollTo: (o: unknown) => void };
    w.scrollY = 0;
    const scrollTo = vi.fn();
    w.scrollTo = scrollTo;
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(BackToTop)));
    expect(container.querySelector('.back-to-top')).toBeNull();
    w.scrollY = BACK_TO_TOP_AFTER + 1;
    await act(async () => void window.dispatchEvent(new MiniEvent('scroll') as unknown as Event));
    const btn = container.querySelector('.back-to-top')!;
    expect(btn.getAttribute('aria-label')).toBe('Nach oben');
    await act(async () => btn.click());
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    w.scrollY = 0;
    await act(async () => void window.dispatchEvent(new MiniEvent('scroll') as unknown as Event));
    expect(container.querySelector('.back-to-top')).toBeNull();
    await act(async () => root.unmount());
  });
});
