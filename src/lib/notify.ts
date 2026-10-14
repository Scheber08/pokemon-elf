/**
 * Browser-Benachrichtigungen („Du bist dran" im Online-Draft) – nur, wenn der Browser sie
 * kann und erlaubt. Alles fehlertolerant: Ohne Erlaubnis bzw. Unterstützung passiert nichts.
 */

/** Kann dieser Browser Benachrichtigungen? */
export function notifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Aktuelle Erlaubnis ('unsupported' ohne Unterstützung). */
export function notifyPermission(): NotificationPermission | 'unsupported' {
  return notifySupported() ? Notification.permission : 'unsupported';
}

/** Erlaubnis anfragen (nur nach einem Klick sinnvoll) – true, wenn erlaubt. */
export async function requestNotify(): Promise<boolean> {
  if (!notifySupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Benachrichtigung zeigen (gleicher tag ersetzt eine ältere). Ein Klick holt den Tab nach vorn.
 * Nur, wenn die Seite gerade nicht zu sehen ist – sonst reicht der Gong.
 */
export function showNotify(title: string, body: string, tag: string): void {
  if (notifyPermission() !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body, tag, icon: `${import.meta.env.BASE_URL}favicon.svg` });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // z. B. Android-Chrome ohne Service Worker – dann eben nur der Gong
  }
}
