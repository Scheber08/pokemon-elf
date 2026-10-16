/** Ohne Netz: Hinweis unter dem Kopf, der auf online/offline-Ereignisse reagiert (Live-Region bleibt stehen). */
import { describe, expect, it } from 'vitest';
import { installMiniDom, MiniEvent } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { OfflineBanner } = await import('../src/components/OfflineBanner');
const { act, createElement: h } = React;

const setOnline = (v: boolean) => Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => v });
const fire = (type: string) =>
  act(async () => {
    (globalThis.window as unknown as { dispatchEvent(e: unknown): void }).dispatchEvent(new MiniEvent(type));
  });

describe('OfflineBanner', () => {
  it('zeigt den Hinweis nur offline und folgt den Ereignissen', async () => {
    setOnline(true);
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as never);
    await act(async () => root.render(h(OfflineBanner)));
    const region = container.querySelector('[role="status"]')!;
    expect(region).not.toBeNull();
    expect(container.querySelector('.offline-banner')).toBeNull();
    setOnline(false);
    await fire('offline');
    expect(container.querySelector('.offline-banner')!.textContent).toContain('📡 Offline – Builder, Challenges und lokaler Draft laufen weiter.');
    setOnline(true);
    await fire('online');
    expect(container.querySelector('.offline-banner')).toBeNull();
    await act(async () => root.unmount());
  });
});
