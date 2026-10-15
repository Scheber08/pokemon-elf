import { DRAFT_PRESET_IDS, DRAFT_PRESETS } from '../config/draftPresets';
import { useT } from '../i18n';
import type { DraftSettings } from '../lib/api/draftContract';
import { fitSettingsPatch } from '../state/useDraftRoom';
import type { Pokemon } from '../types';

interface Props {
  value: DraftSettings;
  list: Pokemon[];
  /** Schon beigetretene Teams (Lobby): Vorlagen, deren Pool zu klein wäre, sind gesperrt */
  teamsJoined?: number;
  onApply: (patch: Partial<DraftSettings>) => void;
  disabled?: boolean;
}

/** Schnellstart-Vorlagen als Chips – beim Erstellen und für den Host in der Lobby. */
export function DraftPresets({ value, list, teamsJoined = 0, onApply, disabled }: Props) {
  const t = useT();
  return (
    <div className="field draft-presets">
      <span className="field__label">{t.online.presets}</span>
      <div className="chips">
        {DRAFT_PRESET_IDS.map((id) => {
          // Reicht der Pool nicht für die gewählte Teamzahl, sinkt sie mit (null = gar nicht möglich)
          const fitted = fitSettingsPatch(value, DRAFT_PRESETS[id], list, teamsJoined);
          return (
            <button
              key={id}
              type="button"
              className="chip"
              title={fitted ? t.online.presetNote[id] : t.draft.settings.poolTooSmall(Math.max(2, teamsJoined))}
              disabled={disabled}
              aria-disabled={!fitted || undefined}
              onClick={() => fitted && onApply(fitted)}
            >
              {t.online.presetName[id]}
            </button>
          );
        })}
        {/* Überraschung: eine zufällige passende Vorlage */}
        <button
          type="button"
          className="chip draft-presets__random"
          title={t.online.presetRandomTitle}
          disabled={disabled}
          onClick={() => {
            const fitting = DRAFT_PRESET_IDS.flatMap((id) => {
              const fitted = fitSettingsPatch(value, DRAFT_PRESETS[id], list, teamsJoined);
              return fitted ? [fitted] : [];
            });
            if (fitting.length) onApply(fitting[Math.floor(Math.random() * fitting.length)]);
          }}
        >
          🎲 {t.online.presetRandom}
        </button>
      </div>
    </div>
  );
}
