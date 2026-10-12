import { localLeaderboard } from './local';
import { createRemoteLeaderboard } from './remote';
import type { LeaderboardService } from './types';

export * from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Aktive Rangliste: Supabase, wenn konfiguriert – sonst lokal. */
export const leaderboard: LeaderboardService = url && key ? createRemoteLeaderboard(url, key) : localLeaderboard;
