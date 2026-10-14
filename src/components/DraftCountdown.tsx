import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { remainingMs } from '../state/useDraftRoom';
import '../styles/draft.css';

interface Props {
  /** Ablauf der Bedenkzeit (Serverzeit) oder null */
  deadline: number | null;
  /** Bedenkzeit pro Pick in Sekunden, 0 = ohne Timer */
  pickSeconds: number;
  clockOffset: number;
  /** Team am Zug ist eine CPU (wählt ohne Timer gleich selbst) */
  cpu: boolean;
  /** Eigener Pick: bei knapper Zeit einmal kurz vibrieren (Handy) */
  mine?: boolean;
}

function formatSeconds(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Restzeit des aktuellen Picks als Balken – nach Serveruhr (clockOffset). Eigene Komponente, damit
 * nur sie tickt. Keine Live-Region: Picks sagt DraftLive einmal an.
 */
export function DraftCountdown({ deadline, pickSeconds, clockOffset, cpu, mine = false }: Props) {
  const t = useT();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (deadline == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  const left = remainingMs(deadline, clockOffset, now);
  const urgent = left != null && left <= 10_000;
  // Einmal je Pick (Deadline) – nur wenn die Zeit noch läuft, nicht nach einem Neuladen bei 0
  const buzzed = useRef<number | null>(null);
  useEffect(() => {
    if (!mine || !urgent || !pickSeconds || deadline == null || buzzed.current === deadline || !left) return;
    buzzed.current = deadline;
    try {
      navigator.vibrate?.([120, 80, 120]);
    } catch {
      // Ohne Vibration (Desktop, Browser verbietet es) einfach nichts tun
    }
  }, [mine, urgent, deadline]);

  if (cpu) {
    return (
      <div className="draft-timer draft-timer--idle">
        <span className="boot__ball boot__ball--small" aria-hidden="true" />
        {t.online.cpuPicking}
      </div>
    );
  }
  if (left == null || !pickSeconds) {
    return (
      <div className="draft-timer draft-timer--idle">{t.online.noTimer}</div>
    );
  }
  const share = Math.max(0, Math.min(1, left / (pickSeconds * 1000)));
  return (
    <div className={`draft-timer ${urgent ? 'draft-timer--urgent' : ''}`}>
      <div
        className="draft-timer__bar"
        role="progressbar"
        aria-label={t.online.timeLeftAria}
        aria-valuemin={0}
        aria-valuemax={pickSeconds}
        aria-valuenow={Math.ceil(left / 1000)}
      >
        <span style={{ transform: `scaleX(${share})` }} />
      </div>
      <span className="draft-timer__time" role="timer">
        {formatSeconds(left)}
      </span>
    </div>
  );
}
