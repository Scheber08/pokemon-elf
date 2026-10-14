/**
 * 2D-Wiedergabe eines Spiels von oben: aus Ergebnis, Torminuten, Schützen, Vorlagen und Statistik
 * (Match) wird deterministisch ein Ablauf – Ballwege (Keyframes) und Ereignisse (Tore, Schüsse).
 * Das Spiel selbst ändert sich dadurch nicht; die Wiedergabe ist eine Illustration.
 * Koordinaten in Metern: Feld 105 × 68, das Heimteam spielt nach rechts.
 */
import { FORMATIONS } from '../config/formations';
import type { FormationId, PosCode } from '../types';
import { jerseyNumbers, type Jerseys } from './jerseys';
import { createRng, hashSeed, type Rng } from './rng';
import type { Match } from './season';

export const PITCH_W = 105;
export const PITCH_H = 68;

/** Aufstellung eines Teams für die Wiedergabe (Pokémon-IDs in Reihenfolge der Formation) */
export interface ReplayLineup {
  formation: FormationId;
  ids: (number | null)[];
  /** Eigene Trikotnummern des Teams (fehlt: Vorgabe nach Position) */
  jerseys?: Jerseys;
  /** Kapitän (Pokémon-ID) */
  captain?: number | null;
}

export interface ReplayPlayer {
  /** 0 = Heim, 1 = Gast */
  side: 0 | 1;
  slot: number;
  pokemonId: number | null;
  pos: PosCode;
  /** Trikotnummer */
  number: number;
  /** Trägt die Kapitänsbinde */
  captain: boolean;
  /** Grundposition (Meter) */
  x: number;
  y: number;
}

export interface BallKey {
  /** Spielminute */
  t: number;
  x: number;
  y: number;
}

export interface ReplayEvent {
  t: number;
  side: 0 | 1;
  kind: 'goal' | 'shot';
  /** Schütze bzw. Vorlage (Pokémon-ID, falls bekannt) */
  scorer: number | null;
  assist: number | null;
  /** Spieler (Index in players), der schießt */
  shooter: number;
}

export interface Replay {
  players: ReplayPlayer[];
  keys: BallKey[];
  events: ReplayEvent[];
  /** Letzte Minute der Wiedergabe */
  end: number;
}

/** Ohne bekannte Aufstellung (Vereine): eine 4-4-2 ohne Pokémon */
const GENERIC: ReplayLineup = { formation: '4-4-2', ids: Array<null>(11).fill(null) };

/** Grundposition eines Formations-Slots (Prozent) auf dem Feld (Meter) */
function basePos(side: 0 | 1, x: number, y: number): { x: number; y: number } {
  const bx = ((100 - y) / 100) * 60;
  const by = 4 + (x / 100) * (PITCH_H - 8);
  return side === 0 ? { x: bx, y: by } : { x: PITCH_W - bx, y: PITCH_H - by };
}

const defsOf = (lineup: ReplayLineup) => FORMATIONS[lineup.formation]?.slots ?? FORMATIONS['4-4-2'].slots;
/** Ohne Pokémon (Vereine): Platzhalter-IDs je Slot, damit jeder eine Vorgabe-Nummer bekommt */
const keyOf = (lineup: ReplayLineup, slot: number) => lineup.ids[slot] ?? -1 - slot;

/** Trikotnummern einer Aufstellung (Pokémon-ID → Nummer) – wie in der 2D-Ansicht */
export function lineupNumbers(lineup: ReplayLineup): Map<number, number> {
  return jerseyNumbers(defsOf(lineup).map((d, slot) => ({ pokemonId: keyOf(lineup, slot), pos: d.pos })), lineup.jerseys ?? {});
}

function playersOf(side: 0 | 1, lineup: ReplayLineup): ReplayPlayer[] {
  const defs = defsOf(lineup);
  const numbers = lineupNumbers(lineup);
  return defs.map((d, slot) => ({
    side,
    slot,
    pokemonId: lineup.ids[slot] ?? null,
    pos: d.pos,
    number: numbers.get(keyOf(lineup, slot)) ?? slot + 1,
    captain: lineup.captain != null && lineup.ids[slot] === lineup.captain,
    ...basePos(side, d.x, d.y),
  }));
}

/** Verschiebung beider Teams mit dem Ball (Meter in x-Richtung) */
export function teamShift(ballX: number): number {
  return (ballX - PITCH_W / 2) * 0.35;
}

/** Position eines Spielers zur Minute t bei gegebener Ballposition – Grundposition, Verschiebung, leichtes Pendeln */
export function playerAt(p: ReplayPlayer, t: number, ballX: number): { x: number; y: number } {
  const keeper = p.pos === 'TW';
  const shift = keeper ? teamShift(ballX) * 0.15 : teamShift(ballX);
  const wobble = keeper ? 0.4 : 1.6;
  const x = p.x + shift + Math.sin(t * 1.7 + p.slot * 1.3 + p.side * 2.1) * wobble;
  const y = p.y + Math.cos(t * 1.3 + p.slot * 0.9 + p.side) * wobble;
  return { x: Math.min(PITCH_W - 1, Math.max(1, x)), y: Math.min(PITCH_H - 1, Math.max(1, y)) };
}

/** Ballposition zur Minute t (zwischen den Keyframes linear) */
export function ballAt(keys: readonly BallKey[], t: number): { x: number; y: number } {
  if (!keys.length) return { x: PITCH_W / 2, y: PITCH_H / 2 };
  if (t <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b.t) {
      const a = keys[i - 1];
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return keys[keys.length - 1];
}

/** Gewicht eines Spielers als Ballbesitzer (Mittelfeld oft, Torwart selten) */
const holdWeight = (pos: PosCode) => (pos === 'TW' ? 0.15 : ['IV', 'LV', 'RV', 'LWB', 'RWB'].includes(pos) ? 0.8 : 1.2);
const ATTACK: readonly PosCode[] = ['ST', 'LF', 'RF', 'OM'];

function pickWeighted(rng: Rng, items: number[], weight: (i: number) => number): number {
  const total = items.reduce((n, i) => n + weight(i), 0);
  let x = rng() * total;
  for (const i of items) {
    x -= weight(i);
    if (x < 0) return i;
  }
  return items[items.length - 1];
}

/**
 * Ablauf eines Spiels. lineups: Aufstellung je Seite (fehlt: 4-4-2 ohne Pokémon). Gleiches Spiel →
 * gleicher Ablauf (Seed aus Spieltag, Teams und Ergebnis).
 */
export function buildReplay(match: Match, lineups: [ReplayLineup | null, ReplayLineup | null]): Replay {
  const rng = createRng(hashSeed('replay', match.round, match.home, match.away, match.hg, match.ag));
  const players = [...playersOf(0, lineups[0] ?? GENERIC), ...playersOf(1, lineups[1] ?? GENERIC)];
  const of = (side: 0 | 1) => players.map((_, i) => i).filter((i) => players[i].side === side);
  const findPlayer = (side: 0 | 1, id: number | null | undefined) =>
    id == null ? -1 : players.findIndex((p) => p.side === side && p.pokemonId === id);
  const attacker = (side: 0 | 1) => {
    const att = of(side).filter((i) => ATTACK.includes(players[i].pos));
    return att.length ? att[Math.floor(rng() * att.length)] : of(side)[10];
  };

  // Ereignisse: Tore (mit Minute), dazu Schüsse ohne Tor aus der Statistik (höchstens 10 je Seite)
  const events: ReplayEvent[] = [];
  const taken: number[] = [];
  const freeMinute = () => {
    for (let k = 0; k < 20; k++) {
      const m = 2 + rng() * 86;
      if (taken.every((x) => Math.abs(x - m) > 2.5)) return m;
    }
    return 2 + rng() * 86;
  };
  ([0, 1] as const).forEach((side) => {
    const goals = side === 0 ? match.homeScorers : match.awayScorers;
    const count = side === 0 ? match.hg : match.ag;
    for (let g = 0; g < count; g++) {
      const goal = goals[g];
      const t = goal?.minute ?? freeMinute();
      taken.push(t);
      const shooter = findPlayer(side, goal?.pokemonId);
      events.push({ t, side, kind: 'goal', scorer: goal?.pokemonId ?? null, assist: goal?.assist ?? null, shooter: shooter >= 0 ? shooter : attacker(side) });
    }
  });
  ([0, 1] as const).forEach((side) => {
    const shots = match.stats ? match.stats.shots[side] - (side === 0 ? match.hg : match.ag) : Math.round(4 + rng() * 6);
    for (let s = 0; s < Math.min(10, Math.max(0, shots)); s++) {
      const t = freeMinute();
      taken.push(t);
      events.push({ t, side, kind: 'shot', scorer: null, assist: null, shooter: attacker(side) });
    }
  });
  events.sort((a, b) => a.t - b.t);
  const end = Math.max(90, ...events.map((e) => e.t + 1.5));

  // Ballwege: Ballbesitz-Phasen zwischen den Ereignissen, vor jedem Ereignis Vorlage → Schuss → Tor/Abschluss
  const homeShare = (match.stats?.possession ?? 50) / 100;
  const keys: BallKey[] = [{ t: 0, x: PITCH_W / 2, y: PITCH_H / 2 }];
  let t = 0;
  let ballX = PITCH_W / 2;
  const holderSpot = (i: number, at: number) => playerAt(players[i], at, ballX);
  const push = (at: number, x: number, y: number) => {
    // Zeiten nur vorwärts (zwei Tore in derselben Minute)
    keys.push({ t: Math.max(at, keys[keys.length - 1].t + 0.05), x, y });
    ballX = x;
  };
  for (const e of [...events, null]) {
    const until = e ? e.t - 1.2 : end;
    while (t + 0.6 < until) {
      t += 0.6 + rng() * 1.1;
      if (t >= until) break;
      const side: 0 | 1 = rng() < homeShare ? 0 : 1;
      const i = pickWeighted(rng, of(side), (j) => holdWeight(players[j].pos));
      const s = holderSpot(i, t);
      push(t, s.x, s.y);
    }
    if (!e) break;
    const dir = e.side === 0 ? 1 : -1;
    const goalX = e.side === 0 ? PITCH_W : 0;
    // Vorlage bzw. Aufbau
    const assistIdx = findPlayer(e.side, e.assist);
    const prep = assistIdx >= 0 ? assistIdx : pickWeighted(rng, of(e.side).filter((j) => players[j].pos !== 'TW'), (j) => holdWeight(players[j].pos));
    const a = holderSpot(prep, e.t - 0.9);
    push(e.t - 0.9, Math.min(PITCH_W - 12, Math.max(12, a.x + dir * 14)), a.y);
    // Abschluss aus dem Strafraum
    const shotX = goalX - dir * (9 + rng() * 9);
    const shotY = PITCH_H / 2 + (rng() - 0.5) * 26;
    push(e.t - 0.35, shotX, shotY);
    if (e.kind === 'goal') {
      push(e.t, goalX + dir * 0.8, PITCH_H / 2 + (rng() - 0.5) * 5);
      // Anstoß
      push(e.t + 0.9, PITCH_W / 2, PITCH_H / 2);
      t = e.t + 0.9;
    } else {
      const saved = rng() < 0.55;
      push(e.t, goalX - dir * (saved ? 2 : 0.5), saved ? PITCH_H / 2 + (rng() - 0.5) * 4 : PITCH_H / 2 + (rng() < 0.5 ? -1 : 1) * (5 + rng() * 6));
      t = e.t;
    }
  }
  return { players, keys, events, end };
}
