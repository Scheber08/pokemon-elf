import { useEffect, useState } from 'react';
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
}

function formatSeconds(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Restzeit des aktuellen Picks als Balken – nach Serveruhr (clockOffset). Eigene Komponente, damit
 * nur sie tickt. Keine Live-Region: Picks sagt DraftLive einmal an.
 */
export function DraftCountdown({ deadline, pickSeconds, clockOffset, cpu }: Props) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (deadline == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  if (cpu) {
    return (
      <div className="draft-timer draft-timer--idle">
        <span className="boot__ball boot__ball--small" aria-hidden="true" /> CPU wählt …
      </div>
    );
  }
  const left = remainingMs(deadline, clockOffset, now);
  if (left == null || !pickSeconds) {
    return (
      <div className="draft-timer draft-timer--idle">
        ohne Timer
      </div>
    );
  }
  const share = Math.max(0, Math.min(1, left / (pickSeconds * 1000)));
  const urgent = left <= 10_000;
  return (
    <div className={`draft-timer ${urgent ? 'draft-timer--urgent' : ''}`}>
      <div
        className="draft-timer__bar"
        role="progressbar"
        aria-label="Restzeit für diesen Pick"
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
