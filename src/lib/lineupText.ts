/** Aufstellung als Text für Chats: Kopfzeile (Teamname, Formation), je Position ein Spieler, Kapitän markiert, Link am Ende. */
import { FORMATIONS } from '../config/formations';
import type { Messages } from '../i18n';
import type { FormationId, Pokemon } from '../types';

export interface TextLineup {
  teamName: string;
  formation: FormationId;
  slots: readonly (number | null)[];
  /** Standardschütze (null/undefined: keiner) */
  ss?: number | null;
  captain?: number | null;
}

export function lineupText(t: Messages, l: TextLineup, byId: Map<number, Pokemon>, url?: string): string {
  const line = (pos: string, id: number | null | undefined) => {
    const p = id != null ? byId.get(id) : undefined;
    return p ? `${pos} ${t.game.pokemon(p)}${id === l.captain ? t.builder.textCaptain : ''}` : null;
  };
  const def = FORMATIONS[l.formation];
  const rows = def.slots.map((d, i) => line(t.game.posShort[d.pos], l.slots[i]));
  if (l.ss != null) rows.push(line(t.game.posShort.SS, l.ss));
  return [t.builder.textHeader(l.teamName.trim(), def.label), ...rows.filter((x): x is string => !!x), ...(url ? [url] : [])].join('\n');
}
