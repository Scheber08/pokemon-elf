/** Scroll-Verhalten folgt „Bewegung reduzieren“. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollBehavior } from '../src/lib/motion';

afterEach(() => vi.unstubAllGlobals());

describe('scrollBehavior', () => {
  it('weich, außer bei reduzierter Bewegung', () => {
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: false, media: q }) });
    expect(scrollBehavior()).toBe('smooth');
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)', media: q }) });
    expect(scrollBehavior()).toBe('auto');
  });

  it('ohne matchMedia (alte Browser, Tests): weich', () => {
    vi.stubGlobal('window', {});
    expect(scrollBehavior()).toBe('smooth');
  });
});
