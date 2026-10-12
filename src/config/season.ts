import type { PosCode } from '../types';

export const SEASON = {
  /** Anzahl Gegner – mit dem eigenen Team ergibt das 18 Teams und 34 Spieltage. */
  opponents: 17,
  /** Gegner-Ratings werden gleichmäßig über diesen Bereich verteilt. */
  minRating: 350,
  maxRating: 910,

  /** λ = base · exp((eigenes Rating − Gegner) / divisor) + Heimvorteil */
  baseGoals: 1.4,
  divisor: 250,
  homeAdvantage: 0.15,
  /** Leichte Zufallsstreuung: λ wird mit exp(N(0, jitter)) multipliziert. */
  jitter: 0.12,
  /** λ wird auf diesen Bereich begrenzt, damit es keine 15:0-Ergebnisse gibt. */
  minLambda: 0.05,
  maxLambda: 5.5,

  /** Kleiner λ-Bonus durch einen starken Standardschützen (Fit 100 → +max, Fit 0 → −max). */
  setPieceBonus: 0.06,
  /** Anteil der Tore, die bei gesetztem Standardschützen aus Standards fallen. */
  setPieceShare: 0.12,

  points: { win: 3, draw: 1, loss: 0 },
};

/**
 * Torgefahr pro Position für die Torschützenliste.
 * Wird mit den Angriffswerten (ANG/SP.ANG) des Pokémon multipliziert.
 */
export const GOAL_THREAT: Record<PosCode, number> = {
  ST: 1.0,
  LF: 0.62,
  RF: 0.62,
  OM: 0.5,
  LM: 0.36,
  RM: 0.36,
  ZM: 0.26,
  DM: 0.12,
  LWB: 0.14,
  RWB: 0.14,
  IV: 0.1,
  LV: 0.08,
  RV: 0.08,
  TW: 0.003,
  SS: 0,
};

/** Pokémon-thematische Fantasie-Vereinsnamen (Orte aus Kanto, Johto, Hoenn & Sinnoh). */
export const CLUB_NAMES = [
  'FC Prismania',
  'Vertania 04',
  'SV Orania',
  'Azuria Wellen',
  'Marmoria 1910',
  'Lavandia Geister',
  'Fuchsania Ninjas',
  'Union Saffronia',
  'Kickers Zinnoberinsel',
  'Alabastia United',
  'Dukatia City FC',
  'Rot-Weiß Teak',
  'Eintracht Ebenholz',
  'Viktoria Viola',
  'Rapid Rosalia',
  'Dynamo Mahagonia',
  'SpVgg Oliviana',
  'Arminia Azalea',
  'Preußen Neuborkia',
  'Alemannia Anemonia',
  'Borussia Blütenburg',
  'TSV Metarost',
  'Fortuna Faustauhaven',
  'Wacker Wurzelheim',
  'Bayer Baumhausen',
  'Hertha Herzhofen',
  'Erzelingen Kumpel',
  'SC Moosbach',
  'Malvenfroh Blitz',
  'Indigo Plateau 1996',
];
