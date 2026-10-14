/** Browser-Benachrichtigung „Du bist dran": nur mit Erlaubnis und nur bei Tab im Hintergrund. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyPermission, requestNotify, showNotify } from '../src/lib/notify';

const shown: { title: string; opts: NotificationOptions }[] = [];

function stub(permission: NotificationPermission, visibility: 'visible' | 'hidden', ask: NotificationPermission = permission) {
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => ask);
    onclick: (() => void) | null = null;
    constructor(title: string, opts: NotificationOptions) {
      shown.push({ title, opts });
    }
    close() {}
  }
  vi.stubGlobal('window', { Notification: FakeNotification, focus: () => {} });
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('document', { visibilityState: visibility });
}

afterEach(() => {
  vi.unstubAllGlobals();
  shown.length = 0;
});

describe('Benachrichtigung', () => {
  it('erscheint nur mit Erlaubnis und nur, wenn der Tab im Hintergrund liegt', () => {
    stub('granted', 'hidden');
    showNotify('Du bist dran', 'Pick 3', 'draft-turn-ABC234');
    expect(shown).toEqual([{ title: 'Du bist dran', opts: expect.objectContaining({ body: 'Pick 3', tag: 'draft-turn-ABC234' }) }]);
    stub('granted', 'visible');
    showNotify('x', 'y', 'z');
    stub('denied', 'hidden');
    showNotify('x', 'y', 'z');
    expect(shown).toHaveLength(1);
  });

  it('Erlaubnis anfragen: blockiert bleibt blockiert, sonst fragt der Browser', async () => {
    stub('denied', 'hidden');
    expect(await requestNotify()).toBe(false);
    stub('default', 'hidden', 'granted');
    expect(await requestNotify()).toBe(true);
    expect(notifyPermission()).toBe('default');
  });

  it('ohne Unterstützung: nichts', async () => {
    vi.stubGlobal('window', {});
    expect(notifyPermission()).toBe('unsupported');
    expect(await requestNotify()).toBe(false);
  });
});
