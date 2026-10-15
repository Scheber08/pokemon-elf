import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { FORMATION_IDS } from '../config/formations';
import { TYPE_KEYS, TYPES } from '../config/pokemonTypes';
import { useT, type Messages } from '../i18n';
import {
  DRAFT_ALL_GENS,
  DRAFT_LIMITS,
  type BenchSize,
  type MatchdayMinutes,
  type DraftFormat,
  type DraftRollMode,
  type DraftSettings,
  type PickSeconds,
} from '../lib/api/draftContract';
import { CUP_SIZE } from '../lib/cup';
import { poolHasLegends, poolHasMegas, poolHasUltraBeasts, poolOf, rerollUsable } from '../lib/draftEngine';
import { fitSettingsPatch, poolCapacity } from '../state/useDraftRoom';
import type { FormationId, Pokemon, TypeKey } from '../types';
import { RandomNameButton } from './RandomNameButton';
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

interface Chip {
  key: string;
  label: ReactNode;
  /** Ausgewählt (aria-pressed) */
  on: boolean;
  /** Warum der Klick gerade nicht geht (Tooltip) – null = geht */
  blocked?: string | null;
  title?: string;
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
}

interface ChipsProps {
  label: string;
  chips: Chip[];
  disabled?: boolean;
  busy?: boolean;
  note?: ReactNode;
}

/**
 * Mehrfachauswahl als umbrechende Chips (aria-pressed). Gesperrte Chips (letzte Auswahl, Pool zu
 * klein) bleiben fokussierbar: aria-disabled + Grund als Tooltip, der Klick zählt nicht.
 */
function DraftChips({ label, chips, disabled, busy, note }: ChipsProps) {
  const id = useId();
  return (
    <div className="field">
      <span className="field__label" id={id}>
        {label}
      </span>
      <div className="chips draft-chips" role="group" aria-labelledby={id} aria-busy={busy || undefined}>
        {chips.map((c) => {
          const blocked = !!c.blocked;
          return (
            <button
              key={c.key}
              type="button"
              className={`chip ${c.className ?? ''} ${c.on ? 'is-active' : ''} ${blocked ? 'draft-chip--blocked' : ''}`}
              style={c.style}
              aria-pressed={c.on}
              disabled={disabled}
              aria-disabled={busy || blocked || undefined}
              title={c.blocked || c.title}
              onClick={() => !busy && !blocked && c.onClick()}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      {note && <p className="draft-field-note">{note}</p>}
    </div>
  );
}

/** Pool-Generationen kurz: „Alle", Regionsnamen (bis drei) oder „5 Generationen". */
function gensLabel(t: Messages, gens: readonly number[]): string {
  if (DRAFT_ALL_GENS.every((g) => gens.includes(g))) return t.game.allRegions;
  if (gens.length <= 3) return gens.map((g) => t.game.region[g] ?? '?').join(', ');
  return t.draft.summary.gensCount(gens.length);
}

/** Erlaubte Typen kurz (nur, wenn nicht alle): Namen (bis drei) oder „6 von 18 Typen" – sonst null. */
function typesLabel(t: Messages, types: readonly TypeKey[]): string | null {
  if (TYPE_KEYS.every((k) => types.includes(k))) return null;
  if (types.length <= 3) return t.draft.summary.types(types.map((k) => t.game.type[k]).join(', '));
  return t.draft.summary.typesCount(types.length, TYPE_KEYS.length);
}

/** Wert umschalten: drin → raus, sonst rein (Reihenfolge wie `order`). */
function toggled<T>(order: readonly T[], list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : order.filter((x) => x === v || list.includes(x));
}

const timerLabel = (t: Messages, s: PickSeconds) => (s ? t.draft.settings.seconds(s) : t.draft.off);
const TIMER_OPTIONS: PickSeconds[] = [30, 60, 90, 0];
const REROLL_OPTIONS = Array.from({ length: DRAFT_LIMITS.rerollsMax + 1 }, (_, i) => i);
/** maxLegends in den Segmenten: 0 = unbegrenzt (null) */
const LEGEND_OPTIONS = [0, ...DRAFT_LIMITS.maxLegends];
/** maxUltraBeasts in den Segmenten: 0 = unbegrenzt (null) */
const ULTRA_BEAST_OPTIONS = [0, ...DRAFT_LIMITS.maxUltraBeasts];
/** maxMegas in den Segmenten: 0 = unbegrenzt (null) */
const MEGA_OPTIONS = [0, ...DRAFT_LIMITS.maxMegas];

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
  /**
   * „Keine" Typen: neue Auswahl, nur lokal (null = aus). Die Chips schalten frei; gesendet wird erst
   * mit „Übernehmen" – als Ganzes, sobald sie passt. So gibt es nie eine leere Auswahl, und kein
   * Zwischenstand (ein einzelner kleiner Typ) senkt maxTeams.
   */
  const [typeDraft, setTypeDraft] = useState<TypeKey[] | null>(null);
  const poolSize = poolOf(value, list).length;
  const capacity = poolCapacity(value, list);
  const floor = Math.max(DRAFT_LIMITS.minTeams, teamsJoined);
  const legendsInPool = poolHasLegends(value);
  const ultraBeastsInPool = poolHasUltraBeasts(value);
  const megasInPool = poolHasMegas(value);
  /** Limit-Segmente: 0 = unbegrenzt (∞) */
  const limitOptions = (values: readonly number[], patch: (n: number | null) => Partial<DraftSettings>) =>
    values.map((n) => ({
      value: n,
      disabled: blocked(patch(n || null)),
      label: n ? (
        String(n)
      ) : (
        <>
          <span aria-hidden="true">∞</span>
          <span className="sr-only">{tx.unlimited}</span>
        </>
      ),
      title: blocked(patch(n || null)) ? tooSmall : n ? undefined : tx.unlimited,
    }));
  const randomMode = value.roll !== 'off';

  /** Änderung anwenden (maxTeams sinkt ggf. mit) – unmögliche Änderungen sind gesperrt. */
  const change = (patch: Partial<DraftSettings>) => {
    const fitted = fitSettingsPatch(value, patch, list, teamsJoined);
    if (fitted) onChange(fitted);
  };
  const blocked = (patch: Partial<DraftSettings>) => fitSettingsPatch(value, patch, list, teamsJoined) == null;
  const tooSmall = tx.poolTooSmall(floor);
  /** Grund, warum eine Pool-Änderung nicht geht – oder null */
  const poolBlock = (patch: Partial<DraftSettings>) => (blocked(patch) ? tooSmall : null);

  const allGens = DRAFT_ALL_GENS.every((g) => value.gens.includes(g));
  const genChips: Chip[] = [
    {
      key: 'all',
      label: tx.allGens,
      title: tx.allGensTitle,
      on: allGens,
      blocked: allGens ? null : poolBlock({ gens: [...DRAFT_ALL_GENS] }),
      onClick: () => !allGens && change({ gens: [...DRAFT_ALL_GENS] }),
      className: 'draft-chip--action',
    },
    ...DRAFT_ALL_GENS.map((gen): Chip => {
      const on = value.gens.includes(gen);
      const next = toggled(DRAFT_ALL_GENS, value.gens, gen);
      return {
        key: String(gen),
        label: t.game.region[gen],
        title: tx.genTitle(gen),
        on,
        blocked: !next.length ? tx.minOneGen : poolBlock({ gens: next }),
        onClick: () => change({ gens: next }),
      };
    }),
  ];

  const allTypes = TYPE_KEYS.every((k) => value.types.includes(k));
  const typeStyle = (type: TypeKey): CSSProperties => ({
    ['--chip-color' as string]: TYPES[type].color,
    ['--chip-text' as string]: TYPES[type].text,
  });
  const typeChips: Chip[] = [
    {
      key: 'all',
      label: tx.allTypes,
      title: tx.allTypesTitle,
      on: allTypes && !typeDraft,
      blocked: allTypes ? null : poolBlock({ types: [...TYPE_KEYS] }),
      onClick: () => {
        setTypeDraft(null);
        if (!allTypes) change({ types: [...TYPE_KEYS] });
      },
      className: 'draft-chip--action',
    },
    {
      key: 'none',
      label: tx.noTypes,
      title: tx.noTypesTitle,
      on: typeDraft !== null,
      onClick: () => setTypeDraft((d) => (d ? null : [])),
      className: 'draft-chip--action',
    },
    ...TYPE_KEYS.map((type): Chip => {
      if (typeDraft) {
        // Neue Auswahl: frei umschalten (lokal) – geprüft wird erst die ganze Auswahl
        return {
          key: type,
          label: t.game.type[type],
          on: typeDraft.includes(type),
          onClick: () => setTypeDraft((d) => toggled(TYPE_KEYS, d ?? [], type)),
          className: 'chip--type',
          style: typeStyle(type),
        };
      }
      const next = toggled(TYPE_KEYS, value.types, type);
      return {
        key: type,
        label: t.game.type[type],
        on: value.types.includes(type),
        blocked: !next.length ? tx.minOneType : poolBlock({ types: next }),
        onClick: () => change({ types: next }),
        className: 'chip--type',
        style: typeStyle(type),
      };
    }),
  ];
  // Neue Typ-Auswahl: Stand (Pool, Kapazität) und ob sie so übernommen werden kann
  const draftSettings = typeDraft?.length ? { ...value, types: typeDraft } : null;
  const draftFit = draftSettings ? fitSettingsPatch(value, { types: draftSettings.types }, list, teamsJoined) : null;
  const applyTypes = () => {
    if (!draftFit) return;
    setTypeDraft(null);
    onChange(draftFit);
  };
  const typeDraftNote = !draftSettings
    ? tx.pickTypes
    : tx.typesDraft(poolOf(draftSettings, list).length, poolCapacity(draftSettings, list)) + (draftFit ? '' : ` – ${tooSmall}`);

  // Rerolls nur, wo es eine Alternative geben kann (mehrere Typen bzw. Generationen)
  const anyRerolls = { type: 1, region: 1 };
  const typeRerollsOk = rerollUsable({ ...value, rerolls: anyRerolls }, 'type');
  const regionRerollsOk = rerollUsable({ ...value, rerolls: anyRerolls }, 'region');
  const rerollNote = [
    typeRerollsOk || regionRerollsOk ? tx.rerollsNote : null,
    typeRerollsOk ? null : tx.rerollsTypeOff,
    regionRerollsOk ? null : tx.rerollsRegionOff,
  ]
    .filter((x): x is string => !!x)
    .join(' ');

  const offTitle = (patch: Partial<DraftSettings>) => (blocked(patch) ? tooSmall : undefined);

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

      <fieldset className="draft-settings__group">
        <legend className="draft-settings__legend">{t.draft.pool}</legend>
        <DraftChips label={tx.gens} chips={genChips} disabled={disabled} busy={busy} />
        <DraftChips
          label={tx.types}
          chips={typeChips}
          disabled={disabled}
          // Die neue Auswahl schaltet nur lokal – sie wartet auf keinen Server
          busy={busy && !typeDraft}
          note={typeDraft || allTypes ? undefined : tx.typesNote}
        />
        {typeDraft && (
          <div className="draft-settings__typedraft">
            <p className="draft-field-note" aria-live="polite">
              {typeDraftNote}
            </p>
            <button
              type="button"
              className="btn btn--small btn--primary"
              disabled={disabled}
              // Nicht disabled, damit der Fokus bleibt – übernommen wird nur eine passende Auswahl
              aria-disabled={!draftFit || busy || undefined}
              onClick={() => !busy && applyTypes()}
            >
              {tx.applyTypes}
            </button>
            <button type="button" className="btn btn--small btn--ghost" disabled={disabled} onClick={() => setTypeDraft(null)}>
              {tx.cancelTypes}
            </button>
          </div>
        )}
        <div className="draft-settings__pair">
          <DraftChoice
            label={tx.legendary}
            value={value.legendary}
            disabled={disabled}
            busy={busy}
            onChange={(legendary) => change({ legendary })}
            options={[
              { value: false, label: t.draft.off, disabled: blocked({ legendary: false }), title: offTitle({ legendary: false }) },
              { value: true, label: t.draft.on },
            ]}
          />
          <DraftChoice
            label={tx.mythical}
            value={value.mythical}
            disabled={disabled}
            busy={busy}
            onChange={(mythical) => change({ mythical })}
            options={[
              { value: false, label: t.draft.off, disabled: blocked({ mythical: false }), title: offTitle({ mythical: false }) },
              { value: true, label: t.draft.on },
            ]}
          />
        </div>
        <DraftChoice
          label={tx.maxLegends}
          value={value.maxLegends ?? 0}
          disabled={disabled || !legendsInPool}
          busy={busy}
          onChange={(n) => change({ maxLegends: n === 0 ? null : n })}
          options={LEGEND_OPTIONS.map((n) => ({
            value: n,
            // Ein strengeres Limit kann den Pool zu klein machen (Legendäre zählen nur bis zum Limit)
            disabled: blocked({ maxLegends: n || null }),
            label: n ? (
              String(n)
            ) : (
              <>
                <span aria-hidden="true">∞</span>
                <span className="sr-only">{tx.unlimited}</span>
              </>
            ),
            title: blocked({ maxLegends: n || null }) ? tooSmall : n ? undefined : tx.unlimited,
          }))}
          note={legendsInPool ? tx.maxLegendsNote : tx.maxLegendsOff}
        />
        <div className="draft-settings__pair">
          <DraftChoice
            label={tx.ultraBeasts}
            value={ultraBeastsInPool}
            disabled={disabled}
            busy={busy}
            onChange={(ultraBeasts) => change({ ultraBeasts })}
            options={[
              { value: false, label: t.draft.off, disabled: blocked({ ultraBeasts: false }), title: offTitle({ ultraBeasts: false }) },
              { value: true, label: t.draft.on },
            ]}
          />
          <DraftChoice
            label={tx.maxUltraBeasts}
            value={value.maxUltraBeasts ?? 0}
            disabled={disabled || !ultraBeastsInPool}
            busy={busy}
            onChange={(n) => change({ maxUltraBeasts: n === 0 ? null : n })}
            options={limitOptions(ULTRA_BEAST_OPTIONS, (maxUltraBeasts) => ({ maxUltraBeasts }))}
          />
        </div>
        <p className="draft-field-note">{ultraBeastsInPool ? tx.maxUltraBeastsNote : tx.maxUltraBeastsOff}</p>
        <DraftChoice
          label={tx.forms}
          value={!!value.forms}
          disabled={disabled}
          busy={busy}
          onChange={(forms) => change({ forms })}
          options={[
            { value: false, label: t.draft.off, disabled: blocked({ forms: false }), title: offTitle({ forms: false }) },
            { value: true, label: t.draft.on },
          ]}
          note={tx.formsNote}
        />
        <div className="draft-settings__pair">
          <DraftChoice
            label={tx.megas}
            value={megasInPool}
            disabled={disabled}
            busy={busy}
            onChange={(megas) => change({ megas })}
            options={[
              { value: false, label: t.draft.off, disabled: blocked({ megas: false }), title: offTitle({ megas: false }) },
              { value: true, label: t.draft.on },
            ]}
          />
          <DraftChoice
            label={tx.maxMegas}
            value={value.maxMegas ?? 0}
            disabled={disabled || !megasInPool}
            busy={busy}
            onChange={(n) => change({ maxMegas: n === 0 ? null : n })}
            options={limitOptions(MEGA_OPTIONS, (maxMegas) => ({ maxMegas }))}
          />
        </div>
        <p className="draft-field-note">{megasInPool ? tx.maxMegasNote : tx.maxMegasOff}</p>
        <p className="draft-field-note draft-settings__poolnote" aria-live="polite">
          {tx.poolNote(poolSize, capacity)}
        </p>
      </fieldset>

      <fieldset className="draft-settings__group">
        <legend className="draft-settings__legend">{tx.groupDraft}</legend>
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
        <DraftChoice<DraftFormat>
          label={tx.format}
          value={value.format}
          disabled={disabled}
          busy={busy}
          onChange={(format) => change({ format })}
          options={[
            { value: 'league', label: tx.formatLeague },
            { value: 'cup', label: tx.formatCup },
            {
              value: 'manager',
              label: tx.formatManager,
              disabled: blocked({ format: 'manager' }),
              title: blocked({ format: 'manager' }) ? tooSmall : undefined,
            },
          ]}
          note={
            value.format === 'cup'
              ? tx.formatCupNote(CUP_SIZE)
              : value.format === 'manager'
                ? tx.formatManagerNote(DRAFT_LIMITS.leagueSize)
                : tx.formatLeagueNote(DRAFT_LIMITS.leagueSize)
          }
        />
        {value.format === 'manager' && (
          <>
            <DraftChoice<BenchSize>
              label={tx.bench}
              value={value.bench}
              disabled={disabled}
              busy={busy}
              onChange={(bench) => change({ bench })}
              options={DRAFT_LIMITS.benchSizes.map((n) => ({
                value: n,
                label: String(n),
                disabled: blocked({ bench: n }),
                title: blocked({ bench: n }) ? tooSmall : undefined,
              }))}
              note={tx.benchNote(value.bench)}
            />
            <DraftChoice<MatchdayMinutes>
              label={tx.matchdayEvery}
              wrap
              value={value.matchdayMinutes}
              disabled={disabled}
              busy={busy}
              onChange={(matchdayMinutes) => change({ matchdayMinutes })}
              options={DRAFT_LIMITS.matchdayMinutes.map((m) => ({ value: m, label: tx.every(m) }))}
              note={tx.matchdayNote((DRAFT_LIMITS.leagueSize - 1) * value.matchdayMinutes)}
            />
          </>
        )}
        {value.format === 'cup' && (
          <DraftChoice
            label={tx.cupGroups}
            value={value.cupGroups}
            disabled={disabled}
            busy={busy}
            onChange={(cupGroups) => change({ cupGroups })}
            options={[
              { value: false, label: t.draft.off },
              { value: true, label: t.draft.on },
            ]}
            note={value.cupGroups ? tx.cupGroupsNote : tx.cupNoGroupsNote}
          />
        )}
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
        <DraftChoice
          label={tx.shinies}
          value={!value.shinies ? 'off' : value.shinyParty ? 'party' : 'on'}
          disabled={disabled}
          busy={busy}
          onChange={(v) => change(v === 'off' ? { shinies: false } : { shinies: true, shinyParty: v === 'party' })}
          options={[
            { value: 'off', label: t.draft.off },
            { value: 'on', label: t.draft.on, title: tx.shiniesTitle },
            { value: 'party', label: tx.shinyParty, title: tx.shinyPartyTitle },
          ]}
        />
        <div className="draft-settings__pair">
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
            label={tx.snake}
            value={value.snake}
            disabled={disabled}
            busy={busy}
            onChange={(snake) => change({ snake })}
            options={[
              { value: false, label: t.draft.off },
              { value: true, label: t.draft.on },
            ]}
            note={value.snake ? tx.snakeNote : tx.fixedNote}
          />
        </div>
        <DraftChoice
          label={t.draft.local.cpuLevel}
          value={value.cpuLevel ?? 'normal'}
          disabled={disabled}
          busy={busy}
          onChange={(cpuLevel) => change({ cpuLevel })}
          options={(['easy', 'normal', 'hard'] as const).map((v) => ({ value: v, label: t.draft.local.cpuLevels[v] }))}
          note={t.draft.local.cpuLevelTitles[value.cpuLevel ?? 'normal']}
        />
        <DraftChoice<DraftRollMode>
          label={tx.roll}
          value={value.roll}
          disabled={disabled}
          busy={busy}
          onChange={(roll) => change({ roll })}
          options={[
            { value: 'off', label: t.draft.off },
            { value: 'pick', label: tx.rollPick },
            { value: 'round', label: tx.rollRound },
          ]}
          note={value.roll === 'pick' ? tx.rollPickNote : value.roll === 'round' ? tx.rollRoundNote : tx.rollOffNote}
        />
        {randomMode && (
          <>
            {(typeRerollsOk || regionRerollsOk) && (
              <div className="draft-settings__pair">
                {typeRerollsOk && (
                  <DraftChoice
                    label={tx.rerollsType}
                    value={value.rerolls.type}
                    disabled={disabled}
                    busy={busy}
                    onChange={(type) => change({ rerolls: { ...value.rerolls, type } })}
                    options={REROLL_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
                  />
                )}
                {regionRerollsOk && (
                  <DraftChoice
                    label={tx.rerollsRegion}
                    value={value.rerolls.region}
                    disabled={disabled}
                    busy={busy}
                    onChange={(region) => change({ rerolls: { ...value.rerolls, region } })}
                    options={REROLL_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
                  />
                )}
              </div>
            )}
            <p className="draft-field-note draft-settings__rerollnote">{rerollNote}</p>
          </>
        )}
        <DraftChoice
          label={tx.timer}
          value={value.pickSeconds}
          disabled={disabled}
          busy={busy}
          onChange={(pickSeconds) => change({ pickSeconds })}
          options={TIMER_OPTIONS.map((s) => ({ value: s, label: timerLabel(t, s) }))}
          note={value.pickSeconds ? tx.timerNote : tx.noTimerNote}
        />
      </fieldset>

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
  const legends = settings.legendary
    ? settings.mythical
      ? tx.legendsBoth
      : tx.legendaryOnly
    : settings.mythical
      ? tx.mythicalOnly
      : tx.withoutLegends;
  const random = settings.roll === 'pick' || settings.roll === 'round';
  // Nur Rerolls, die gehen können (mehrere Typen bzw. Generationen)
  const typeRerolls = rerollUsable(settings, 'type') ? settings.rerolls.type : 0;
  const regionRerolls = rerollUsable(settings, 'region') ? settings.rerolls.region : 0;
  const rerolls =
    typeRerolls && regionRerolls
      ? tx.rerolls(typeRerolls, regionRerolls)
      : typeRerolls
        ? tx.rerollsTypeOnly(typeRerolls)
        : regionRerolls
          ? tx.rerollsRegionOnly(regionRerolls)
          : tx.noRerolls;
  const items: (string | null)[] = [
    tx.pool(gensLabel(t, settings.gens)),
    typesLabel(t, settings.types),
    legends,
    poolHasLegends(settings) && settings.maxLegends != null ? tx.maxLegends(settings.maxLegends) : null,
    !poolHasUltraBeasts(settings)
      ? tx.withoutUltraBeasts
      : settings.maxUltraBeasts != null
        ? tx.maxUltraBeasts(settings.maxUltraBeasts)
        : null,
    settings.forms ? tx.withForms : null,
    poolHasMegas(settings) ? (settings.maxMegas != null ? tx.maxMegas(settings.maxMegas) : tx.withMegas) : null,
    settings.setPiece ? tx.withSetPiece : tx.withoutSetPiece,
    settings.shinies === false ? tx.withoutShinies : settings.shinyParty ? tx.withShinyParty : null,
    settings.format === 'cup'
      ? settings.cupGroups
        ? tx.cupWithGroups(CUP_SIZE)
        : tx.cup(CUP_SIZE)
      : settings.format === 'manager'
        ? tx.manager(DRAFT_LIMITS.leagueSize, t.draft.settings.every(settings.matchdayMinutes), settings.bench)
        : tx.league(DRAFT_LIMITS.leagueSize),
    tx.maxTeams(settings.maxTeams),
    settings.order === 'random' ? tx.orderRandom : tx.orderHost,
    settings.snake ? tx.snake : tx.fixedOrder,
    // CPU-Stärke nur, wenn abweichend vom Standard
    settings.cpuLevel && settings.cpuLevel !== 'normal' ? `${t.draft.local.cpuLevel}: ${t.draft.local.cpuLevels[settings.cpuLevel]}` : null,
    random ? (settings.roll === 'pick' ? tx.rollPick : tx.rollRound) : null,
    random ? rerolls : null,
    settings.pickSeconds ? tx.perPick(settings.pickSeconds) : tx.noTimer,
    settings.visibility === 'public' ? tx.public : tx.private,
  ];
  return (
    <ul className="draft-summary">
      {items
        .filter((item): item is string => !!item)
        .map((item) => (
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
  /** Name übernehmen (Lobby) – mit Wert: genau diesen (z. B. nach 🎲), sonst den getippten */
  onCommit?: (name?: string) => void;
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
        <div className="input-row">
          <input
            id={id}
            className="input"
            value={name}
            maxLength={DRAFT_LIMITS.teamNameMax}
            placeholder={t.draft.settings.teamNamePlaceholder}
            autoComplete="off"
            disabled={disabled}
            onChange={(e) => onName(e.target.value)}
            onBlur={() => onCommit?.()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommit?.();
            }}
          />
          <RandomNameButton
            current={name}
            disabled={disabled}
            onPick={(n) => {
              const short = Array.from(n).slice(0, DRAFT_LIMITS.teamNameMax).join('');
              onName(short);
              // In der Lobby sofort übernehmen (wie Enter)
              onCommit?.(short);
            }}
          />
        </div>
      </div>
      <Segmented
        label={t.draft.formation}
        wrap
        value={formation}
        onChange={(f) => !disabled && onFormation(f)}
        options={FORMATION_IDS.map((f) => ({ value: f, label: f }))}
      />
      <button
        type="button"
        className="btn btn--small btn--ghost random-formation"
        disabled={disabled}
        title={t.common.randomFormationTitle}
        onClick={() => {
          // Eine andere als die aktuelle Formation
          const others = FORMATION_IDS.filter((f) => f !== formation);
          onFormation(others[Math.floor(Math.random() * others.length)]);
        }}
      >
        🎲 {t.common.randomFormation}
      </button>
    </div>
  );
}
