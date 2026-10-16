/** Texts: daily (English). Must have exactly the keys of ../de/daily.ts (checked by TypeScript). */
import type { Messages } from '../de';
import { fmtNumber } from '../lang';

/** 1 → „1st", 2 → „2nd", 11 → „11th", 23 → „23rd" */
function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

const daily: Messages['daily'] = {
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  dayLong: (weekday, date) => `${weekday}, ${date}`,
  howTo:
    'The same rolls for everyone, every day: region and type are rolled each round – just like the 34–0 Challenge, with no more than 2 Legendaries and one reroll each for type and region. You get one attempt per day. Same XI, same result – the season is identical for everyone. Can you go 34–0?',
  lead: 'A new XI every day – the same rolls for everyone.',
  countdownLabel: 'New XI in',
  netChecking: 'Checking connection …',
  netOnline: 'Online – your attempt goes on today’s leaderboard',
  netOffline: 'Offline – unranked. You still only get one attempt per day.',
  ranked: 'Ranked',
  offlineUnranked: 'Offline – unranked',
  unranked: 'Unranked',
  copied: 'Result copied',
  copyFailed: 'Couldn’t copy',
  shareTitle: (n) => `Share Daily XI #${n}`,
  shareButton: 'Share result',
  toBoard: 'Today’s leaderboard',
  playedTitle: 'Already played today',
  playedText: (n) =>
    `You’ve used your ranked attempt for Daily XI #${n}. Tomorrow brings new rolls – the same for everyone again.`,
  streak: 'Streak',
  streakDays: (n) => (n === 1 ? '1 day' : `${n} days`),
  bestStreak: 'Best streak',
  bestDay: 'Best day',
  bestDayAvg: (avg) => `avg ${avg}`,
  bestDayTitle: (n, avg) => `Most points on one day (Daily XI #${n}) – ${avg} points on average`,
  played: 'Played',
  streakHint: 'Play today or your streak ends.',
  archive: 'Your recent days',
  archiveNote: 'Saved on this device.',
  bestWeekday: (day: string, avg: number, n: number) => `Your best weekday: ${day} (avg ${avg} pts from ${n} games)`,
  archiveRow: (n) => `#${n}`,
  archiveTrend: (diff) => `${diff > 0 ? '+' : '−'}${Math.abs(diff)} points vs. the previous day`,
  archivePlace: (n) => `${ordinal(n)} place`,
  factRank: 'Position',
  factRecord: 'Record',
  factPoints: 'Points',
  factScore: 'Score',
  rankValue: (n) => ordinal(n),
  topPercent: (n) => `top ${n}%`,
  playersToday: (n) => `${fmtNumber(n, 0, 'en')} ${n === 1 ? 'player' : 'players'} today`,
  yourTeam: (name) => ` · your team: ${name}`,
  newDailyReady: (n) => `The new Daily XI #${n} is here!`,
  playNow: 'Play now',
  stillCountsFor: (date) => `The new XI is already out – this run still counts for ${date}.`,
  discardConfirm: (date) => `Discard the run from ${date}? It will no longer be ranked.`,
  discardButton: 'Discard and play today’s XI',
  playOffline: 'Play offline (unranked – uses today’s attempt)',
  oneAttempt: 'One attempt per day: once started, a run can’t be cancelled or restarted.',
  shareHeader: (n, date) => `Pokémon Elf · Daily XI #${n} (${date})`,
  shareStreak: (n) => `🔥 ${n} days in a row`,
  shareStats: (record, points, score, position) => `${record} · ${points} pts · Score ${score} · ${ordinal(position)} place`,
};

export default daily;
