import { useT } from '../i18n';
import { DRAFT_LIMITS } from '../lib/api/draftContract';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { rosterOf } from '../lib/draftEngine';
import type { DraftRoom } from '../state/useDraftRoom';
import { Sprite } from './Sprite';

/**
 * Wunschliste des eigenen Teams im Live-Draft: Das gerade gewählte Pokémon drauf bzw. runter,
 * Reihenfolge ändern, entfernen. Der Server nimmt beim Auto-Pick das erste erlaubte davon.
 */
export function DraftQueue({ room, selected }: { room: DraftRoom; selected: number | null }) {
  const t = useT();
  const { byId } = usePokemonData();
  const { sprite } = useSettings();
  const queue = room.state?.queue ?? [];
  const max = DRAFT_LIMITS.queueMax;
  const inQueue = selected != null && queue.includes(selected);
  // Inzwischen von einem Team gewählt – der Auto-Pick überspringt sie ohnehin
  const taken = new Set((room.state?.teams ?? []).flatMap((tm) => rosterOf(tm)));
  const gone = queue.filter((id) => taken.has(id));
  const set = (ids: number[]) => room.setQueue(ids);
  const name = (id: number) => {
    const p = byId.get(id);
    return p ? t.game.pokemon(p) : `#${id}`;
  };
  return (
    <section className="card draft-queue" aria-labelledby="draft-queue-title">
      <h2 id="draft-queue-title" className="section-title">
        {t.online.queueTitle} <span className="muted">{t.online.queueCount(queue.length, max)}</span>
      </h2>
      {selected != null && (
        <button
          type="button"
          className="btn btn--small"
          disabled={!inQueue && queue.length >= max}
          title={!inQueue && queue.length >= max ? t.online.queueFull(max) : undefined}
          onClick={() => set(inQueue ? queue.filter((id) => id !== selected) : [...queue, selected])}
        >
          {inQueue ? t.online.queueRemove : t.online.queueAdd}
        </button>
      )}
      {queue.length ? (
        <ol className="draft-queue__list">
          {queue.map((id, i) => {
            const p = byId.get(id);
            return (
              <li key={id} className={taken.has(id) ? 'is-taken' : undefined}>
                <span className="draft-queue__no">{i + 1}.</span>
                {p && <Sprite pokemon={p} style={sprite} className="draft-queue__sprite" />}
                <span className="draft-queue__name">
                  {name(id)}
                  {taken.has(id) && <small className="muted"> {t.online.queueTaken}</small>}
                </span>
                <button
                  type="button"
                  className="draft-queue__btn"
                  disabled={i === 0}
                  aria-label={t.online.queueUp(name(id))}
                  onClick={() => set([...queue.slice(0, i - 1), id, queue[i - 1], ...queue.slice(i + 1)])}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="draft-queue__btn"
                  disabled={i === queue.length - 1}
                  aria-label={t.online.queueDown(name(id))}
                  onClick={() => set([...queue.slice(0, i), queue[i + 1], id, ...queue.slice(i + 2)])}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="draft-queue__btn"
                  aria-label={t.online.queueDrop(name(id))}
                  onClick={() => set(queue.filter((x) => x !== id))}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted small">{t.online.queueEmpty}</p>
      )}
      {gone.length > 0 && (
        <button type="button" className="btn btn--small btn--ghost" onClick={() => set(queue.filter((id) => !taken.has(id)))}>
          {t.online.queueClearTaken(gone.length)}
        </button>
      )}
      <p className="muted small">{t.online.queueNote}</p>
    </section>
  );
}
