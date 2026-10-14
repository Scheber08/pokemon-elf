/**
 * QR-Code als SVG-Pfad (ein Rechteck je dunklem Modul) – die Bibliothek wird erst beim
 * ersten Aufruf geladen, damit sie nicht im Start-Bundle landet.
 */
export interface QrPath {
  /** Module pro Seite (ohne Ruhezone) */
  size: number;
  /** SVG-Pfad in Modul-Koordinaten */
  d: string;
}

export async function qrPath(text: string): Promise<QrPath> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  return { size, d };
}
