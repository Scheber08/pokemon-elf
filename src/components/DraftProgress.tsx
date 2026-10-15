import { useT } from '../i18n';

/**
 * Schmaler Fortschrittsbalken des Drafts unter der Statusleiste: gewählte Picks gefüllt, die Picks eines Teams
 * (online: das eigene, lokal: das am Zug) als Striche – erledigte gedimmt, kommende hell.
 */
export function DraftProgress({ done, total, marks }: { done: number; total: number; marks: readonly number[] }) {
  const t = useT();
  if (total <= 0) return null;
  const left = marks.filter((p) => p >= done).length;
  return (
    <div
      className="draft-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={t.online.progressLabel(done, total, left)}
      title={t.online.progressLabel(done, total, left)}
    >
      <span className="draft-progress__fill" style={{ width: `${(done / total) * 100}%` }} />
      {marks.map((p) => (
        <span key={p} className={`draft-progress__mark ${p < done ? 'is-done' : ''}`} style={{ left: `${((p + 0.5) / total) * 100}%` }} />
      ))}
    </div>
  );
}
