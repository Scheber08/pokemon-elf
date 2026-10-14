import { CLUB_NAMES } from '../config/season';
import { useT } from '../i18n';

/** 🎲 neben einem Teamnamen-Feld: setzt einen zufälligen Vereinsnamen (in der aktiven Sprache). */
export function RandomNameButton({ onPick, current, disabled }: { onPick: (name: string) => void; current?: string; disabled?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      className="btn btn--ghost random-name"
      disabled={disabled}
      title={t.common.randomName}
      aria-label={t.common.randomName}
      onClick={() => {
        const names = CLUB_NAMES.map((n) => t.game.club(n)).filter((n) => n !== current);
        onPick(names[Math.floor(Math.random() * names.length)]);
      }}
    >
      <span aria-hidden="true">🎲</span>
    </button>
  );
}
