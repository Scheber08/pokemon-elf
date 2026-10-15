import { useMemo } from 'react';
import { useT } from '../i18n';
import { goalsByType } from '../lib/leagueTimeline';
import type { LeagueResult } from '../lib/season';
import type { Pokemon } from '../types';
import { TypeBadge } from './Badges';

/** Unter der Torjägerliste: die drei Typen mit den meisten Toren der Liga (online und lokal). */
export function TypeGoals({ matches, byId }: { matches: LeagueResult['matches']; byId: Map<number, Pokemon> }) {
  const t = useT();
  const top = useMemo(() => goalsByType(matches, byId), [matches, byId]);
  if (!top.length) return null;
  return (
    <p className="type-goals small">
      <span className="muted">{t.draft.results.typeGoals}</span>
      {top.map((x) => (
        <span key={x.type} className="type-goals__item">
          <TypeBadge type={x.type} small /> <strong>{x.goals}</strong>
        </span>
      ))}
    </p>
  );
}
