/**
 * Vorlage für eine Online-Rangliste über Supabase (PostgREST), ohne zusätzliche Abhängigkeit.
 * Aktivierung: VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY setzen (siehe README).
 *
 * Erwartete Tabelle `runs` (SQL im README). Anmeldung: Supabase Auth – das Access-Token
 * wird unter `sessionStorage['pokemon-elf:sb-token']` erwartet. Ohne Token sind nur
 * Lesezugriffe möglich („Anmelden, um auf der Rangliste zu spielen").
 */
import { bestPerPlayer, type LeaderboardEntry, type LeaderboardService, type NewEntry } from './types';

interface Row {
  id: string;
  challenge: LeaderboardEntry['challenge'];
  player: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  score: number;
  formation: LeaderboardEntry['formation'];
  lineup: (number | null)[];
  team_name: string;
  created_at: string;
}

const toEntry = (r: Row): LeaderboardEntry => ({
  id: r.id,
  challenge: r.challenge,
  player: r.player,
  record: { w: r.wins, d: r.draws, l: r.losses },
  points: r.points,
  score: r.score,
  formation: r.formation,
  lineup: r.lineup,
  teamName: r.team_name,
  createdAt: r.created_at,
});

export function createRemoteLeaderboard(baseUrl: string, anonKey: string): LeaderboardService {
  const token = () => {
    try {
      return sessionStorage.getItem('pokemon-elf:sb-token');
    } catch {
      return null;
    }
  };
  const headers = (): HeadersInit => ({
    apikey: anonKey,
    Authorization: `Bearer ${token() ?? anonKey}`,
    'Content-Type': 'application/json',
  });
  const rest = `${baseUrl.replace(/\/$/, '')}/rest/v1/runs`;

  return {
    kind: 'remote',
    requiresLogin: true,
    isLoggedIn: () => !!token(),

    async submit(entry: NewEntry) {
      const res = await fetch(rest, {
        method: 'POST',
        headers: { ...headers(), Prefer: 'return=representation' },
        body: JSON.stringify({
          challenge: entry.challenge,
          player: entry.player,
          wins: entry.record.w,
          draws: entry.record.d,
          losses: entry.record.l,
          points: entry.points,
          score: entry.score,
          formation: entry.formation,
          lineup: entry.lineup,
          team_name: entry.teamName,
        }),
      });
      if (!res.ok) throw new Error(`Rangliste: HTTP ${res.status}`);
      const [row] = (await res.json()) as Row[];
      return toEntry(row);
    },

    async rename(id: string, player: string) {
      await fetch(`${rest}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ player }),
      });
    },

    async top(challenge, period, limit = 50) {
      const params = new URLSearchParams({
        challenge: `eq.${challenge}`,
        order: 'points.desc,score.desc,created_at.asc',
        limit: '1000',
      });
      if (period === 'today') {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        params.set('created_at', `gte.${start.toISOString()}`);
      }
      const res = await fetch(`${rest}?${params}`, { headers: headers() });
      if (!res.ok) throw new Error(`Rangliste: HTTP ${res.status}`);
      return bestPerPlayer(((await res.json()) as Row[]).map(toEntry)).slice(0, limit);
    },
  };
}
