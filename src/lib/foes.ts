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
