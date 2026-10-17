/**
 * Erfolge: Der Server rechnet aus Runs, Ranglisten und fertigen Online-Ligen eines Geräts die
 * Kennzahlen (AchievementStats, server/achievements.ts) und daraus mit diesen Definitionen, welche
 * Erfolge erreicht sind. Jeder Erfolg bringt Münzen – dafür gibt es Cosmetics für den Trainer.
 * Texte: t.achievements.list[id] (DE/EN).
 */
import type { ChallengeKey } from '../types';

/** Kennzahlen eines Geräts (vom Server) */
export interface AchievementStats {
  /** Gewertete Runs insgesamt */
  runs: number;
  /** Je Wertung: beste Siegzahl und perfekte Saisons (nur Siege) */
  challenges: Partial<Record<ChallengeKey, { runs: number; bestWins: number; perfect: number }>>;
  /** Tage mit gewerteter Täglicher Elf … */
  dailyDays: number;
  /** … und die längste Serie aufeinanderfolgender Tage */
  dailyStreak: number;
  /** Tage als Platz 1 der Tageswertung */
  dailyWins: number;
  /** Bester Allzeit-Platz über alle Wertungen (null = keiner) */
  bestPlace: number | null;
  /** Fertige Online-Ligen: gespielt, Meister (Liga), Turniersiege, Manager-Meister, Podestplätze (1–3) */
  draft: {
    leagues: number;
    titles: number;
    cups: number;
    manager: number;
    podiums: number;
    /** Ligen bzw. Manager-Saisons ohne Niederlage (fehlt bei älteren Antworten = 0) */
    unbeaten?: number;
    /** Gespielte Manager-Saisons (fehlt bei älteren Antworten = 0) */
    seasons?: number;
    /** Manager-Saisons auf Platz 1–3 (fehlt bei älteren Antworten = 0) */
    managerPodiums?: number;
    /** Pokalsiege in der Manager-Saison (fehlt bei älteren Antworten = 0) */
    managerCups?: number;
    /** Gezogene Shinys in fertigen Online-Ligen (fehlt bei älteren Antworten = 0) */
    shinies?: number;
    /** Meiste Tore eines eigenen Kapitäns in einer Online-Saison */
    captainGoals?: number;
    /** Meiste Blitz-Picks (⚡) in einer Online-Liga */
    blitz?: number;
    /** Meiste Spiele ohne Gegentor in einer Online-Liga bzw. Manager-Saison */
    cleanSheets?: number;
    /** Meiste eigene Tore in einer Online-Liga bzw. Manager-Saison */
    mostGoals?: number;
    /** Eigene Hattricks in Online-Ligen bzw. Manager-Saisons (Summe) */
    hatTricks?: number;
    /** Meiste gemeinsame Tore eines Vorlage → Tor-Paars in einer Liga */
    duo?: number;
    /** Längste Siegesserie in einer Liga */
    winStreak?: number;
    /** Höchster Sieg (Tordifferenz) in einer Online-Liga bzw. Manager-Saison */
    bigWin?: number;
    /** Erreichte Saisonziele in Online-Ligen */
    goalsReached?: number;
  };
}

export type AchievementCategory = 'challenge' | 'daily' | 'ranking' | 'draft';

export interface AchievementDef {
  id: string;
  category: AchievementCategory;
  /** Münzen beim Erreichen */
  coins: number;
  /** Ziel (Fortschritt = Wert / Ziel) */
  goal: number;
  /** Aktueller Wert – erreicht, sobald er das Ziel erreicht */
  value: (s: AchievementStats) => number;
}

const wins = (c: ChallengeKey) => (s: AchievementStats) => s.challenges[c]?.bestWins ?? 0;
const perfect = (c: ChallengeKey) => (s: AchievementStats) => s.challenges[c]?.perfect ?? 0;
/** Platz als Wert: erreicht, wenn der beste Platz höchstens `max` ist */
const placeAtMost = (max: number) => (s: AchievementStats) => (s.bestPlace != null && s.bestPlace <= max ? 1 : 0);

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Challenges
  { id: 'first_run', category: 'challenge', coins: 50, goal: 1, value: (s) => s.runs },
  { id: 'runs_10', category: 'challenge', coins: 100, goal: 10, value: (s) => s.runs },
  { id: 'runs_50', category: 'challenge', coins: 250, goal: 50, value: (s) => s.runs },
  { id: 'runs_200', category: 'challenge', coins: 600, goal: 200, value: (s) => s.runs },
  { id: 'runs_500', category: 'challenge', coins: 1200, goal: 500, value: (s) => s.runs },
  { id: 'c340_25', category: 'challenge', coins: 100, goal: 25, value: wins('c340') },
  { id: 'c340_30', category: 'challenge', coins: 200, goal: 30, value: wins('c340') },
  { id: 'c340_perfect', category: 'challenge', coins: 500, goal: 1, value: perfect('c340') },
  { id: 'retro340_25', category: 'challenge', coins: 100, goal: 25, value: wins('retro340') },
  { id: 'retro340_30', category: 'challenge', coins: 200, goal: 30, value: wins('retro340') },
  { id: 'retro340_perfect', category: 'challenge', coins: 500, goal: 1, value: perfect('retro340') },
  { id: 'c151_25', category: 'challenge', coins: 100, goal: 25, value: wins('c151') },
  { id: 'c151_30', category: 'challenge', coins: 200, goal: 30, value: wins('c151') },
  { id: 'c151_perfect', category: 'challenge', coins: 500, goal: 1, value: perfect('c151') },
  // Tägliche Elf
  { id: 'daily_1', category: 'daily', coins: 50, goal: 1, value: (s) => s.dailyDays },
  { id: 'daily_streak_3', category: 'daily', coins: 100, goal: 3, value: (s) => s.dailyStreak },
  { id: 'daily_streak_7', category: 'daily', coins: 250, goal: 7, value: (s) => s.dailyStreak },
  { id: 'daily_streak_14', category: 'daily', coins: 450, goal: 14, value: (s) => s.dailyStreak },
  { id: 'daily_streak_30', category: 'daily', coins: 800, goal: 30, value: (s) => s.dailyStreak },
  { id: 'daily_win', category: 'daily', coins: 300, goal: 1, value: (s) => s.dailyWins },
  { id: 'daily_win_5', category: 'daily', coins: 600, goal: 5, value: (s) => s.dailyWins },
  // Rangliste
  { id: 'top_100', category: 'ranking', coins: 100, goal: 1, value: placeAtMost(100) },
  { id: 'top_10', category: 'ranking', coins: 300, goal: 1, value: placeAtMost(10) },
  { id: 'top_1', category: 'ranking', coins: 1000, goal: 1, value: placeAtMost(1) },
  // Online-Draft
  { id: 'draft_first', category: 'draft', coins: 100, goal: 1, value: (s) => s.draft.leagues },
  { id: 'draft_5', category: 'draft', coins: 250, goal: 5, value: (s) => s.draft.leagues },
  { id: 'draft_20', category: 'draft', coins: 600, goal: 20, value: (s) => s.draft.leagues },
  { id: 'draft_50', category: 'draft', coins: 1200, goal: 50, value: (s) => s.draft.leagues },
  { id: 'draft_podium', category: 'draft', coins: 150, goal: 1, value: (s) => s.draft.podiums },
  { id: 'draft_title', category: 'draft', coins: 300, goal: 1, value: (s) => s.draft.titles },
  { id: 'draft_cup', category: 'draft', coins: 300, goal: 1, value: (s) => s.draft.cups },
  { id: 'manager_first', category: 'draft', coins: 150, goal: 1, value: (s) => s.draft.seasons ?? 0 },
  { id: 'manager_podium', category: 'draft', coins: 250, goal: 1, value: (s) => s.draft.managerPodiums ?? 0 },
  { id: 'shiny_first', category: 'draft', coins: 150, goal: 1, value: (s) => s.draft.shinies ?? 0 },
  { id: 'manager_cup', category: 'draft', coins: 350, goal: 1, value: (s) => s.draft.managerCups ?? 0 },
  { id: 'shiny_5', category: 'draft', coins: 500, goal: 5, value: (s) => s.draft.shinies ?? 0 },
  { id: 'captain_10', category: 'draft', coins: 300, goal: 10, value: (s) => s.draft.captainGoals ?? 0 },
  { id: 'blitz_5', category: 'draft', coins: 150, goal: 5, value: (s) => s.draft.blitz ?? 0 },
  { id: 'clean_10', category: 'draft', coins: 250, goal: 10, value: (s) => s.draft.cleanSheets ?? 0 },
  { id: 'goals_80', category: 'draft', coins: 250, goal: 80, value: (s) => s.draft.mostGoals ?? 0 },
  { id: 'hattrick_1', category: 'draft', coins: 150, goal: 1, value: (s) => s.draft.hatTricks ?? 0 },
  { id: 'duo_5', category: 'draft', coins: 200, goal: 5, value: (s) => s.draft.duo ?? 0 },
  { id: 'streak_7', category: 'draft', coins: 300, goal: 7, value: (s) => s.draft.winStreak ?? 0 },
  { id: 'rout_5', category: 'draft', coins: 200, goal: 5, value: (s) => s.draft.bigWin ?? 0 },
  { id: 'goal_reached', category: 'draft', coins: 150, goal: 1, value: (s) => s.draft.goalsReached ?? 0 },
  { id: 'manager_5', category: 'draft', coins: 400, goal: 5, value: (s) => s.draft.seasons ?? 0 },
  { id: 'draft_manager', category: 'draft', coins: 400, goal: 1, value: (s) => s.draft.manager },
  { id: 'draft_unbeaten', category: 'draft', coins: 500, goal: 1, value: (s) => s.draft.unbeaten ?? 0 },
  { id: 'draft_titles_3', category: 'draft', coins: 800, goal: 3, value: (s) => s.draft.titles + s.draft.cups + s.draft.manager },
];

export const ACHIEVEMENT_CATEGORIES: readonly AchievementCategory[] = ['challenge', 'daily', 'ranking', 'draft'];

/** Stand eines Erfolgs für die Anzeige */
export interface AchievementState {
  id: string;
  done: boolean;
  /** Wert (höchstens das Ziel) und Ziel */
  value: number;
  goal: number;
  coins: number;
}

export function achievementStates(stats: AchievementStats): AchievementState[] {
  return ACHIEVEMENTS.map((a) => {
    const v = Math.max(0, Math.floor(a.value(stats)));
    return { id: a.id, done: v >= a.goal, value: Math.min(v, a.goal), goal: a.goal, coins: a.coins };
  });
}

/** Verdiente Münzen (Summe der erreichten Erfolge) */
export function earnedCoins(stats: AchievementStats): number {
  return achievementStates(stats).reduce((n, a) => n + (a.done ? a.coins : 0), 0);
}

/** Längste Serie aufeinanderfolgender Tage ('YYYY-MM-DD', beliebige Reihenfolge, Doppelte egal). */
export function longestDayStreak(days: readonly string[]): number {
  const nums = [...new Set(days)]
    .map((d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < nums.length; i++) {
    run = i > 0 && nums[i] - nums[i - 1] === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}
