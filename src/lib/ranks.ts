/**
 * Plätze einer absteigend sortierten Liste mit geteilten Rängen: gleicher Wert → gleicher Platz,
 * danach geht es mit der Position weiter (Werte 5, 5, 3 → Plätze 1, 1, 3).
 */
export function sharedRanks(values: readonly number[]): number[] {
  const out: number[] = [];
  values.forEach((v, i) => out.push(i > 0 && v === values[i - 1] ? out[i - 1] : i + 1));
  return out;
}
