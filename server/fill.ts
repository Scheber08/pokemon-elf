/**
 * Online-Draft: Kandidaten zum Auffüllen der Saison – Teams echter Spieler aus der
 * Allzeit-Rangliste der 34–0 Challenge (Spielername, Teamname, Elf). Die Auswahl daraus trifft
 * die Engine (fillTeams, Liga-Seed); reichen die Kandidaten nicht, nimmt sie Vereine.
 */
import { isDefaultPlayerName } from '../src/lib/api/contract';
import { FORMATION_IDS, FORMATIONS } from '../src/config/formations';
import type { FillCandidate } from '../src/lib/draftEngine';
import type { FormationId } from '../src/types';
import { fillCandidateRows, type FillCandidateRow } from './db';
import type { Db } from './env';
import { ensureSchema } from './schema';

/** Aus so vielen der besten Teams wird ausgewählt */
export const FILL_POOL = 120;

const isSlot = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v > 0);

/** Eine Zeile als Kandidat – null bei unbekannter Formation, kaputter Elf oder Standardnamen. */
export function toFillCandidate(row: FillCandidateRow): FillCandidate | null {
  const formation = row.formation as FormationId;
  if (!FORMATION_IDS.includes(formation) || typeof row.player !== 'string' || isDefaultPlayerName(row.player)) return null;
  let data: unknown;
  try {
    data = JSON.parse(row.lineup_json);
  } catch {
    return null;
  }
  const size = FORMATIONS[formation].slots.length;
  const ss = row.ss_enabled === 1;
  if (!Array.isArray(data) || data.length !== size + (ss ? 1 : 0) || !data.every(isSlot)) return null;
  const values = data as (number | null)[];
  return {
    player: row.player,
    ...(typeof row.entry_id === 'string' && row.entry_id ? { entryId: row.entry_id } : {}),
    teamName: typeof row.team_name === 'string' ? row.team_name : '',
    formation,
    slots: values.slice(0, size),
    ss: ss ? values[size] : null,
  };
}

/** Kandidaten laden – Fehler (z. B. Datenbank nicht erreichbar) ergeben eine leere Liste. */
export async function loadFillCandidates(db: Db): Promise<FillCandidate[]> {
  try {
    await ensureSchema(db);
    const rows = await fillCandidateRows(db, 'c340', FILL_POOL);
    return rows.flatMap((r) => toFillCandidate(r) ?? []);
  } catch (err) {
    console.error('Draft-Raum: Ranglisten-Teams zum Auffüllen nicht geladen – es spielen Vereine', err);
    return [];
  }
}
