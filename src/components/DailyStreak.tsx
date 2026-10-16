import { useMemo } from 'react';
import { useT } from '../i18n';
import { dailyNumber, dayKey } from '../lib/daily';
import { dailyStreak, loadDailyHistory } from '../lib/dailyHistory';
import { formatRecord } from '../lib/season';

/** Wie viele Tage das Archiv zeigt */
const ARCHIVE_DAYS = 14;

/** Tägliche Elf: Serie (Tage am Stück) und die letzten gespielten Tage – nur dieses Gerät. */
export function DailyStreak() {
  const t = useT();
  const td = t.daily;
  const today = dayKey();
  // Beim Öffnen bzw. nach einem Run (neue Komponente) frisch gelesen
  const history = useMemo(() => loadDailyHistory(), []);
  if (!history.length) return null;
  const streak = dailyStreak(
    history.map((d) => d.day),
    today,
  );
  const playedToday = history[0]?.day === today;
  return (
    <section className="card daily-streak" aria-labelledby="daily-streak-title">
      <h2 id="daily-streak-title" className="sr-only">
        {td.streak}
      </h2>
      <div className="statcards">
        <div className="statcard">
          <span className="statcard__label">{td.streak}</span>
          <span className="statcard__value">{td.streakDays(streak.current)}</span>
        </div>
        <div className="statcard">
          <span className="statcard__label">{td.bestStreak}</span>
          <span className="statcard__value">{td.streakDays(streak.best)}</span>
        </div>
        <div className="statcard">
          <span className="statcard__label">{td.played}</span>
          <span className="statcard__value">{history.length}</span>
        </div>
        {(() => {
          // Bester Tag (meiste Punkte; bei Gleichstand der frühere) mit Ø Punkten aller gespielten Tage
          const best = history.reduce((a, b) => (b.points > a.points || (b.points === a.points && b.day < a.day) ? b : a));
          const avg = Math.round(history.reduce((sum, d) => sum + d.points, 0) / history.length);
          return (
            <div className="statcard daily-streak__best" title={td.bestDayTitle(dailyNumber(best.day), avg)}>
              <span className="statcard__label">{td.bestDay}</span>
              <span className="statcard__value">
                {best.points} {t.draft.col.pts}
              </span>
              <span className="statcard__sub muted small">{td.bestDayAvg(avg)}</span>
            </div>
          );
        })()}
      </div>
      {!playedToday && streak.current > 0 && <p className="hint daily-streak__hint">{td.streakHint}</p>}
      <details className="daily-streak__archive">
        <summary>{td.archive}</summary>
        <ol>
          {(() => {
            // 🏅 an den Tagen mit den meisten Punkten; ▲/▼ gegenüber dem vorherigen gespielten Tag
            const top = Math.max(...history.map((d) => d.points));
            return history.slice(0, ARCHIVE_DAYS).map((d, i) => {
              const prev = history[i + 1];
              const diff = prev ? d.points - prev.points : 0;
              return (
                <li key={d.day}>
                  <span className="daily-streak__no">{td.archiveRow(dailyNumber(d.day))}</span>
                  <span className="muted daily-streak__day">{t.game.day(d.day)}</span>
                  <strong className="daily-streak__rec">{formatRecord(d.record)}</strong>
                  <span className="daily-streak__score">
                    <span className="daily-streak__pts">
                      {d.points} {t.draft.col.pts}
                    </span>
                    {diff !== 0 && (
                      <small className={`daily-streak__trend ${diff > 0 ? 'is-up' : 'is-down'}`} title={td.archiveTrend(diff)}>
                        {' '}
                        {diff > 0 ? '▲' : '▼'}
                        {Math.abs(diff)}
                      </small>
                    )}
                    {history.length > 1 && d.points === top && (
                      <span className="daily-streak__top" title={td.bestDay}>
                        {' '}
                        🏅
                      </span>
                    )}
                  </span>
                  <span className="muted daily-streak__place">{td.archivePlace(d.position)}</span>
                </li>
              );
            });
          })()}
        </ol>
        <p className="muted small">{td.archiveNote}</p>
      </details>
    </section>
  );
}
