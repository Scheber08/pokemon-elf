import { useId, type ReactNode } from 'react';
import { FORMATION_IDS } from '../config/formations';
import { REGIONS, regionLabel } from '../config/regions';
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

const REGION_OPTIONS: { value: RegionFilter; label: string }[] = [
  ...REGIONS.map((r) => ({ value: r.gen as RegionFilter, label: r.name })),
  { value: 0 as RegionFilter, label: 'Alle' },
];

const TIMER_LABEL: Record<PickSeconds, string> = { 30: '30 s', 60: '60 s', 90: '90 s', 0: 'Aus' };
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
  const tooSmall = `Pool zu klein für ${floor} Teams`;

  return (
    <div className="draft-settings">
      <div className="field">
        <label className="field__label" htmlFor={nameId}>
          Liganame <small>(optional)</small>
        </label>
        <input
          id={nameId}
          className="input"
          value={value.name}
          maxLength={DRAFT_LIMITS.leagueNameMax}
          placeholder="z. B. Montagsliga"
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <DraftChoice
        label="Pool"
        wrap
        value={value.region}
        disabled={disabled}
        busy={busy}
        onChange={(region) => change({ region })}
        options={REGION_OPTIONS.map((o) => {
          const off = blocked({ region: o.value });
          return { ...o, disabled: off, title: off ? tooSmall : undefined };
        })}
        note={
          <>
            {poolSize} Pokémon, reicht für bis zu {capacity} Teams
          </>
        }
      />
      <div className="draft-settings__pair">
        <DraftChoice
          label="Legendäre"
          value={value.legends}
          disabled={disabled}
          busy={busy}
          onChange={(legends) => change({ legends })}
          options={[
            { value: false, label: 'Aus', disabled: blocked({ legends: false }), title: blocked({ legends: false }) ? tooSmall : undefined },
            { value: true, label: 'An' },
          ]}
        />
        <DraftChoice
          label="Standardschütze"
          value={value.setPiece}
          disabled={disabled}
          busy={busy}
          onChange={(setPiece) => change({ setPiece })}
          options={[
            { value: false, label: 'Aus' },
            { value: true, label: 'An', disabled: blocked({ setPiece: true }), title: blocked({ setPiece: true }) ? tooSmall : '12. Runde' },
          ]}
        />
      </div>
      <DraftChoice
        label="Teams"
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
            title: over ? 'Der Pool reicht nicht für so viele Teams' : under ? `Es sind schon ${teamsJoined} Teams dabei` : undefined,
          };
        })}
      />
      <DraftChoice
        label="Draft-Reihenfolge"
        value={value.order}
        disabled={disabled}
        busy={busy}
        onChange={(order) => change({ order })}
        options={[
          { value: 'random', label: 'Zufällig' },
          { value: 'host', label: 'Host legt fest' },
        ]}
      />
      <DraftChoice
        label="Pick-Timer"
        value={value.pickSeconds}
        disabled={disabled}
        busy={busy}
        onChange={(pickSeconds) => change({ pickSeconds })}
        options={TIMER_OPTIONS.map((s) => ({ value: s, label: TIMER_LABEL[s] }))}
        note={value.pickSeconds ? 'Läuft die Zeit ab, wählt der Server automatisch.' : 'Ohne Zeitlimit – der Host kann für abwesende Teams wählen.'}
      />
      <DraftChoice
        label="Lobby"
        value={value.visibility}
        disabled={disabled}
        busy={busy}
        onChange={(visibility) => change({ visibility })}
        options={[
          { value: 'private', label: 'Privat' },
          { value: 'public', label: 'Öffentlich' },
        ]}
        note={
          value.visibility === 'private'
            ? 'Privat: nur wer Link oder Code hat, kann beitreten.'
            : 'Öffentlich: Die Liga steht in der Liste der öffentlichen Lobbys – jeder kann beitreten.'
        }
      />
    </div>
  );
}

/** Kurzfassung der Einstellungen (für Mitspieler und Lobby-Liste). */
export function DraftSettingsSummary({ settings }: { settings: DraftSettings }) {
  const items = [
    `Pool: ${regionLabel(settings.region)}`,
    settings.legends ? 'mit Legendären' : 'ohne Legendäre',
    settings.setPiece ? 'mit Standardschütze' : 'ohne Standardschütze',
    `bis ${settings.maxTeams} Teams`,
    settings.order === 'random' ? 'Reihenfolge zufällig' : 'Reihenfolge vom Host',
    settings.pickSeconds ? `${settings.pickSeconds} s pro Pick` : 'ohne Pick-Timer',
    settings.visibility === 'public' ? 'öffentlich' : 'privat',
  ];
  return (
    <ul className="draft-summary">
      {items.map((t) => (
        <li key={t}>{t}</li>
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
  const id = useId();
  return (
    <div className="draft-teamfields">
      <div className="field">
        <label className="field__label" htmlFor={id}>
          Teamname
        </label>
        <input
          id={id}
          className="input"
          value={name}
          maxLength={DRAFT_LIMITS.teamNameMax}
          placeholder="z. B. FC Glurak"
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
        label="Formation"
        wrap
        value={formation}
        onChange={(f) => !disabled && onFormation(f)}
        options={FORMATION_IDS.map((f) => ({ value: f, label: f }))}
      />
    </div>
  );
}
