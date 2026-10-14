import { useT } from '../i18n';
import { DRAFT_REACTIONS } from '../lib/api/draftContract';
import { teamLabel, type DraftRoom } from '../state/useDraftRoom';

/**
 * Emoji-Reaktionen: Mitglieder schicken eine an alle (Leiste), alle sehen die der letzten
 * Sekunden als kleine Blasen unten rechts – mit Teamnamen.
 */
export function DraftReactions({ room }: { room: DraftRoom }) {
  const t = useT();
  const s = room.state;
  const canReact = !!room.me && room.live && room.status === 'open';
  return (
    <>
      {canReact && (
        <div className="draft-reactions" role="group" aria-label={t.online.reactLabel}>
          {DRAFT_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" className="draft-reactions__btn" aria-label={t.online.reactSend(emoji)} onClick={() => room.react(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      )}
      <ol className="draft-bubbles" aria-live="polite">
        {room.reactions.map((r) => {
          const team = s?.teams.find((tm) => tm.id === r.teamId);
          return (
            <li key={r.id} className={`draft-bubble ${r.teamId === room.me?.id ? 'is-mine' : ''}`}>
              <span className="draft-bubble__emoji" aria-hidden="true">
                {r.emoji}
              </span>
              <span className="draft-bubble__team">{team ? teamLabel(team, t) : '…'}</span>
              <span className="sr-only">{r.emoji}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
