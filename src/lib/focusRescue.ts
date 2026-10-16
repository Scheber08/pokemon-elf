/**
 * Fokus retten: Verschwindet der gerade bediente Knopf (z. B. „Run starten“, „Neuer Run“, „Draft starten“),
 * fällt der Tastaturfokus auf den Seitenanfang. Die neue Ansicht holt ihn dann zu sich – aber nur nach einer
 * echten Eingabe kurz zuvor, nie beim bloßen Laden der Seite (dort bleiben Skip-Link und Menü vorne).
 */
import { useEffect, type RefObject } from 'react';

/** So lange nach einer Taste/einem Klick gilt ein verlorener Fokus als Folge dieser Eingabe */
const RECENT_MS = 3000;
let lastInput = -Infinity;

if (typeof window !== 'undefined') {
  const mark = () => {
    lastInput = Date.now();
  };
  window.addEventListener('keydown', mark, true);
  window.addEventListener('pointerdown', mark, true);
}

/** Fokus verloren: auf der Seite selbst, nirgends oder auf einem entfernten Element */
function focusLost(): boolean {
  const active = document.activeElement;
  return active == null || active === document.body || !document.body.contains(active);
}

/** Setzt den Fokus auf el, wenn er nach einer Eingabe verloren ging. Liefert, ob fokussiert wurde. */
export function rescueFocus(el: HTMLElement | null, now = Date.now()): boolean {
  if (!el || !focusLost() || now - lastInput > RECENT_MS) return false;
  el.focus({ preventScroll: true });
  return true;
}

/** Beim Einhängen der Ansicht: rescueFocus auf den Container (braucht tabIndex={-1}) */
export function useFocusRescue(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    rescueFocus(ref.current);
  }, [ref]);
}
