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
 *       → drafting (Snake- bzw. feste Reihenfolge; Timer, CPU-Picks und – im Zufallsmodus –
 *         die Würfe aus Generation + Typ laufen auf dem Server)
 *       → done (Saison-Seed + Startzeit stehen fest; der Server berechnet das Ergebnis
 *         einmal und schickt es mit (league) – alle Clients spielen dieselbe Saison
 *         synchron als Ticker ab).
 */
import { TYPE_KEYS } from '../../config/pokemonTypes';
import type { FormationId, RegionFilter, TypeKey } from '../../types';
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
  /** Erlaubte Legendären-Limits pro Team (null = unbegrenzt) */
  maxLegends: [1, 2, 3] as const,
  /** Erlaubte Ultrabestien-Limits pro Team (null = unbegrenzt) */
  maxUltraBeasts: [1, 2, 3] as const,
  /** Erlaubte Mega-Limits pro Team (null = unbegrenzt) */
  maxMegas: [1, 2, 3] as const,
  /** Höchstens so viele Typ- bzw. Regions-Rerolls pro Team und Draft */
  rerollsMax: 3,
} as const;

export type PickSeconds = (typeof DRAFT_LIMITS.pickSeconds)[number];

/** Alle Generationen (1–9) – Pool-Auswahl „Alle" */
export const DRAFT_ALL_GENS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Zufallsmodus (wie die 34–0-Challenge): 'off' = freie Wahl aus dem Pool, 'pick' = jeder Pick
 * bekommt einen eigenen Wurf (Generation + Typ), 'round' = ein Wurf pro Runde für alle Teams –
 * hat das Team am Zug darin nichts Wählbares mehr, bekommt es für diesen Pick einen eigenen Wurf.
 */
export type DraftRollMode = 'off' | 'pick' | 'round';
export const DRAFT_ROLL_MODES: readonly DraftRollMode[] = ['off', 'pick', 'round'];

/** Reroll-Arten: Typ bzw. Region (Generation) des aktuellen Wurfs neu würfeln */
export type DraftRerollKind = 'type' | 'region';
export const DRAFT_REROLL_KINDS: readonly DraftRerollKind[] = ['type', 'region'];

/** Ein Wurf: Das Pokémon muss aus dieser Generation stammen und diesen Typ haben. */
export interface DraftRoll {
  gen: number;
  type: TypeKey;
}

/**
 * Wurf des aktuellen Picks. own: eigener Wurf des Teams – im Runden-Modus, weil der
 * Rundenwurf für dieses Team nichts Wählbares mehr hat, und in jedem Modus nach einem Reroll.
 */
export interface DraftActiveRoll extends DraftRoll {
  own: boolean;
}

/** Genutzte (bzw. erlaubte) Rerolls je Art */
export interface DraftRerollCount {
  type: number;
  region: number;
}

export interface DraftSettings {
  /** Liganame (optional, für Lobby-Liste und Ergebnis) */
  name: string;
  /** Pool: Generationen 1–9 (aufsteigend, ohne Doppelte, mindestens eine) */
  gens: number[];
  /** Pool: erlaubte Typen (Reihenfolge wie TYPE_KEYS, mindestens einer) – ein Pokémon braucht mindestens einen davon */
  types: TypeKey[];
  /** Legendäre im Pool */
  legendary: boolean;
  /** Mysteriöse im Pool */
  mythical: boolean;
  /**
   * Höchstens so viele Legendäre + Mysteriöse pro Team (Standardschütze zählt mit):
   * null = unbegrenzt, sonst 1–3. Wirkt nur, wenn legendary oder mythical an ist.
   */
  maxLegends: number | null;
  /** Ultrabestien im Pool (ältere Ligen ohne das Feld: ja – dort waren sie normale Pokémon) */
  ultraBeasts: boolean;
  /**
   * Höchstens so viele Ultrabestien pro Team (Standardschütze zählt mit): null = unbegrenzt,
   * sonst 1–3. Wirkt nur, wenn ultraBeasts an ist.
   */
  maxUltraBeasts: number | null;
  /** Regional- und Sonderformen im Pool (public/data/forms.json) */
  forms: boolean;
  /** Megas (inkl. Proto-Formen) im Pool – legendäre Megas nur zusammen mit legendary */
  megas: boolean;
  /**
   * Höchstens so viele Megas pro Team (Standardschütze zählt mit): null = unbegrenzt, sonst 1–3.
   * Wirkt nur, wenn megas an ist. Legendäre Megas zählen für beide Limits.
   */
  maxMegas: number | null;
  /** Standardschütze → 12. Runde */
  setPiece: boolean;
  /** Maximale Teamzahl (2–8) */
  maxTeams: number;
  /** Bedenkzeit pro Pick in Sekunden, 0 = ohne Timer */
  pickSeconds: PickSeconds;
  /** Draft-Reihenfolge: zufällig oder vom Host festgelegt */
  order: 'random' | 'host';
  /** Snake (jede zweite Runde rückwärts) – false: jede Runde dieselbe Reihenfolge */
  snake: boolean;
  /** Zufallsmodus (siehe DraftRollMode) */
  roll: DraftRollMode;
  /** Rerolls pro Team und Draft je Art (je 0–3; nur im Zufallsmodus) */
  rerolls: DraftRerollCount;
  /** Öffentlich = in der Lobby-Liste sichtbar */
  visibility: 'private' | 'public';
}

/**
 * Ältere Schlüssel, die zwischengespeicherte Clients noch schicken: region (0 = alle
 * Generationen, sonst genau diese) und legends (Legendäre und Mysteriöse). Neue Schlüssel
 * im selben Patch (gens bzw. legendary/mythical) haben Vorrang.
 */
export interface LegacySettingsPatch {
  region?: RegionFilter;
  legends?: boolean;
}

/** Änderung der Einstellungen (Erstellen, Lobby) – inkl. der älteren Schlüssel. */
export type DraftSettingsPatch = Partial<DraftSettings> & LegacySettingsPatch;

export const DEFAULT_DRAFT_SETTINGS: DraftSettings = {
  name: '',
  gens: [1],
  types: [...TYPE_KEYS],
  legendary: false,
  mythical: false,
  maxLegends: null,
  ultraBeasts: true,
  maxUltraBeasts: null,
  forms: false,
  megas: false,
  maxMegas: 1,
  setPiece: false,
  maxTeams: 4,
  pickSeconds: 60,
  order: 'random',
  snake: true,
  roll: 'off',
  rerolls: { type: 1, region: 1 },
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
  /** Wurf, unter dem gewählt wurde (nur im Zufallsmodus und wenn es einen gab) */
  roll?: DraftRoll;
}

export interface DraftSeason {
  /** Seed der Saison – alle Clients simulieren damit dieselbe Liga */
  seed: number;
  /** Zeitpunkt (ms) des ersten Spieltags im gemeinsamen Ticker */
  startsAt: number;
  /** Dauer eines Spieltags (ms) */
  stepMs: number;
}

/**
 * Einstellungen im Schnappschuss: die aktuelle Form plus – veraltet, nur lesbar – die älteren
 * region/legends für Clients von vor dem Update (ein offener Tab mit altem Bundle verbindet sich
 * nach einem Deploy neu). region: 0 bei allen bzw. mehreren Generationen, sonst die eine;
 * legends: Legendäre oder Mysteriöse im Pool. Neue Clients lesen nur die aktuellen Schlüssel.
 */
export type DraftSnapshotSettings = DraftSettings & LegacySettingsPatch;

export interface DraftSnapshot {
  code: string;
  phase: DraftPhase;
  settings: DraftSnapshotSettings;
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
  /**
   * Wurf des aktuellen Picks (Zufallsmodus, während des Drafts; sonst null): Gewählt werden
   * darf nur ein Pokémon dieser Generation mit diesem Typ. null im Zufallsmodus = kein Wurf
   * hat für das Team am Zug noch etwas Wählbares → freie Wahl aus dem Rest des Pools.
   */
  roll?: DraftActiveRoll | null;
  /** Rundenwurf (nur bei settings.roll = 'round') */
  roundRoll?: DraftRoll | null;
  /** Genutzte Rerolls je Team-ID (fehlt ein Team: noch keine) */
  rerollsUsed?: Record<string, DraftRerollCount>;
}

export interface CreateDraftRequest extends DeviceAuth {
  settings: DraftSettingsPatch;
  teamName: string;
  formation: FormationId;
}

export interface CreateDraftResponse {
  code: string;
}

/** region einer Lobby-Zeile, wenn der Pool mehrere (aber nicht alle) Generationen umfasst */
export const LOBBY_REGION_MANY = 10;

/** Pool-Kurzform der Lobby-Liste: 0 = alle Generationen, 1–9 = genau diese, 10 = mehrere */
export type LobbyRegion = RegionFilter | typeof LOBBY_REGION_MANY;

export interface PublicLobby {
  code: string;
  name: string;
  hostName: string;
  teams: number;
  maxTeams: number;
  /**
   * Pool-Generationen (D1-Spalte region): 0 = alle, 1–9 = genau diese Generation,
   * 10 = mehrere (LOBBY_REGION_MANY) – Anzeige „Mehrere Generationen".
   */
  region: LobbyRegion;
  /** Legendäre oder Mysteriöse im Pool */
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
  | { type: 'settings'; settings: DraftSettingsPatch }
  | { type: 'add-cpu' }
  | { type: 'remove-team'; teamId: string }
  | { type: 'set-order'; order: string[] }
  | { type: 'start' }
  | { type: 'pick'; pokemonId: number; slot: number }
  /** teamId/pickIndex (optional): nur, wenn das noch der aktuelle Zug ist – sonst Fehler „stale" */
  | { type: 'auto-pick'; teamId?: string; pickIndex?: number }
  /**
   * Wurf des aktuellen Picks neu würfeln – nur das Team am Zug, im Zufallsmodus, mit Rerolls übrig
   * (keine Lobby-Änderung). pickIndex/roll (optional): Pick bzw. Wurf, den der Client gesehen hat –
   * ist der Zug schon weiter oder der Wurf schon ein anderer, lehnt der Server mit „stale" ab
   * (statt einen ungesehenen Wurf neu zu würfeln und einen Reroll zu verbrauchen).
   */
  | { type: 'reroll'; kind: DraftRerollKind; pickIndex?: number; roll?: DraftRoll }
  | { type: 'ping' };

export type DraftServerMessage =
  | { type: 'state'; state: DraftSnapshot }
  /** for: Typ der Client-Nachricht, die abgelehnt wurde (fehlt, wenn unbekannt – z. B. beim Nachrichtenlimit) */
  | { type: 'error'; code: string; message: string; for?: DraftClientMessage['type'] }
  | { type: 'pong'; serverNow: number };
