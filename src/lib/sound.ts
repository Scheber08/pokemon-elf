/**
 * Kurze Signaltöne (Web Audio, ohne Audiodateien) – z. B. „Du bist dran" im Online-Draft.
 *
 * Browser spielen Ton erst nach einer Nutzeraktion: unlockAudio() hängt sich einmal an den
 * ersten Klick bzw. Tastendruck und startet dort den AudioContext. Ohne diese Freigabe
 * bleiben die Töne still (kein Fehler).
 */

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let armed = false;

function context(): Ctx | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

/** Bei der ersten Nutzeraktion den Ton freischalten (mehrfach aufrufbar). */
export function unlockAudio(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const unlock = () => {
    const c = context();
    if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
    if (c?.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** Ein Ton: Frequenz (Hz), Start (s ab jetzt), Dauer (s), Lautstärke 0–1. */
function tone(c: Ctx, freq: number, start: number, duration: number, volume: number, type: OscillatorType = 'sine') {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  // weicher Einsatz, exponentielles Ausklingen – kein Knacken
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Spielbar? (Kontext freigegeben) */
function ready(): Ctx | null {
  const c = context();
  if (!c) return null;
  if (c.state === 'suspended') {
    // Schon einmal freigegeben, aber z. B. vom System pausiert: Fortsetzen versuchen
    void c.resume().catch(() => undefined);
    return null;
  }
  return c.state === 'running' ? c : null;
}

/** „Du bist dran": zweistufiger Gong (aufsteigend). */
export function playTurnChime(): boolean {
  const c = ready();
  if (!c) return false;
  tone(c, 659.25, 0, 0.32, 0.22); // E5
  tone(c, 987.77, 0.13, 0.5, 0.2); // H5
  return true;
}

/** Zeit wird knapp: zwei kurze, tiefere Töne. */
export function playTimeWarning(): boolean {
  const c = ready();
  if (!c) return false;
  tone(c, 523.25, 0, 0.12, 0.16, 'triangle'); // C5
  tone(c, 523.25, 0.18, 0.12, 0.16, 'triangle');
  return true;
}

/** Vorschau beim Einschalten (läuft im Klick – gibt den Ton dabei frei). */
export function previewChime(): void {
  const c = context();
  if (!c) return;
  if (c.state === 'running') playTurnChime();
  else void c.resume().then(() => playTurnChime(), () => undefined);
}
