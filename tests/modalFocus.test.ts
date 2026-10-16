/** Dialog: Tab-Fokusfalle – auch direkt nach dem Öffnen (Fokus auf dem Dialog selbst) bleibt Tab/Shift+Tab im Dialog. */
import { describe, expect, it } from 'vitest';
import { installMiniDom, MiniElement, MiniEvent } from './miniDom';

const doc = installMiniDom();
// Der Fokus-Selektor des Dialogs nutzt :not(...) – das Mini-DOM kennt das nicht; im Test gibt es nur Knöpfe
const qsa = MiniElement.prototype.querySelectorAll;
MiniElement.prototype.querySelectorAll = function (this: MiniElement, sel: string) {
  return qsa.call(this, sel.includes(':not(') ? 'button' : sel);
};
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Modal } = await import('../src/components/Modal');
const { act, createElement: h } = React;

const tab = (shift: boolean) =>
  act(async () => {
    const ev = Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key: 'Tab', shiftKey: shift });
    (doc.activeElement ?? doc.body).dispatchEvent(ev);
    // Standardverhalten des Browsers nachbilden, wenn der Dialog nicht eingreift: Fokus verlässt den Dialog
    if (!ev.defaultPrevented) (doc.getElementById('outside') as unknown as { focus: () => void }).focus();
  });

describe('Modal-Fokusfalle', () => {
  it('Shift+Tab direkt nach dem Öffnen springt auf das letzte Element im Dialog, nicht hinaus', async () => {
    const outside = doc.createElement('button');
    outside.setAttribute('id', 'outside');
    doc.body.appendChild(outside);
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(h(Modal, { title: 'Test', onClose: () => {}, children: [h('button', { id: 'a', key: 'a' }, 'A'), h('button', { id: 'b', key: 'b' }, 'B')] })));
    const dialog = doc.body.querySelector('[role="dialog"]')!;
    expect(doc.activeElement).toBe(dialog);
    await tab(true);
    expect(doc.activeElement!.getAttribute('id')).toBe('b');
    // Vom letzten Element mit Tab zurück zum ersten (Schließen-Knopf im Kopf)
    await tab(false);
    expect(dialog.contains(doc.activeElement)).toBe(true);
    // Fokus auf dem Dialog selbst, Tab vorwärts: erstes Element
    await act(async () => (dialog as unknown as { focus: () => void }).focus());
    await tab(false);
    expect(dialog.contains(doc.activeElement) && doc.activeElement !== dialog).toBe(true);
    await act(async () => root.unmount());
  });

  it('Kopf und Fuß sind keine Landmarks (header/footer im Portal wären zweites banner/contentinfo)', async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as never);
    await act(async () => root.render(h(Modal, { title: 'Test', onClose: () => {}, footer: h('button', null, 'OK'), children: h('p', null, 'x') })));
    expect(doc.body.querySelectorAll('header').length).toBe(0);
    expect(doc.body.querySelectorAll('footer').length).toBe(0);
    expect(doc.body.querySelector('.modal__head')).not.toBeNull();
    expect(doc.body.querySelector('.modal__foot')).not.toBeNull();
    await act(async () => root.unmount());
  });
});
