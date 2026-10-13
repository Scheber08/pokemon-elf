import type { Level } from '../config/positions';
import { useT } from '../i18n';

/** Kreis-Symbol für die Gewichtung: ● Schlüssel, ◕ Hilft, ◔ Kleiner Anteil, ○ Zählt nicht. */
export function LevelIcon({ level, size = 18 }: { level: Level; size?: number }) {
  const t = useT();
  const fill =
    level === 3 ? (
      <circle cx="9" cy="9" r="8" fill="currentColor" />
    ) : level === 2 ? (
      <path d="M9 9 L9 1 A8 8 0 1 1 1 9 Z" fill="currentColor" />
    ) : level === 1 ? (
      <path d="M9 9 L9 1 A8 8 0 0 1 17 9 Z" fill="currentColor" />
    ) : null;
  return (
    <svg className="level-icon" width={size} height={size} viewBox="0 0 18 18" role="img" aria-label={t.game.level[level]}>
      <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {fill}
    </svg>
  );
}
