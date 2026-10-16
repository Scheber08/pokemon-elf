import { useFocusRescue } from '../lib/focusRescue';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FORMATION_IDS } from '../config/formations';
import { useT } from '../i18n';
import { LIMITS } from '../lib/api/contract';
import { averageScore, type ChallengeStats } from '../lib/challengeStats';
import type { NameField, NameIssues } from '../lib/runFinish';
import { formatRecord } from '../lib/season';
import type { FormationId } from '../types';
import { RandomNameButton } from './RandomNameButton';
import { Segmented } from './Segmented';
import '../styles/run.css';

/** Beispielverein im Platzhalter des Teamnamens (intern deutscher Name, übersetzt per game.club) */
const EXAMPLE_CLUB = 'Dynamo Mahagonia';

export function StatCards({ stats, showLast = false }: { stats: ChallengeStats; /** „Letzter Run“ dazu (Setup – im Ergebnis ist das der gerade gezeigte) */ showLast?: boolean }) {
  const t = useT();
  const last = showLast ? stats.last : undefined;
  return (
    <div className={`statcards ${last ? 'statcards--4' : ''}`}>
      <div className="statcard">
        <span className="statcard__label">{t.challenge.bestScore}</span>
        <span className="statcard__value">{stats.bestScore ?? '–'}</span>
      </div>
      <div className="statcard">
        <span className="statcard__label">{t.challenge.bestRecord}</span>
        <span className="statcard__value">{stats.bestRecord ? formatRecord(stats.bestRecord) : '–'}</span>
      </div>
      <div className="statcard">
        <span className="statcard__label">{t.challenge.runs}</span>
        <span className="statcard__value">{stats.runs}</span>
        {averageScore(stats) != null && <span className="statcard__sub statcard__avg">{t.challenge.avgScore(averageScore(stats)!)}</span>}
      </div>
      {last && (
        <div className="statcard statcard--last">
          <span className="statcard__label">{t.challenge.lastRun}</span>
          <span className="statcard__value">{last.score}</span>
          <span className="statcard__sub">{formatRecord(last.record)}</span>
        </div>
      )}
    </div>
  );
}

export function HowItWorks({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <aside className="howto card" aria-label={t.challenge.howItWorks}>
      <h2 className="section-title">{t.challenge.howItWorks}</h2>
      <p>{children}</p>
    </aside>
  );
}

/** Ids der Pflichtfelder – Setup und Nachfrage während des Runs sind nie gleichzeitig zu sehen. */
const FIELD_ID: Record<NameField, string> = { player: 'run-player-name', teamName: 'run-team-name' };

interface NameFieldsProps {
  playerName: string;
  teamName: string;
  onPlayerNameChange: (name: string) => void;
  onTeamNameChange: (name: string) => void;
  /** Fehlende/abgelehnte Felder – ein neuer Versuch (attempt) fokussiert das erste davon */
  issues?: NameIssues | null;
  disabled?: boolean;
}

/** Pflichtfelder eines Runs: Name auf der Rangliste und Teamname, mit Meldung direkt am Feld. */
export function NameFields({ playerName, teamName, onPlayerNameChange, onTeamNameChange, issues, disabled }: NameFieldsProps) {
  const t = useT();
  const playerRef = useRef<HTMLInputElement>(null);
  const teamRef = useRef<HTMLInputElement>(null);
  const refs: Record<NameField, RefObject<HTMLInputElement | null>> = { player: playerRef, teamName: teamRef };
  const focusRef = useRef(issues?.focus);
  focusRef.current = issues?.focus;
  const attempt = issues?.attempt;

  // Jeder gescheiterte Versuch fokussiert das erste fehlerhafte Feld – Tippen ändert attempt nicht.
  useEffect(() => {
    const focus = focusRef.current;
    if (attempt != null && focus) refs[focus].current?.focus();
  }, [attempt]);

  const field = (
    key: NameField,
    label: string,
    value: string,
    max: number,
    placeholder: string,
    onChange: (v: string) => void,
  ) => {
    const id = FIELD_ID[key];
    const error = issues?.[key];
    return (
      <div className={`field ${error ? 'field--invalid' : ''}`}>
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <div className="input-row">
          <input
            id={id}
            ref={refs[key]}
            className="input"
            maxLength={max}
            value={value}
            placeholder={placeholder}
            autoComplete={key === 'player' ? 'nickname' : 'off'}
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          {key === 'teamName' && (
            <RandomNameButton current={value} disabled={disabled} onPick={(n) => onChange(Array.from(n).slice(0, max).join(''))} />
          )}
        </div>
        {error && (
          // Neu angesagt bei jedem Fehlversuch (key) – auch wenn der Fokus schon im Feld steht.
          <p id={`${id}-error`} key={attempt} className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      {field('player', t.challenge.playerName, playerName, LIMITS.playerMax, t.challenge.playerNamePlaceholder, onPlayerNameChange)}
      {field(
        'teamName',
        t.challenge.teamName,
        teamName,
        LIMITS.teamNameMax,
        t.challenge.teamNamePlaceholder(t.game.club(EXAMPLE_CLUB)),
        onTeamNameChange,
      )}
    </>
  );
}

/**
 * Während des Runs: Name/Teamname fehlen noch (Run von vor der Namenspflicht) oder der Server
 * hat sie abgelehnt – hier nachtragen, dann erneut auswerten.
 */
export function RunNamesPrompt(props: NameFieldsProps) {
  const t = useT();
  return (
    <section className="card run-names" aria-label={t.challenge.namesAria}>
      <p className="run-names__text">{t.challenge.namesNeeded}</p>
      <NameFields {...props} />
    </section>
  );
}

interface SetupProps {
  formation: FormationId;
  ssEnabled: boolean;
  teamName: string;
  onChange: (v: { formation: FormationId; ssEnabled: boolean; teamName: string }) => void;
  /** Spielername (Pflicht) – so erscheint man in der Rangliste */
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  /** Fehlende/abgelehnte Pflichtfelder nach einem Startversuch */
  issues?: NameIssues | null;
  /** Startet den Run – der Button bleibt klickbar, fehlende Pflichtfelder meldet issues */
  onStart: () => void;
  extra?: ReactNode;
  /** Start läuft (z. B. Anfrage an den Server) – Button gesperrt */
  starting?: boolean;
  /** Hinweis unter dem Start-Button, z. B. Online-Status oder Fehler */
  note?: ReactNode;
}

export function RunSetup({
  formation,
  ssEnabled,
  teamName,
  onChange,
  playerName,
  onPlayerNameChange,
  issues,
  onStart,
  extra,
  starting,
  note,
}: SetupProps) {
  const t = useT();
  // „Neuer Run“: Der Knopf im Ergebnis ist weg – Fokus ins Setup statt an den Seitenanfang
  const setupRef = useRef<HTMLElement>(null);
  useFocusRescue(setupRef);
  return (
    <section ref={setupRef} tabIndex={-1} className="card setup" aria-label={t.challenge.setupAria}>
      {extra}
      <Segmented
        label={t.challenge.formation}
        wrap
        value={formation}
        onChange={(f) => onChange({ formation: f, ssEnabled, teamName })}
        options={FORMATION_IDS.map((f) => ({ value: f, label: f }))}
      />
      <Segmented
        label={t.game.posName.SS}
        value={ssEnabled}
        onChange={(v) => onChange({ formation, ssEnabled: v, teamName })}
        options={[
          { value: false, label: t.challenge.off },
          { value: true, label: t.challenge.on },
        ]}
      />
      <NameFields
        playerName={playerName}
        teamName={teamName}
        onPlayerNameChange={onPlayerNameChange}
        onTeamNameChange={(name) => onChange({ formation, ssEnabled, teamName: name })}
        issues={issues}
      />
      <button type="button" className="btn btn--primary btn--big" onClick={onStart} disabled={starting} aria-busy={starting}>
        {starting ? t.challenge.starting : t.challenge.start}
      </button>
      {note && <div className="setup__note">{note}</div>}
    </section>
  );
}

interface RollCardProps {
  label: string;
  value: ReactNode;
  rolling: boolean;
  /** Werte, die während der Animation durchlaufen */
  reel: ReactNode[];
  onSkip?: () => void;
  color?: string;
  textColor?: string;
}

/** Große Karte mit Slot-Machine-Animation. Klick/Tippen überspringt die Animation. */
export function RollCard({ label, value, rolling, reel, onSkip, color, textColor }: RollCardProps) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const reelRef = useRef(reel);
  reelRef.current = reel;

  useEffect(() => {
    if (!rolling) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 75);
    return () => window.clearInterval(id);
  }, [rolling]);

  const shown = rolling ? reelRef.current[(tick * 7) % Math.max(1, reelRef.current.length)] : value;
  return (
    <button
      type="button"
      className={`rollcard ${rolling ? 'is-rolling' : 'is-landed'}`}
      style={!rolling && color ? { background: color, color: textColor } : undefined}
      onClick={onSkip}
      aria-live="polite"
      aria-label={rolling ? t.challenge.rollingAria(label) : undefined}
    >
      <span className="rollcard__label">{label}</span>
      <span className="rollcard__value" key={rolling ? `r${tick}` : 'final'}>
        {shown}
      </span>
    </button>
  );
}

export function StatusLine({ items }: { items: ReactNode[] }) {
  return (
    <div className="statusline" role="status">
      {items.map((it, i) => (
        <span key={i} className="statusline__item">
          {it}
        </span>
      ))}
    </div>
  );
}

/** Würfel-Animation steuern: true für `ms`, danach false. Mit skip() sofort beenden. */
export function useRolling(ms = 1100) {
  const [rolling, setRolling] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const start = () => {
    window.clearTimeout(timer.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRolling(false);
      return;
    }
    setRolling(true);
    timer.current = window.setTimeout(() => setRolling(false), ms);
  };
  const skip = () => {
    window.clearTimeout(timer.current);
    setRolling(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { rolling, start, skip };
}
