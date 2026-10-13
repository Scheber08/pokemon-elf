/**
 * Vertrag für den Online-Fantasy-Draft (Cloudflare Durable Object „DraftRoom").
 *
 *   POST /api/drafts               CreateDraftRequest  → CreateDraftResponse
 *   GET  /api/drafts/public                             → PublicLobbiesResponse
 *   GET  /api/drafts/:code                              → DraftSnapshot (you = null)
 *   GET  /api/drafts/:code/ws      WebSocket (Upgrade)  → DraftServerMessage-Strom
 *
 * WebSocket: Der Client schickt zuerst { type: 'hello', deviceId, deviceSecret }.
 * Danach bekommt er bei jeder Änderung { type: 'state', state } mit dem vollen
 * Schnappschuss (klein genug: höchstens 8 Teams × 12 Picks). Fehler kommen als
 * { type: 'error' } und ändern nichts am Zustand.
 *
 * Ablauf: lobby (beitreten, Host stellt ein, fügt CPU-Teams hinzu, startet)
 *       → drafting (Snake-Draft; Timer und CPU-Picks laufen auf dem Server)
 *       → done (Saison-Seed + Startzeit stehen fest; der Server berechnet das Ergebnis
 *         einmal und schickt es mit (league) – alle Clients spielen dieselbe Saison
 *         synchron als Ticker ab).
 */
import type { FormationId, RegionFilter } from '../../types';
import type { LeagueResult } from '../season';
import type { DeviceAuth } from './contract';

export const DRAFT_LIMITS = {
  minTeams: 2,
  maxTeams: 8,
  teamNameMax: 28,
  leagueNameMax: 40,
  pickSeconds: [0, 30, 60, 90] as const,
  /** Code-Alphabet ohne verwechselbare Zeichen (0/O, 1/I/L) */
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  codeLength: 6,
  /** Ligen pro Gerät und Stunde */
  createsPerHour: 20,
  /** Verzögerung eines CPU-Picks */
  cpuPickMs: 1200,
  /** Vorlauf bis zum ersten Spieltag der gemeinsamen Saison – Zeit, sich die fertigen Kader anzusehen */
  seasonLeadMs: 30_000,
  /** Dauer eines Spieltags im gemeinsamen Ticker */
  seasonStepMs: 8000,
  /** So lange bleibt eine Liga erhalten (danach wird sie gelöscht) */
  retentionDays: 14,
  /** Andere Mitglieder dürfen für ein Team auto-picken, das so lange offline ist (ms) */
  offlineGraceMs: 20_000,
  /** Ohne Timer: andere Mitglieder dürfen auto-picken, wenn der Zug so alt ist (ms) */
  afkMs: 180_000,
  /** Die Host-Rolle wandert zu einem anderen Menschen, wenn der Host so lange offline ist (ms) */
  hostGraceMs: 30_000,
  /** In der Lobby wandert die Host-Rolle erst nach dieser Abwesenheit (Einladen dauert) */
  lobbyHostGraceMs: 300_000,
} as const;

export type PickSeconds = (typeof DRAFT_LIMITS.pickSeconds)[number];

export interface DraftSettings {
  /** Liganame (optional, für Lobby-Liste und Ergebnis) */
  name: string;
  /** Pool: 0 = alle Regionen, sonst Generation 1–9 */
  region: RegionFilter;
  /** Legendäre und Mysteriöse im Pool */
  legends: boolean;
  /** Standardschütze → 12. Runde */
  setPiece: boolean;
  /** Maximale Teamzahl (2–8) */
  maxTeams: number;
  /** Bedenkzeit pro Pick in Sekunden, 0 = ohne Timer */
  pickSeconds: PickSeconds;
  /** Draft-Reihenfolge: zufällig oder vom Host festgelegt */
  order: 'random' | 'host';
  /** Öffentlich = in der Lobby-Liste sichtbar */
  visibility: 'private' | 'public';
}

export const DEFAULT_DRAFT_SETTINGS: DraftSettings = {
  name: '',
  region: 1,
  legends: false,
  setPiece: false,
  maxTeams: 4,
  pickSeconds: 60,
  order: 'random',
  visibility: 'private',
};

export interface DraftTeam {
  /** Stabile Team-ID innerhalb der Liga */
  id: string;
  name: string;
  formation: FormationId;
  cpu: boolean;
  /** Gerade verbunden (CPU: immer true) */
  online: boolean;
  /** Seit wann offline (ms, Serverzeit) – fehlt bei verbundenen Teams und älteren Ständen */
  offlineSince?: number | null;
  /** 11 Feldslots in Reihenfolge der Formation */
  slots: (number | null)[];
  /** Standardschütze (nur mit settings.setPiece) */
  ss: number | null;
}

export type DraftPhase = 'lobby' | 'drafting' | 'done';

export interface DraftPickLog {
  /** Laufende Pick-Nummer (0-basiert) */
  pick: number;
  teamId: string;
  pokemonId: number;
  /** 0–10 Feldslot, 11 = Standardschütze */
  slot: number;
  /** Vom Server gewählt (Timer abgelaufen, CPU oder Host-Auto-Pick) */
  auto: boolean;
  at: number;
}

export interface DraftSeason {
  /** Seed der Saison – alle Clients simulieren damit dieselbe Liga */
  seed: number;
  /** Zeitpunkt (ms) des ersten Spieltags im gemeinsamen Ticker */
  startsAt: number;
  /** Dauer eines Spieltags (ms) */
  stepMs: number;
}

export interface DraftSnapshot {
  code: string;
  phase: DraftPhase;
  settings: DraftSettings;
  /** Teams; ab dem Start in Draft-Reihenfolge (Runde 1) */
  teams: DraftTeam[];
  /** Team-ID des Hosts (kann wechseln, wenn der Host die Lobby verlässt) */
  hostTeamId: string | null;
  /** Nächster Pick (0-basiert), = totalPicks wenn fertig */
  pickIndex: number;
  totalPicks: number;
  /** Ablauf der Bedenkzeit des aktuellen Picks (ms) oder null */
  deadline: number | null;
  picks: DraftPickLog[];
  season: DraftSeason | null;
  createdAt: number;
  /** Serverzeit beim Versand – für den Abgleich der Uhren (Timer, Ticker) */
  serverNow: number;
  /** Team des anfragenden Geräts (null = Zuschauer / noch nicht beigetreten) */
  you: string | null;
  /** Beginn des aktuellen Zugs (ms, Serverzeit) – nur während des Drafts */
  turnStartedAt?: number | null;
  /**
   * Ergebnis der Saison, einmal auf dem Server berechnet und gespeichert (nur „done" –
   * fehlt bei älteren Ligen; dann simuliert der Client aus season.seed). Teams ohne Kader.
   */
  league?: LeagueResult | null;
  /** Team-Score je Team (Reihenfolge wie teams) – zusammen mit league */
  ratings?: number[] | null;
}

export interface CreateDraftRequest extends DeviceAuth {
  settings: Partial<DraftSettings>;
  teamName: string;
  formation: FormationId;
}

export interface CreateDraftResponse {
  code: string;
}

export interface PublicLobby {
  code: string;
  name: string;
  hostName: string;
  teams: number;
  maxTeams: number;
  region: RegionFilter;
  legends: boolean;
  pickSeconds: PickSeconds;
  createdAt: number;
}

export interface PublicLobbiesResponse {
  lobbies: PublicLobby[];
}

export type DraftClientMessage =
  | ({ type: 'hello' } & DeviceAuth)
  | { type: 'join'; teamName: string; formation: FormationId }
  | { type: 'leave' }
  | { type: 'update-team'; teamName?: string; formation?: FormationId }
  | { type: 'settings'; settings: Partial<DraftSettings> }
  | { type: 'add-cpu' }
  | { type: 'remove-team'; teamId: string }
  | { type: 'set-order'; order: string[] }
  | { type: 'start' }
  | { type: 'pick'; pokemonId: number; slot: number }
  /** teamId/pickIndex (optional): nur, wenn das noch der aktuelle Zug ist – sonst Fehler „stale" */
  | { type: 'auto-pick'; teamId?: string; pickIndex?: number }
  | { type: 'ping' };

export type DraftServerMessage =
  | { type: 'state'; state: DraftSnapshot }
  /** for: Typ der Client-Nachricht, die abgelehnt wurde (fehlt, wenn unbekannt – z. B. beim Nachrichtenlimit) */
  | { type: 'error'; code: string; message: string; for?: DraftClientMessage['type'] }
  | { type: 'pong'; serverNow: number };
