/**
 * Link-Vorschau einer Online-Liga (/draft/:code) und eines Spielerprofils (/spieler/:id): Der
 * Worker liefert index.html mit eigenen Open-Graph-Tags aus – Titel und Beschreibung aus D1 (kein
 * Durable Object nötig). Hier nur die reine Logik; das Umschreiben des HTML macht worker/index.ts.
 * Vorschauen sind deutsch (Crawler schicken keine Sprache, die App ist deutsch zuerst).
 */
import { isDefaultPlayerName } from '../src/lib/api/contract';
import { DRAFT_LIMITS } from '../src/lib/api/draftContract';
import gameDe from '../src/i18n/de/game';
import type { ChallengeKey } from '../src/types';
import { allTimePlaces, playerRows, rankedEntryDevice } from './db';
import type { Db } from './env';
import { CHALLENGE_KEYS, ENTRY_ID_RE } from './validate';

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

// ---------------------------------------------------------------- Spielerprofil (/spieler/:id)

/** Pfad eines Spielerprofils → Eintrags-ID oder null. */
export function profilePageId(pathname: string): string | null {
  const m = /^\/spieler\/([^/]+)\/?$/.exec(pathname);
  return m && ENTRY_ID_RE.test(m[1]) ? m[1] : null;
}

export interface ProfilePreview {
  player: string;
  runs: number;
  /** Bester aktueller Allzeit-Platz über alle Wertungen */
  best: { challenge: ChallengeKey; place: number; players: number } | null;
}

/** Name, gewertete Runs und bester Allzeit-Platz – null, wenn das Profil nicht (mehr) sichtbar ist. */
export async function profilePreview(db: Db, entryId: string, now: number): Promise<ProfilePreview | null> {
  const device = await rankedEntryDevice(db, entryId, now);
  if (!device || isDefaultPlayerName(device.player)) return null;
  const rows = await playerRows(db, device.device_id, 0);
  const played = CHALLENGE_KEYS.filter((c) => rows.counts.some((r) => r.challenge === c));
  const places = await allTimePlaces(db, device.device_id, played);
  let best: ProfilePreview['best'] = null;
  places.forEach((p, i) => {
    if (p.place != null && (!best || p.place < best.place)) best = { challenge: played[i], place: p.place, players: p.players };
  });
  return { player: device.player, runs: rows.counts.reduce((n, c) => n + c.runs, 0), best };
}

/** Meta-Angaben des Spielerprofils – ohne sichtbares Profil eine allgemeine Vorschau. */
export function profilePageMeta(entryId: string, preview: ProfilePreview | null, origin: string): PageMeta {
  const base = { url: `${origin}/spieler/${entryId}`, image: `${origin}/og.png` };
  if (!preview) {
    return { ...base, title: 'Spielerprofil · Pokémon Elf', description: 'Bestwerte und Teams eines Spielers der Pokémon-Elf-Rangliste.' };
  }
  const runs = preview.runs === 1 ? '1 gewerteter Run' : `${preview.runs} gewertete Runs`;
  const best = preview.best
    ? ` · bester Platz: ${preview.best.place} von ${preview.best.players} (${gameDe.challenge[preview.best.challenge]})`
    : '';
  return {
    ...base,
    title: `Profil von ${preview.player} · Pokémon Elf`,
    description: `${runs}${best}. Bestwerte und Teams ansehen – und selbst eine Pokémon-Elf aufstellen.`,
  };
}
