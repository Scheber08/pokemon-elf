import { useMemo } from 'react';
import { useT } from '../i18n';
import { goalsByType } from '../lib/leagueTimeline';
import type { LeagueResult } from '../lib/season';
import type { Pokemon, TypeKey } from '../types';
import { TypeBadge } from './Badges';

/** Meistgedrafteter Typ (Doppeltypen zählen für beide), nur bei eindeutigem Höchstwert */
export function draftTypeOf(ids: readonly number[], byId: Map<number, Pick<Pokemon, 'types'>>): { type: TypeKey; n: number } | null {
  const counts = new Map<TypeKey, number>();
  for (const id of ids) for (const ty of new Set(byId.get(id)?.types ?? [])) counts.set(ty, (counts.get(ty) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return null;
  return { type: ranked[0][0], n: ranked[0][1] };
}

/**
 * Unter der Torjägerliste: die drei Typen mit den meisten Toren der Liga und – mit `picked` (alle gedrafteten
 * Pokémon) – der „Typ des Drafts“ (online und lokal).
 */
export function TypeGoals({ matches, byId, picked }: { matches: LeagueResult['matches']; byId: Map<number, Pokemon>; picked?: readonly number[] }) {
  const t = useT();
  const top = useMemo(() => goalsByType(matches, byId), [matches, byId]);
  const drafted = useMemo(() => (picked ? draftTypeOf(picked, byId) : null), [picked, byId]);
  if (!top.length && !drafted) return null;
  return (
    <>
      {drafted && (
        <p className="draft-type small">
          <span className="muted">{t.draft.results.draftType}</span>
          <span className="draft-type__item">
            <TypeBadge type={drafted.type} small /> <strong>{t.draft.results.draftTypeCount(drafted.n)}</strong>
          </span>
        </p>
      )}
      {top.length > 0 && <TypeGoalsLine top={top} />}
    </>
  );
}

function TypeGoalsLine({ top }: { top: { type: TypeKey; goals: number }[] }) {
  const t = useT();
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
