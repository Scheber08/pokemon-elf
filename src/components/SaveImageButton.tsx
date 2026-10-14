import { useState, type RefObject } from 'react';
import { useT } from '../i18n';
import { downloadBlob, nodeToPng } from '../lib/exportImage';
import { useToast } from '../state/Toast';

interface Props {
  /** Bereich, der ins Bild kommt (der Knopf selbst bleibt draußen) */
  target: RefObject<HTMLElement | null>;
  filename: string;
  label: string;
  /** Eindeutige Beschriftung für Screenreader und Tooltip */
  aria: string;
}

/** Knopf „Als Bild": speichert einen Seitenbereich als PNG (Hintergrund wie die Seite). */
export function SaveImageButton({ target, filename, label, aria }: Props) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!target.current) return;
    setBusy(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      downloadBlob(await nodeToPng(target.current, { scale: 2, background: bg }), filename);
    } catch (e) {
      console.error(e);
      toast(t.builder.imageFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="btn btn--small btn--ghost"
      onClick={save}
      disabled={busy}
      aria-label={aria}
      title={aria}
      data-html2canvas-ignore
    >
      {busy ? t.builder.savingImage : label}
    </button>
  );
}
