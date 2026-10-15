import { useEffect, useRef } from 'react';
import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import { DRAFT_BENCH_SLOT, type DraftSnapshot, type DraftTeam } from '../lib/api/draftContract';
import { DRAFT_SS_SLOT, hasKind, isLegend, poolHasLegends, poolHasMegas, poolHasUltraBeasts } from '../lib/draftEngine';
import { teamLabel, type FeedItem } from '../state/useDraftRoom';
import type { Pokemon, PosCode } from '../types';
import { parseLook } from '../lib/trainer';
import { positionFit } from '../lib/fit';
import { usePokemonData } from '../state/PokemonData';
import { PosBadge, TypeBadge } from './Badges';
import { TrainerAvatar } from './TrainerAvatar';
import '../styles/draft.css';

/** Kleine Marker an einem Team: Online-Punkt, Host, CPU, Du. */
export function DraftTeamTags({ team, host, you }: { team: DraftTeam; host: boolean; you: boolean }) {
  const t = useT();
  const tx = t.draft.board;
  return (
    <span className="draft-tags">
      {!team.cpu && (
        <span
          className={`draft-dot ${team.online ? 'draft-dot--on' : ''}`}
          title={team.online ? tx.onlineTitle : tx.offlineTitle}
          aria-label={team.online ? tx.onlineAria : tx.offlineAria}
        />
      )}
      {host && <span className="draft-tag draft-tag--host">{t.draft.host}</span>}
      {team.cpu && <span className="draft-tag">{t.draft.cpu}</span>}
      {you && <span className="draft-tag draft-tag--you">{t.draft.you}</span>}
    </span>
  );
}

interface Props {
  state: DraftSnapshot;
  byId: Map<number, Pokemon>;
  /** Team am Zug */
  currentId: string | null;
}

/** Draft-Board: alle Teams als Spalten (Draft-Reihenfolge), der letzte Pick leuchtet. */
export function DraftBoard({ state, byId, currentId }: Props) {
  const t = useT();
  const { scale } = usePokemonData();
  const sc = scale('all');
  // Team am Zug ins Bild: nur die Tafel seitlich scrollen (die Seite selbst springt nicht)
  const boardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const board = boardRef.current;
    const col = board?.querySelector<HTMLElement>('.draft-board__col.is-current');
    if (!board || !col || board.scrollWidth <= board.clientWidth) return;
    // Die Tafel ist position: relative – offsetLeft der Spalte zählt also ab ihrem Rand
    const left = col.offsetLeft - (board.clientWidth - col.offsetWidth) / 2;
    board.scrollTo?.({ left: Math.max(0, left), behavior: 'smooth' });
  }, [currentId]);
  const last = state.picks.length ? state.picks[state.picks.length - 1] : null;
  const maxLegends = state.settings.maxLegends;
  const legendLimit = maxLegends != null && poolHasLegends(state.settings) ? maxLegends : null;
  const maxUltraBeasts = state.settings.maxUltraBeasts;
  const ultraBeastLimit = maxUltraBeasts != null && poolHasUltraBeasts(state.settings) ? maxUltraBeasts : null;
  const maxMegas = state.settings.maxMegas;
  const megaLimit = maxMegas != null && poolHasMegas(state.settings) ? maxMegas : null;
  return (
    <section className="draft__board draft-board" aria-label={t.draft.draftBoard} ref={boardRef}>
      {state.teams.map((team, i) => {
        const defs = FORMATIONS[team.formation].slots;
        const rows: { slot: number; pos: PosCode | null; id: number | null }[] = defs.map((d, j) => ({ slot: j, pos: d.pos, id: team.slots[j] }));
        if (state.settings.setPiece) rows.push({ slot: DRAFT_SS_SLOT, pos: 'SS', id: team.ss });
        // Manager-Saison: Bank (ohne feste Position)
        (team.bench ?? []).forEach((id, j) => rows.push({ slot: DRAFT_BENCH_SLOT + j, pos: null, id }));
        const filled = rows.filter((r) => r.id != null).length;
        const legends = rows.filter((r) => {
          const p = r.id != null ? byId.get(r.id) : undefined;
          return !!p && isLegend(p);
        }).length;
        const ofKind = (kind: 'ub' | 'mega') =>
          rows.filter((r) => {
            const p = r.id != null ? byId.get(r.id) : undefined;
            return !!p && hasKind(p, kind);
          }).length;
        const ultraBeasts = ofKind('ub');
        const megas = ofKind('mega');
        // Ø Positions-Fit der gesetzten Elf (Bank und Standardschütze zählen nicht) – grobe Live-Stärke im Draft
        const fits = rows.flatMap((r) => {
          const p = r.id != null && r.pos && r.pos !== 'SS' ? byId.get(r.id) : undefined;
          return p && r.pos ? [positionFit(p, r.pos, sc)] : [];
        });
        const avgFit = fits.length ? Math.round(fits.reduce((a, b) => a + b, 0) / fits.length) : null;
        const shinyCount = rows.filter((r) => r.id != null && state.shinies?.includes(r.id)).length;
        // Vereinsnamen der CPU-Teams erst bei der Anzeige übersetzen
        const name = teamLabel(team, t);
        return (
          <div
            key={team.id}
            className={`draft__col draft-board__col ${team.id === currentId ? 'is-current' : ''} ${team.id === state.you ? 'is-mine' : ''}`}
          >
            <h3 title={name}>
              <span className="draft-board__no">{i + 1}</span>{' '}
              {team.trainer && <TrainerAvatar look={parseLook(team.trainer)} size={22} companion={false} className="draft-trainer" />}
              {name}
            </h3>
            <p className="draft-board__meta">
              <span>{team.formation}</span>
              <span>
                {filled}/{rows.length}
              </span>
              {legendLimit != null && (
                <span
                  className={`draft-board__legends ${legends >= legendLimit ? 'is-full' : ''}`}
                  title={t.draft.board.legendsTitle(legends, legendLimit)}
                >
                  <span aria-hidden="true">
                    ★ {legends}/{legendLimit}
                  </span>
                  <span className="sr-only">{t.draft.board.legendsTitle(legends, legendLimit)}</span>
                </span>
              )}
              {ultraBeastLimit != null && (
                <span
                  className={`draft-board__legends ${ultraBeasts >= ultraBeastLimit ? 'is-full' : ''}`}
                  title={t.draft.board.ultraBeastsTitle(ultraBeasts, ultraBeastLimit)}
                >
                  <span aria-hidden="true">
                    UB {ultraBeasts}/{ultraBeastLimit}
                  </span>
                  <span className="sr-only">{t.draft.board.ultraBeastsTitle(ultraBeasts, ultraBeastLimit)}</span>
                </span>
              )}
              {megaLimit != null && (
                <span
                  className={`draft-board__legends ${megas >= megaLimit ? 'is-full' : ''}`}
                  title={t.draft.board.megasTitle(megas, megaLimit)}
                >
                  <span aria-hidden="true">
                    M {megas}/{megaLimit}
                  </span>
                  <span className="sr-only">{t.draft.board.megasTitle(megas, megaLimit)}</span>
                </span>
              )}
              {avgFit != null && (
                <span className="draft-board__fit" title={t.draft.board.fitTitle(avgFit)}>
                  <span aria-hidden="true">Ø {avgFit}</span>
                  <span className="sr-only">{t.draft.board.fitTitle(avgFit)}</span>
                </span>
              )}
              {shinyCount > 0 && (
                <span className="draft-board__shinies" title={t.shiny.count(shinyCount)}>
                  <span aria-hidden="true">✨ {shinyCount}</span>
                  <span className="sr-only">{t.shiny.count(shinyCount)}</span>
                </span>
              )}
              <DraftTeamTags team={team} host={team.id === state.hostTeamId} you={team.id === state.you} />
            </p>
            <ol>
              {rows.map((r) => {
                const p = r.id != null ? byId.get(r.id) : undefined;
                const latest = !!last && last.teamId === team.id && last.slot === r.slot;
                return (
                  <li key={r.slot} className={`${latest ? 'is-latest' : ''} ${p ? '' : 'is-empty'}`}>
                    {r.pos ? (
                      <PosBadge pos={r.pos} />
                    ) : (
                      <span className="pos-badge pos-badge--bench" title={t.draft.bench.label}>
                        {t.draft.bench.short}
                      </span>
                    )}
                    <span>
                      {p ? t.game.pokemon(p) : '–'}
                      {p && team.captain === p.id && (
                        <>
                          {' '}
                          <span className="draft-board__captain captain-badge" title={t.captain.title}>
                            C<span className="sr-only"> – {t.captain.title}</span>
                          </span>
                        </>
                      )}
                      {p && state.shinies?.includes(p.id) && (
                        <span className="draft-board__shiny" title={t.shiny.title}>
                          {' '}
                          ✨<span className="sr-only">{t.shiny.title}</span>
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

/** Die letzten Picks als kurzer Verlauf („Glurak → Team X (auto)") – ohne Live-Region (die Ansage kommt aus DraftLive). */
export function DraftPickFeed({ items, you }: { items: FeedItem[]; you: string | null }) {
  const t = useT();
  const tx = t.draft.board;
  if (!items.length) return null;
  return (
    <section className="card draft-feed" aria-labelledby="draft-feed-title">
      <h2 id="draft-feed-title" className="section-title">
        {tx.recentPicks}
      </h2>
      {(() => {
        // Positions-Run: mindestens 3 der letzten 5 Picks auf derselben Position (Standardschütze zählt nicht)
        const counts = new Map<PosCode, number>();
        for (const f of items.slice(0, 5)) if (f.pos && f.pos !== 'SS') counts.set(f.pos, (counts.get(f.pos) ?? 0) + 1);
        const run = [...counts].sort((a, b) => b[1] - a[1])[0];
        if (!run || run[1] < 3) return null;
        return <p className="draft-feed__run small">🔥 {tx.feedRun(t.game.posName[run[0]], run[1], Math.min(5, items.length))}</p>;
      })()}
      <ol>
        {items.map((f, i) => (
          <li key={f.key} className={`${i === 0 ? 'is-latest' : ''} ${f.teamId === you ? 'is-mine' : ''}`}>
            <span className="draft-feed__no">#{f.no}</span>
            <span className="draft-feed__text">
              <strong>
                {f.shiny && <span title={t.shiny.title}>✨ </span>}
                {f.pokemon}
              </strong>{' '}
              → {f.team}
              {f.pos && (
                <span className="draft-feed__pos">
                  {' '}
                  <PosBadge pos={f.pos} />
                  {f.fit != null && <span title={tx.feedFitTitle(f.fit)}> {f.fit}</span>}
                </span>
              )}
              {f.auto && <span className="draft-feed__auto">{tx.auto}</span>}
            </span>
            {f.roll && (
              <span className="draft-feed__roll" title={tx.rollTitle(f.roll.region, t.game.type[f.roll.type])}>
                <span className="sr-only">{tx.rollTitle(f.roll.region, t.game.type[f.roll.type])}</span>
                <span aria-hidden="true">{f.roll.region}</span>
                <span aria-hidden="true">
                  <TypeBadge type={f.roll.type} small />
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
