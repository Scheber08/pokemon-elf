import { localLeaderboard } from './local';
import type { LeaderboardService } from './types';

export * from './types';

/**
 * Lokale Run-Historie dieses Browsers. Die Online-Rangliste läuft über das
 * Cloudflare-Backend (src/lib/api/client.ts).
 */
export const leaderboard: LeaderboardService = localLeaderboard;
