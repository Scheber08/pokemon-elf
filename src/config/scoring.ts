/**
 * Stellschrauben der Bewertung. Alles hier lässt sich gefahrlos anpassen –
 * die Unit-Tests prüfen nur Eigenschaften (Reihenfolgen, Grenzen), keine festen Zahlen.
 */
export const SCORING = {
  /**
   * Normalisierung der Basiswerte: Wert ÷ 255, danach geglättet.
   * norm = percentileWeight · Perzentil(Wert im Pool) + (1 − percentileWeight) · √(Wert ÷ 255)
   */
  percentileWeight: 0.75,

  height: {
    /** Ab dieser Größe (m) gibt es keinen weiteren Bonus. */
    cap: 2.2,
  },

  weight: {
    /** Logarithmische Skala: jede Verdopplung zählt gleich viel … */
    minKg: 1,
    /** … bis zu dieser Obergrenze (kg). */
    capKg: 400,
  },

  /**
   * Der Positions-Fit (0–100) ist das Perzentil der gewichteten Werte innerhalb
   * des Pools. `curve` > 1 macht die Spitze exklusiver, < 1 großzügiger.
   */
  fitCurve: 1.0,

  /** Typ-Bonus in Reihenfolge der Profil-Typen (erster gelisteter Typ zuerst). */
  typeBonus: [0.03, 0.02, 0.01, 0.01],

  team: {
    /** Anzahl der schwächsten Fits, die zusätzlich zählen. */
    weakestCount: 3,
    /** Zusätzliches Gewicht der schwächsten Fits (× Positionsgewicht). */
    weakestExtra: 2,
    /** Team-Score-Skala: Durchschnitts-Fit (0–100) × factor. */
    factor: 10,
  },
} as const;
