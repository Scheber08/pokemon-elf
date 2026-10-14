/**
 * Link-Vorschau einer Online-Liga (/draft/:code): Der Worker liefert index.html mit eigenen
 * Open-Graph-Tags aus – Titel und Beschreibung aus der Lobby-Zeile in D1 (kein Durable Object
 * nötig). Hier nur die reine Logik; das Umschreiben des HTML macht worker/index.ts.
 * Vorschauen sind deutsch (Crawler schicken keine Sprache, die App ist deutsch zuerst).
 */
import { DRAFT_LIMITS } from '../src/lib/api/draftContract';
import type { Db } from './env';

export interface LobbyPreviewRow {
  name: string;
  host_name: string;
  teams: number;
  max_teams: number;
  phase: string;
}

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute Adressen (Crawler lösen relative nicht immer auf) */
  url: string;
  image: string;
}

/** Pfad einer Liga-Seite → Code (groß) oder null. */
export function draftPageCode(pathname: string): string | null {
  const m = /^\/draft\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  const code = m[1].toUpperCase();
  return code.length === DRAFT_LIMITS.codeLength && [...code].every((c) => DRAFT_LIMITS.codeAlphabet.includes(c)) ? code : null;
}

export async function lobbyPreview(db: Db, code: string): Promise<LobbyPreviewRow | null> {
  return db
    .prepare('SELECT name, host_name, teams, max_teams, phase FROM draft_lobbies WHERE code = ?')
    .bind(code)
    .first<LobbyPreviewRow>();
}

/** Meta-Angaben der Liga-Seite – ohne (offene) Liga eine allgemeine Einladung. */
export function draftPageMeta(code: string, row: LobbyPreviewRow | null, origin: string): PageMeta {
  const league = row?.name?.trim() ? `„${row.name.trim()}“` : code;
  const base = { url: `${origin}/draft/${code}`, image: `${origin}/og.png` };
  if (!row || row.phase === 'closed') {
    return { ...base, title: `Online-Liga ${code} · Pokémon Elf`, description: 'Fantasy-Draft mit Pokémon: Elf draften, Saison spielen, Meister werden.' };
  }
  const title = `Online-Liga ${league} · Pokémon Elf`;
  if (row.phase === 'lobby') {
    const host = row.host_name?.trim() || 'Jemand';
    return {
      ...base,
      title,
      description: `${host} lädt dich zum Fantasy-Draft ein – ${row.teams}/${row.max_teams} Teams dabei. Tritt bei und draftet eure Pokémon-Elf!`,
    };
  }
  if (row.phase === 'drafting') {
    return { ...base, title, description: `Der Draft läuft – ${row.teams} Teams wählen gerade ihre Pokémon-Elf. Schau live zu!` };
  }
  return { ...base, title, description: `Saison beendet – ${row.teams} Teams. Sieh dir Meister, Tabelle und alle Kader an.` };
}
