import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FORMATION_IDS } from '../config/formations';
import type { ChallengeStats } from '../lib/challengeStats';
import { formatRecord } from '../lib/season';
import type { FormationId } from '../types';
import { Segmented } from './Segmented';
import '../styles/run.css';

export function StatCards({ stats }: { stats: ChallengeStats }) {
  return (
    <div className="statcards">
      <div className="statcard">
        <span className="statcard__label">Bester Score</span>
        <span className="statcard__value">{stats.bestScore ?? '–'}</span>
      </div>
      <div className="statcard">
        <span className="statcard__label">Beste Bilanz</span>
        <span className="statcard__value">{stats.bestRecord ? formatRecord(stats.bestRecord) : '–'}</span>
      </div>
      <div className="statcard">
        <span className="statcard__label">Runs</span>
        <span className="statcard__value">{stats.runs}</span>
      </div>
    </div>
  );
}

export function HowItWorks({ children }: { children: ReactNode }) {
  return (
    <aside className="howto card" aria-label="So funktioniert's">
      <h2 className="section-title">So funktioniert's</h2>
      <p>{children}</p>
    </aside>
  );
}

interface SetupProps {
  formation: FormationId;
  ssEnabled: boolean;
  teamName: string;
  onChange: (v: { formation: FormationId; ssEnabled: boolean; teamName: string }) => void;
  onStart: () => void;
  extra?: ReactNode;
  /** Start läuft (z. B. Anfrage an den Server) – Button gesperrt */
  starting?: boolean;
  /** Hinweis unter dem Start-Button, z. B. Online-Status oder Fehler */
  note?: ReactNode;
}

export function RunSetup({ formation, ssEnabled, teamName, onChange, onStart, extra, starting, note }: SetupProps) {
  return (
    <section className="card setup" aria-label="Run vorbereiten">
      {extra}
      <Segmented
        label="Formation"
        wrap
        value={formation}
        onChange={(f) => onChange({ formation: f, ssEnabled, teamName })}
        options={FORMATION_IDS.map((f) => ({ value: f, label: f }))}
      />
      <Segmented
        label="Standardschütze"
        value={ssEnabled}
        onChange={(v) => onChange({ formation, ssEnabled: v, teamName })}
        options={[
          { value: false, label: 'Aus' },
          { value: true, label: 'An' },
        ]}
      />
      <div className="field">
        <label className="field__label" htmlFor="run-team-name">
          Teamname <small>(optional)</small>
        </label>
        <input
          id="run-team-name"
          className="input"
          maxLength={32}
          value={teamName}
          placeholder="z. B. Dynamo Mahagonia"
          onChange={(e) => onChange({ formation, ssEnabled, teamName: e.target.value })}
        />
      </div>
      <button type="button" className="btn btn--primary btn--big" onClick={onStart} disabled={starting} aria-busy={starting}>
        {starting ? 'Starte …' : 'Run starten'}
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
      aria-label={rolling ? `${label}: wird gewürfelt – tippen zum Überspringen` : undefined}
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
