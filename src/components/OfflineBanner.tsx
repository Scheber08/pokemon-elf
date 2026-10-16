import { useEffect, useState } from 'react';
import { useT } from '../i18n';

/** Ohne Netz: kurzer Hinweis unter dem Kopf, was weiter geht (Builder, Challenges, lokaler Draft) und was nicht. */
export function OfflineBanner() {
  const t = useT();
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  // Live-Region bleibt stehen, damit Screenreader den Wechsel ansagen
  return (
    <div className="offline-banner-wrap" role="status">
      {offline && <p className="offline-banner">{t.common.offlineBanner}</p>}
    </div>
  );
}
