import { useId, type ReactNode } from 'react';
import { FORMATION_IDS } from '../config/formations';
import { REGIONS } from '../config/regions';
import { useT, type Messages } from '../i18n';
import { DRAFT_LIMITS, type DraftSettings, type PickSeconds } from '../lib/api/draftContract';
import { poolOf } from '../lib/draftEngine';
import { fitSettingsPatch, poolCapacity } from '../state/useDraftRoom';
import type { FormationId, Pokemon, RegionFilter } from '../types';
import { Segmented } from './Segmented';
import '../styles/draft.css';

interface ChoiceOption<T> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

interface ChoiceProps<T> {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (v: T) => void;
  wrap?: boolean;
  disabled?: boolean;
  /** Eine Änderung ist unterwegs: Klicks zählen kurz nicht (aria-disabled – der Tastaturfokus bleibt) */
  busy?: boolean;
  note?: ReactNode;
}

/** Segment-Buttons wie <Segmented>, aber mit einzeln sperrbaren Optionen. */
export function DraftChoice<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  wrap,
  disabled,
  busy,
  note,
}: ChoiceProps<T>) {
  const id = useId();
  return (
    <div className="field">
      <span className="field__label" id={id}>
        {label}
      </span>
      <div className={`segmented ${wrap ? 'segmented--wrap' : ''}`} role="radiogroup" aria-labelledby={id} aria-busy={busy || undefined}>
        {options.map((o) => {
          const off = disabled || o.disabled;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={o.value === value}
              disabled={off}
              aria-disabled={busy || undefined}
              title={o.title}
              className={`segmented__btn ${o.value === value ? 'is-active' : ''} ${off ? 'draft-choice--off' : ''}`}
              onClick={() => !busy && o.value !== value && onChange(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {note && <p className="draft-field-note">{note}</p>}
    </div>
  );
}

/** Pool-Auswahl: alle Regionen, dann „Alle" (Namen in der aktiven Sprache) */
function regionOptions(t: Messages): { value: RegionFilter; label: string }[] {
  return [
    ...REGIONS.map((r) => ({ value: r.gen as RegionFilter, label: t.game.region[r.gen] })),
    { value: 0 as RegionFilter, label: t.game.allRegions },
  ];
}

/** „Kanto" bzw. „Alle" für die Kurzfassung */
function regionText(t: Messages, filter: RegionFilter): string {
  return filter === 0 ? t.game.allRegions : t.game.region[filter] ?? '?';
}

const timerLabel = (t: Messages, s: PickSeconds) => (s ? t.draft.settings.seconds(s) : t.draft.off);
const TIMER_OPTIONS: PickSeconds[] = [30, 60, 90, 0];

interface Props {
  value: DraftSettings;
  onChange: (patch: Partial<DraftSettings>) => void;
  list: Pokemon[];
  /** Schon beigetretene Teams (Lobby): weniger Plätze und zu kleine Pools sind gesperrt */
  teamsJoined?: number;
  disabled?: boolean;
  /**
   * Lobby: Eine Änderung wartet noch auf den Server – die Auswahl-Knöpfe nehmen solange nichts an
   * (sonst rechnet die nächste Änderung mit dem alten Stand). Der Liganame bleibt frei.
   */
  busy?: boolean;
}

/** Liga-Einstellungen – beim Erstellen und live in der Lobby (Host). */
export function DraftSettingsForm({ value, onChange, list, teamsJoined = 0, disabled, busy }: Props) {
  const t = useT();
  const tx = t.draft.settings;
  const nameId = useId();
  const poolSize = poolOf(value, list).length;
  const capacity = poolCapacity(value, list);
  const floor = Math.max(DRAFT_LIMITS.minTeams, teamsJoined);

  /** Änderung anwenden (maxTeams sinkt ggf. mit) – unmögliche Änderungen sind gesperrt. */
  const change = (patch: Partial<DraftSettings>) => {
    const fitted = fitSettingsPatch(value, patch, list, teamsJoined);
    if (fitted) onChange(fitted);
  };
  const blocked = (patch: Partial<DraftSettings>) => fitSettingsPatch(value, patch, list, teamsJoined) == null;
  const tooSmall = tx.poolTooSmall(floor);

  return (
    <div className="draft-settings">
      <div className="field">
        <label className="field__label" htmlFor={nameId}>
          {tx.leagueName} <small>{tx.optional}</small>
        </label>
        <input
          id={nameId}
          className="input"
          value={value.name}
          maxLength={DRAFT_LIMITS.leagueNameMax}
          placeholder={tx.leagueNamePlaceholder}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <DraftChoice
        label={t.draft.pool}
        wrap
        value={value.region}
        disabled={disabled}
        busy={busy}
        onChange={(region) => change({ region })}
        options={regionOptions(t).map((o) => {
          const off = blocked({ region: o.value });
          return { ...o, disabled: off, title: off ? tooSmall : undefined };
        })}
        note={tx.poolNote(poolSize, capacity)}
      />
      <div className="draft-settings__pair">
        <DraftChoice
          label={tx.legends}
          value={value.legends}
          disabled={disabled}
          busy={busy}
          onChange={(legends) => change({ legends })}
          options={[
            { value: false, label: t.draft.off, disabled: blocked({ legends: false }), title: blocked({ legends: false }) ? tooSmall : undefined },
            { value: true, label: t.draft.on },
          ]}
        />
        <DraftChoice
          label={tx.setPiece}
          value={value.setPiece}
          disabled={disabled}
          busy={busy}
          onChange={(setPiece) => change({ setPiece })}
          options={[
            { value: false, label: t.draft.off },
            { value: true, label: t.draft.on, disabled: blocked({ setPiece: true }), title: blocked({ setPiece: true }) ? tooSmall : tx.setPieceRound },
          ]}
        />
      </div>
      <DraftChoice
        label={t.draft.teams}
        wrap
        value={value.maxTeams}
        disabled={disabled}
        busy={busy}
        onChange={(maxTeams) => change({ maxTeams })}
        options={Array.from({ length: DRAFT_LIMITS.maxTeams - DRAFT_LIMITS.minTeams + 1 }, (_, i) => {
          const n = DRAFT_LIMITS.minTeams + i;
          const over = n > capacity;
          const under = n < floor;
          return {
            value: n,
            label: String(n),
            disabled: over || under,
            title: over ? tx.tooManyTeams : under ? tx.alreadyJoined(teamsJoined) : undefined,
          };
        })}
      />
      <DraftChoice
        label={tx.order}
        value={value.order}
        disabled={disabled}
        busy={busy}
        onChange={(order) => change({ order })}
        options={[
          { value: 'random', label: tx.orderRandom },
          { value: 'host', label: tx.orderHost },
        ]}
      />
      <DraftChoice
        label={tx.timer}
        value={value.pickSeconds}
        disabled={disabled}
        busy={busy}
        onChange={(pickSeconds) => change({ pickSeconds })}
        options={TIMER_OPTIONS.map((s) => ({ value: s, label: timerLabel(t, s) }))}
        note={value.pickSeconds ? tx.timerNote : tx.noTimerNote}
      />
      <DraftChoice
        label={tx.lobby}
        value={value.visibility}
        disabled={disabled}
        busy={busy}
        onChange={(visibility) => change({ visibility })}
        options={[
          { value: 'private', label: tx.private },
          { value: 'public', label: tx.public },
        ]}
        note={value.visibility === 'private' ? tx.privateNote : tx.publicNote}
      />
    </div>
  );
}

/** Kurzfassung der Einstellungen (für Mitspieler und Lobby-Liste). */
export function DraftSettingsSummary({ settings }: { settings: DraftSettings }) {
  const t = useT();
  const tx = t.draft.summary;
  const items = [
    tx.pool(regionText(t, settings.region)),
    settings.legends ? tx.withLegends : tx.withoutLegends,
    settings.setPiece ? tx.withSetPiece : tx.withoutSetPiece,
    tx.maxTeams(settings.maxTeams),
    settings.order === 'random' ? tx.orderRandom : tx.orderHost,
    settings.pickSeconds ? tx.perPick(settings.pickSeconds) : tx.noTimer,
    settings.visibility === 'public' ? tx.public : tx.private,
  ];
  return (
    <ul className="draft-summary">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

interface TeamFieldsProps {
  name: string;
  formation: FormationId;
  onName: (name: string) => void;
  onFormation: (formation: FormationId) => void;
  /** Eingabe abschließen (Enter / Fokus weg) */
  onCommit?: () => void;
  disabled?: boolean;
}

/** Teamname + Formation – beim Erstellen, Beitreten und Ändern des eigenen Teams. */
export function DraftTeamFields({ name, formation, onName, onFormation, onCommit, disabled }: TeamFieldsProps) {
  const t = useT();
  const id = useId();
  return (
    <div className="draft-teamfields">
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {t.draft.settings.teamName}
        </label>
        <input
          id={id}
          className="input"
          value={name}
          maxLength={DRAFT_LIMITS.teamNameMax}
          placeholder={t.draft.settings.teamNamePlaceholder}
          autoComplete="off"
          disabled={disabled}
          onChange={(e) => onName(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit?.();
          }}
        />
      </div>
      <Segmented
        label={t.draft.formation}
        wrap
        value={formation}
        onChange={(f) => !disabled && onFormation(f)}
        options={FORMATION_IDS.map((f) => ({ value: f, label: f }))}
      />
    </div>
  );
}
