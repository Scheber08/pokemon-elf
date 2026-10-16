/** Scroll-Verhalten: weich – außer bei „Bewegung reduzieren“ (Systemeinstellung), dann sofort. */
export function scrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
