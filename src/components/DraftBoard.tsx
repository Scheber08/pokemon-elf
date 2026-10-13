import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import type { DraftSnapshot, DraftTeam } from '../lib/api/draftContract';
import { DRAFT_SS_SLOT } from '../lib/draftEngine';
import { teamLabel, type FeedItem } from '../state/useDraftRoom';
import type { Pokemon } from '../types';
import { PosBadge } from './Badges';
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
  return (
    <section className="draft__board draft-board" aria-label={t.draft.draftBoard}>
      {state.teams.map((team, i) => {
        const defs = FORMATIONS[team.formation].slots;
        const rows = defs.map((d, j) => ({ slot: j, pos: d.pos, id: team.slots[j] }));
        if (state.settings.setPiece) rows.push({ slot: DRAFT_SS_SLOT, pos: 'SS', id: team.ss });
        const filled = rows.filter((r) => r.id != null).length;
        // Vereinsnamen der CPU-Teams erst bei der Anzeige übersetzen
        const name = teamLabel(team, t);
        return (
          <div
            key={team.id}
            className={`draft__col draft-board__col ${team.id === currentId ? 'is-current' : ''} ${team.id === state.you ? 'is-mine' : ''}`}
          >
            <h3 title={name}>
              <span className="draft-board__no">{i + 1}</span> {name}
            </h3>
            <p className="draft-board__meta">
              <span>{team.formation}</span>
              <span>
                {filled}/{rows.length}
              </span>
              <DraftTeamTags team={team} host={team.id === state.hostTeamId} you={team.id === state.you} />
            </p>
            <ol>
              {rows.map((r) => {
                const p = r.id != null ? byId.get(r.id) : undefined;
                const latest = !!last && last.teamId === team.id && last.slot === r.slot;
                return (
                  <li key={r.slot} className={`${latest ? 'is-latest' : ''} ${p ? '' : 'is-empty'}`}>
                    <PosBadge pos={r.pos} />
                    <span>{p ? t.game.pokemon(p) : '–'}</span>
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
  const tx = useT().draft.board;
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
              <strong>{f.pokemon}</strong> → {f.team}
              {f.auto && <span className="draft-feed__auto">{tx.auto}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
