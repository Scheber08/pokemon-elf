/**
 * „Beste Elf": stellt aus einem Pool eine starke Aufstellung zusammen – gierig nach Positions-Fit
 * (wichtigste Positionen zuerst, gewichtet wie der Team-Score), danach Plätze tauschen, solange es
 * sich lohnt. Optional mit Mega-Limit und Standardschütze. Deterministisch (gleicher Pool → gleiche Elf).
 */
import { isMega } from '../config/categories';
import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import type { FormationId, Pokemon, PosCode } from '../types';
import { positionFit, type Scale } from './fit';

export interface BestElevenOptions {
  /** Höchstens so viele Megas (null = beliebig) */
  megaMax?: number | null;
  /** Auch einen Standardschützen wählen */
  setPiece?: boolean;
  /** Zuschlag auf den Fit je Pokémon (z. B. Tagesform der Manager-Saison) */
  bonus?: (p: Pokemon) => number;
}

export function bestEleven(
  formation: FormationId,
  pool: Pokemon[],
  scale: Scale,
  { megaMax = null, setPiece = false, bonus }: BestElevenOptions = {},
): { slots: (number | null)[]; ss: number | null } {
  const defs = FORMATIONS[formation].slots;
  const weight = (pos: PosCode) => POSITIONS[pos].teamWeight;
  const fit = (p: Pokemon, pos: PosCode) => positionFit(p, pos, scale) + (bonus ? bonus(p) : 0);
  const order = defs.map((_, i) => i).sort((a, b) => weight(defs[b].pos) - weight(defs[a].pos) || a - b);
  const used = new Set<number>();
  const chosen: (Pokemon | null)[] = defs.map(() => null);
  let megas = 0;
  for (const i of order) {
    let best: Pokemon | null = null;
    let bestFit = -1;
    for (const p of pool) {
      if (used.has(p.id) || (isMega(p) && megaMax != null && megas >= megaMax)) continue;
      const f = fit(p, defs[i].pos);
      if (f > bestFit || (f === bestFit && best && p.id < best.id)) {
        best = p;
        bestFit = f;
      }
    }
    if (!best) continue;
    chosen[i] = best;
    used.add(best.id);
    if (isMega(best)) megas++;
  }
  // Paarweise tauschen, solange der gewichtete Fit steigt (höchstens ein paar Runden)
  for (let round = 0; round < 3; round++) {
    let improved = false;
    for (let a = 0; a < defs.length; a++) {
      for (let b = a + 1; b < defs.length; b++) {
        const pa = chosen[a];
        const pb = chosen[b];
        if (!pa || !pb) continue;
        const wa = weight(defs[a].pos);
        const wb = weight(defs[b].pos);
        const now = fit(pa, defs[a].pos) * wa + fit(pb, defs[b].pos) * wb;
        const swapped = fit(pb, defs[a].pos) * wa + fit(pa, defs[b].pos) * wb;
        if (swapped > now + 1e-9) {
          chosen[a] = pb;
          chosen[b] = pa;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  let ss: number | null = null;
  if (setPiece) {
    let bestFit = -1;
    for (const p of pool) {
      if (used.has(p.id) || (isMega(p) && megaMax != null && megas >= megaMax)) continue;
      const f = fit(p, 'SS');
      if (f > bestFit) {
        bestFit = f;
        ss = p.id;
      }
    }
  }
  return { slots: chosen.map((p) => p?.id ?? null), ss };
}
