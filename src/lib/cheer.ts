/**
 * Torjubel: ein kurzer Spruch je Team, der in der 2D-Ansicht unter „TOR!“ erscheint. Reine Optik.
 * Gespeichert wie die Trikotfarben (Builder, DraftTeam.cheer, im Browser je Challenge bzw. lokalem Draft).
 */

/** Höchstlänge in Zeichen (Code Points) */
export const CHEER_MAX = 40;

/** Spruch säubern: Text, Leerraum zusammengefasst, höchstens CHEER_MAX Zeichen; sonst ''. */
export function cleanCheer(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Steuerzeichen raus, Leerraum zusammenfassen
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, CHEER_MAX).join('').trim();
}
