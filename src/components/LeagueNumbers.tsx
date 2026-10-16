import { useT } from '../i18n';
import { leagueNumbers } from '../lib/leagueTimeline';
import type { LeagueResult } from '../lib/season';

/** Über den Saisonrekorden: die Liga in Zahlen (online und lokal). */
export function LeagueNumbers({ matches }: { matches: LeagueResult['matches'] }) {
  const t = useT();
  const n = leagueNumbers(matches);
  if (!n.games) return null;
  return <p className="small muted league-numbers">{t.draft.results.leagueNumbers(n.games, n.goals, n.goals / n.games, n.draws, n.cleanSheets)}</p>;
}
