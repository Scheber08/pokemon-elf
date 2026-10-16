import { useEffect, useState } from 'react';
import { useT } from '../i18n';

/** Ab so viel gescrollter Höhe (px) erscheint „↑ Nach oben“ */
export const BACK_TO_TOP_AFTER = 1200;

/** Schwebender Knopf „↑ Nach oben“ auf langen Seiten (Ergebnisse, Manager-Saison, Shop …). */
export function BackToTop() {
  const t = useT();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > BACK_TO_TOP_AFTER);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!shown) return null;
  return (
    <button
      type="button"
      className="back-to-top"
      aria-label={t.common.backToTop}
      title={t.common.backToTop}
      onClick={() => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      }}
    >
      <span aria-hidden="true">↑</span>
    </button>
  );
}
