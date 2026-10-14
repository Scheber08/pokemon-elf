/**
 * Live-Spieltag der Manager-Saison: Der Server spielt den Spieltag zum Anpfiff komplett aus, die
 * Anzeige lässt ihn danach in Echtzeit ablaufen – alle sehen dasselbe, weil die Minute aus der
 * Serverzeit kommt. Tore erscheinen zu ihrer Spielminute. Reine Anzeige, das Ergebnis steht fest.
 */
import type { Match } from './season';

/** So lange läuft ein Spieltag live (höchstens 40 % des Takts) */
export const LIVE_MATCHDAY_MS = 4 * 60_000;

export function liveDuration(stepMs: number): number {
  return Math.min(LIVE_MATCHDAY_MS, Math.floor(stepMs * 0.4));
}

/** Aktuelle Spielminute (1–90) – null, wenn der Spieltag (noch nicht bzw. nicht mehr) live ist. */
export function liveMinute(kickoff: number, now: number, durationMs: number): number | null {
  const elapsed = now - kickoff;
  if (elapsed < 0 || elapsed >= durationMs || durationMs <= 0) return null;
  return Math.min(90, Math.max(1, Math.floor((elapsed / durationMs) * 90) + 1));
}

/** Spiel bis zur Minute: nur Tore bis dahin (ohne Minute zählen sie erst am Ende), Statistik erst danach. */
export function partialMatch(m: Match, minute: number): Match {
  const upTo = (g: { minute?: number }) => (g.minute ?? 91) <= minute;
  const homeScorers = m.homeScorers.filter(upTo);
  const awayScorers = m.awayScorers.filter(upTo);
  // Tore ohne Torschützen (Vereine) gleichmäßig über die Spielzeit verteilt
  const unnamed = (goals: number, named: number) => {
    const rest = goals - named;
    return rest > 0 ? Math.floor((rest * minute) / 90) : 0;
  };
  const { stats: _stats, ...rest } = m;
  return {
    ...rest,
    hg: homeScorers.length + unnamed(m.hg, m.homeScorers.length),
    ag: awayScorers.length + unnamed(m.ag, m.awayScorers.length),
    homeScorers,
    awayScorers,
  };
}
