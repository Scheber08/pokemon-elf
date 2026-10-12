import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import type { FormationId, Slots } from '../types';

/**
 * Ordnet eine Aufstellung einer neuen Formation zu.
 * 1. Gleiche Positionskürzel werden zuerst zugeordnet (nächstgelegener Slot gewinnt).
 * 2. Spieler, deren Slot wegfällt, rücken auf die nächstpassende freie Position –
 *    gleiche Profilgruppe/Reihe bevorzugt, dann geringste Distanz auf dem Feld.
 */
export function remapFormation(from: FormationId, to: FormationId, slots: Slots): Slots {
  if (from === to) return slots.slice();
  const oldSlots = FORMATIONS[from].slots;
  const newSlots = FORMATIONS[to].slots;
  const result: Slots = newSlots.map(() => null);
  const pending = oldSlots
    .map((s, i) => ({ def: s, id: slots[i] ?? null }))
    .filter((e): e is { def: (typeof oldSlots)[number]; id: number } => e.id != null);

  const cost = (a: (typeof oldSlots)[number], b: (typeof newSlots)[number]) => {
    const pa = POSITIONS[a.pos];
    const pb = POSITIONS[b.pos];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    let penalty = 0;
    if (a.pos !== b.pos) penalty += 20;
    if (pa.profile !== pb.profile) penalty += 15;
    if (pa.line !== pb.line) penalty += 25;
    return dist + penalty;
  };

  // Alle Paare nach Kosten sortieren und gierig zuordnen.
  const pairs: { p: number; n: number; c: number }[] = [];
  pending.forEach((e, p) => newSlots.forEach((ns, n) => pairs.push({ p, n, c: cost(e.def, ns) })));
  pairs.sort((a, b) => a.c - b.c);
  const placed = new Set<number>();
  for (const { p, n } of pairs) {
    if (placed.has(p) || result[n] != null) continue;
    result[n] = pending[p].id;
    placed.add(p);
  }
  return result;
}

export function emptySlots(formation: FormationId): Slots {
  return FORMATIONS[formation].slots.map(() => null);
}
