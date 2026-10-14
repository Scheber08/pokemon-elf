import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import { DRAFT_BENCH_SLOT, type DraftSnapshot, type DraftTeam } from '../lib/api/draftContract';
import { DRAFT_SS_SLOT, hasKind, isLegend, poolHasLegends, poolHasMegas, poolHasUltraBeasts } from '../lib/draftEngine';
import { teamLabel, type FeedItem } from '../state/useDraftRoom';
import type { Pokemon, PosCode } from '../types';
import { parseLook } from '../lib/trainer';
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
  const last = state.picks.length ? state.picks[state.picks.length - 1] : null;
  const maxLegends = state.settings.maxLegends;
  const legendLimit = maxLegends != null && poolHasLegends(state.settings) ? maxLegends : null;
  const maxUltraBeasts = state.settings.maxUltraBeasts;
  const ultraBeastLimit = maxUltraBeasts != null && poolHasUltraBeasts(state.settings) ? maxUltraBeasts : null;
  const maxMegas = state.settings.maxMegas;
  const megaLimit = maxMegas != null && poolHasMegas(state.settings) ? maxMegas : null;
  return (
    <section className="draft__board draft-board" aria-label={t.draft.draftBoard}>
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
                          <span className="draft-board__captain" title={t.captain.title}>
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
