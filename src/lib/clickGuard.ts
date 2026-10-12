/**
 * Sperre gegen Doppelklicks, unabhängig von Re-Render und Animation: Nach einem
 * angenommenen Klick werden weitere Klicks `ms` Millisekunden lang ignoriert.
 *
 *   const accept = createClickGuard(400);
 *   onClick={() => accept() && doIt()}
 */
export function createClickGuard(ms: number, now: () => number = () => performance.now()): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - last < ms) return false;
    last = t;
    return true;
  };
}
