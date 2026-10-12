/**
 * Spieltag-für-Spieltag-Verlauf einer fertig simulierten Saison – Grundlage für den
 * Live-Ticker. Rein und deterministisch: rechnet nur aus dem SeasonResult nach
 * (keine Zufallszahlen), die Tabelle je Spieltag entsteht mit buildTable.
 */
import { SEASON } from '../config/season';
import type { Record3 } from '../types';
import { buildTable, type Goal, type Match, type SeasonResult, type TableRow, type UserMatch } from './season';

export interface Matchday {
  /** Spieltag (1-basiert) */
  round: number;
  /** Spiel des eigenen Teams an diesem Spieltag */
  match: UserMatch;
  /** Bilanz bis einschließlich dieses Spieltags */
  record: Record3;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Tabellenplatz nach diesem Spieltag (1-basiert) */
  position: number;
  /** Veränderung gegenüber dem Vorspieltag – positiv = geklettert, am 1. Spieltag 0 */
  positionDelta: number;
  /** Die ersten 4 der Tabelle nach diesem Spieltag */
  top: TableRow[];
  /** Tabellenzeile des eigenen Teams */
  userRow: TableRow;
  /** Siege in Folge (endet mit diesem Spieltag) */
  winStreak: number;
  /** Spiele ohne Niederlage in Folge (endet mit diesem Spieltag) */
  unbeatenRun: number;
  /** true, solange jedes Spiel gewonnen wurde */
  perfectAlive: boolean;
  /** Spieltag des ersten Nicht-Siegs oder null */
  perfectBrokenAt: number | null;
}

/** Wie viele Teams die Mini-Tabelle oben zeigt. */
export const TOP_ROWS = 4;

/** Verlauf aller Spieltage (aufsteigend). Die letzte Zeile entspricht der Saisonbilanz. */
export function seasonTimeline(season: SeasonResult): Matchday[] {
  const { teams, matches } = season.league;
  const byRound = new Map<number, Match[]>();
  for (const m of matches) {
    const list = byRound.get(m.round);
    if (list) list.push(m);
    else byRound.set(m.round, [m]);
  }
  const userByRound = new Map(season.userMatches.map((m) => [m.round, m]));
  const rounds = [...byRound.keys()].sort((a, b) => a - b);

  const played: Match[] = [];
  const record: Record3 = { w: 0, d: 0, l: 0 };
  let goalsFor = 0;
  let goalsAgainst = 0;
  let winStreak = 0;
  let unbeatenRun = 0;
  let perfectBrokenAt: number | null = null;
  let prevPosition: number | null = null;
  const out: Matchday[] = [];

  for (const round of rounds) {
    played.push(...byRound.get(round)!);
    const match = userByRound.get(round);
    // Spielfrei (nur bei ungerader Teamzahl möglich) – Tabelle läuft trotzdem weiter
    if (!match) continue;

    if (match.outcome === 'S') record.w++;
    else if (match.outcome === 'U') record.d++;
    else record.l++;
    goalsFor += match.gf;
    goalsAgainst += match.ga;
    winStreak = match.outcome === 'S' ? winStreak + 1 : 0;
    unbeatenRun = match.outcome === 'N' ? 0 : unbeatenRun + 1;
    if (match.outcome !== 'S' && perfectBrokenAt == null) perfectBrokenAt = round;

    const table = buildTable(teams, played);
    const index = table.findIndex((r) => r.isUser);
    const position = index + 1;
    out.push({
      round,
      match,
      record: { ...record },
      points: record.w * SEASON.points.win + record.d * SEASON.points.draw + record.l * SEASON.points.loss,
      goalsFor,
      goalsAgainst,
      position,
      positionDelta: prevPosition == null ? 0 : prevPosition - position,
      top: table.slice(0, TOP_ROWS),
      userRow: table[index],
      winStreak,
      unbeatenRun,
      perfectAlive: perfectBrokenAt == null,
      perfectBrokenAt,
    });
    prevPosition = position;
  }
  return out;
}

/** Ein Schritt des Live-Tickers (siehe tickerStep). */
export interface TickerStep {
  /** Gespielte Spieltage (0…total) – Fortschritt, Bilanz, Tabelle, Tracker */
  played: number;
  /** Abpfiff statt Anzeigetafel */
  finale: boolean;
  /** Nach Ablauf dieses Schritts: nächster Schritt oder 'done' (zur Saisonbilanz) */
  next: number | 'done';
}

/**
 * Ablauf des Live-Tickers bei `total` Spieltagen:
 *   0            Anpfiff (Paarung des 1. Spieltags ohne Ergebnis)
 *   1 … total    Anzeigetafel des k-ten Spieltags – auch des letzten
 *   total + 1    Abpfiff, danach geht es zur Saisonbilanz
 */
export function tickerStep(step: number, total: number): TickerStep {
  const finale = step > total;
  return { played: Math.max(0, Math.min(step, total)), finale, next: finale ? 'done' : step + 1 };
}

/** Torschützen eines Spiels als Text: „Glurak 2×, Pikachu (Standard)". */
export function scorerSummary(scorers: Goal[], nameOf: (pokemonId: number) => string): string {
  return scorerGroups(scorers, nameOf)
    .map((g) => (g.goals > 1 ? `${g.label} ${g.goals}×` : g.label))
    .join(', ');
}

export interface ScorerGroup {
  pokemonId: number;
  /** Anzeigename inkl. „(Standard)" beim Standardschützen */
  label: string;
  goals: number;
  setPiece: boolean;
}

/** Fasst die Tore eines Spiels je Schütze zusammen (Reihenfolge des ersten Treffers). */
export function scorerGroups(scorers: Goal[], nameOf: (pokemonId: number) => string): ScorerGroup[] {
  const groups = new Map<string, ScorerGroup>();
  for (const g of scorers) {
    const setPiece = g.pos === 'SS';
    const label = nameOf(g.pokemonId) + (setPiece ? ' (Standard)' : '');
    const cur = groups.get(label);
    if (cur) cur.goals++;
    else groups.set(label, { pokemonId: g.pokemonId, label, goals: 1, setPiece });
  }
  return [...groups.values()];
}
