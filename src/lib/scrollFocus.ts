/**
 * Seitlich scrollende Tabellen (.table-scroll) und das Draft-Board (.draft__board, online und lokal) per Tastatur erreichbar machen: Läuft der Inhalt über,
 * bekommt der Container tabindex="0" (Pfeiltasten scrollen ihn), sonst nicht – keine leeren Tab-Stopps.
 * Einmal an der App-Wurzel installiert, gilt es für alle Seiten (auch später gerenderte Tabellen).
 */
export const SCROLL_SELECTOR = '.table-scroll, .draft__board';

/** Tab-Stopp passend zum Überlauf setzen oder entfernen */
export function syncScrollFocus(el: HTMLElement): void {
  const overflowing = el.scrollWidth > el.clientWidth + 1;
  if (overflowing) {
    if (el.getAttribute('tabindex') !== '0') el.setAttribute('tabindex', '0');
  } else if (el.getAttribute('tabindex') === '0') {
    el.removeAttribute('tabindex');
  }
}

/** Beobachtet root auf scrollbare Container (SCROLL_SELECTOR) und deren Größe; liefert die Aufräumfunktion. */
export function installScrollFocus(root: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const seen = new WeakSet<Element>();
  const resize = new ResizeObserver((entries) => {
    for (const e of entries) {
      const box = (e.target as HTMLElement).closest<HTMLElement>(SCROLL_SELECTOR);
      if (box) syncScrollFocus(box);
    }
  });
  const scan = () => {
    root.querySelectorAll<HTMLElement>(SCROLL_SELECTOR).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      resize.observe(el);
      // Die Tabelle selbst wächst mit neuen Zeilen/Spalten – auch sie beobachten
      if (el.firstElementChild) resize.observe(el.firstElementChild);
      syncScrollFocus(el);
    });
  };
  // Neue Tabellen nach Seitenwechseln: höchstens ein Durchlauf je Frame
  let queued = false;
  const mutations = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  });
  scan();
  mutations.observe(root, { childList: true, subtree: true });
  return () => {
    mutations.disconnect();
    resize.disconnect();
  };
}
