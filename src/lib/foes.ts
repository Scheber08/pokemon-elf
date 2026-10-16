/** Bilanz gegen einzelne Gegner – ohne Draft-/Pokal-Code, damit auch die Challenges (Start-Paket) es nutzen können. */
import type { Match } from './season';

/**
 * 😊 Lieblingsgegner und 😖 Angstgegner eines Teams: Bilanz gegen jeden Gegner (Punkte, Tore);
 * am besten bzw. schlechtesten nach Punkten, dann Tordifferenz, dann Toren (Gleichstand: kleinerer Index).
 * null bei weniger als zwei Gegnern oder wenn beide gleich abschneiden.
 */
export function favouriteFoes(
  matches: readonly Pick<Match, 'home' | 'away' | 'hg' | 'ag'>[],
  team: number,
): { best: FoeRecord; worst: FoeRecord } | null {
  const rec = new Map<number, FoeRecord>();
  for (const m of matches) {
    if (m.home !== team && m.away !== team) continue;
    const home = m.home === team;
    const opp = home ? m.away : m.home;
    const gf = home ? m.hg : m.ag;
    const ga = home ? m.ag : m.hg;
    const r = rec.get(opp) ?? { opp, games: 0, pts: 0, gf: 0, ga: 0 };
    r.games++;
    r.pts += gf > ga ? 3 : gf === ga ? 1 : 0;
    r.gf += gf;
    r.ga += ga;
    rec.set(opp, r);
  }
  const list = [...rec.values()].sort((a, b) => a.opp - b.opp);
  if (list.length < 2) return null;
  const cmp = (a: FoeRecord, b: FoeRecord) => a.pts - b.pts || a.gf - a.ga - (b.gf - b.ga) || a.gf - b.gf;
  const best = list.reduce((a, b) => (cmp(b, a) > 0 ? b : a));
  const worst = list.reduce((a, b) => (cmp(b, a) < 0 ? b : a));
  return cmp(best, worst) > 0 ? { best, worst } : null;
}

export interface FoeRecord {
  opp: number;
  games: number;
  pts: number;
  gf: number;
  ga: number;
}

/** 🔥 Längste Siegesserie und 🛡️ längste Serie ohne Niederlage aus den Ergebnissen in Spielreihenfolge */
export function longestRuns(outcomes: readonly ('S' | 'U' | 'N')[]): { wins: number; unbeaten: number } {
  let win = 0;
  let unbeaten = 0;
  let wins = 0;
  let best = 0;
  for (const o of outcomes) {
    win = o === 'S' ? win + 1 : 0;
    unbeaten = o === 'N' ? 0 : unbeaten + 1;
    wins = Math.max(wins, win);
    best = Math.max(best, unbeaten);
  }
  return { wins, unbeaten: best };
}

/** 🏠/✈️ Bilanz (Siege–Remis–Niederlagen) zu Hause und auswärts */
export function venueRecords(matches: readonly { isHome: boolean; outcome: 'S' | 'U' | 'N' }[]): Record<'home' | 'away', { w: number; d: number; l: number }> {
  const out = { home: { w: 0, d: 0, l: 0 }, away: { w: 0, d: 0, l: 0 } };
  for (const m of matches) {
    const r = out[m.isHome ? 'home' : 'away'];
    if (m.outcome === 'S') r.w++;
    else if (m.outcome === 'U') r.d++;
    else r.l++;
  }
  return out;
}

/**
 * 🏁 Ab wann stand der Meister rechnerisch fest? Erster Spieltag, nach dem ein Team mehr Punkte hat, als
 * jedes andere mit Siegen in all seinen restlichen Spielen noch erreichen kann (Punktgleichheit zählt nicht
 * als sicher). null, wenn das erst am letzten Spieltag (oder nie eindeutig) feststand.
 */
export function titleClinched(
  matches: readonly Pick<Match, 'round' | 'home' | 'away' | 'hg' | 'ag'>[],
  teams: number,
): { team: number; round: number; left: number } | null {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const pts = new Array<number>(teams).fill(0);
  const left = new Array<number>(teams).fill(0);
  for (const m of matches) {
    left[m.home]++;
    left[m.away]++;
  }
  for (let i = 0; i < rounds.length - 1; i++) {
    for (const m of matches) {
      if (m.round !== rounds[i]) continue;
      left[m.home]--;
      left[m.away]--;
      pts[m.home] += m.hg > m.ag ? 3 : m.hg === m.ag ? 1 : 0;
      pts[m.away] += m.ag > m.hg ? 3 : m.hg === m.ag ? 1 : 0;
    }
    const lead = pts.indexOf(Math.max(...pts));
    if (pts.every((p, t) => t === lead || p + 3 * left[t] < pts[lead])) return { team: lead, round: rounds[i], left: rounds.length - 1 - i };
  }
  return null;
}
