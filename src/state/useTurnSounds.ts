import { useEffect, useRef } from 'react';
import { playTimeWarning, playTurnChime, unlockAudio } from '../lib/sound';
import { remainingMs } from './useDraftRoom';

/** So lange vor Ablauf des Pick-Timers kommt der Warnton (ms) */
export const TURN_WARNING_MS = 10_000;

/** Merker für den Gong: schon beobachtet? Für welchen Pick schon gegongt (bzw. beim Laden schon dran)? */
export interface TurnChimeMemo {
  seen: boolean;
  pick: number | null;
}

export const TURN_CHIME_START: TurnChimeMemo = { seen: false, pick: null };

export interface TurnObservation {
  /** Eigener Live-Stand (nicht nur die öffentliche Vorschau) */
  live: boolean;
  myTurn: boolean;
  pickIndex: number;
  /** Der letzte Pick war der eigene, von Hand – man ist also gerade da */
  ownManualLast: boolean;
}

/**
 * Gong fällig? Einmal pro eigenem Zug – nicht beim Laden der Seite (schon dran), nicht direkt
 * nach dem eigenen Pick (Snake: zwei Picks hintereinander), und nicht nachträglich, wenn der
 * Ton erst während des Zugs eingeschaltet wird (der Zug zählt trotzdem als gesehen).
 */
export function turnChimeDue(memo: TurnChimeMemo, o: TurnObservation): { memo: TurnChimeMemo; chime: boolean } {
  if (!o.live) return { memo, chime: false };
  if (!memo.seen) return { memo: { seen: true, pick: o.myTurn ? o.pickIndex : null }, chime: false };
  if (!o.myTurn || memo.pick === o.pickIndex) return { memo, chime: false };
  return { memo: { seen: true, pick: o.pickIndex }, chime: !o.ownManualLast };
}

interface Input extends TurnObservation {
  enabled: boolean;
  /** Ablauf des aktuellen Picks (Serverzeit) oder null */
  deadline: number | null;
  clockOffset: number;
}

/** Signaltöne im Online-Draft: Gong, wenn man dran ist, und Warnton 10 s vor Ablauf des Timers. */
export function useTurnSounds({ enabled, live, myTurn, pickIndex, ownManualLast, deadline, clockOffset }: Input): void {
  useEffect(() => unlockAudio(), []);

  const memo = useRef<TurnChimeMemo>(TURN_CHIME_START);
  useEffect(() => {
    const { memo: next, chime } = turnChimeDue(memo.current, { live, myTurn, pickIndex, ownManualLast });
    memo.current = next;
    if (chime && enabled) playTurnChime();
    // ownManualLast gehört zum selben Schnappschuss wie pickIndex – kein eigener Auslöser
  }, [live, myTurn, pickIndex, enabled]);

  // Warnton einmal pro Pick (Deadline). Ein Uhrabgleich kurz vor der Marke holt ihn sofort nach;
  // wer die Deadline erst knapp vor Ablauf sieht (z. B. nach dem Neuladen), bekommt keinen.
  const warned = useRef<{ deadline: number | null; done: boolean }>({ deadline: null, done: false });
  useEffect(() => {
    if (!enabled || !live || !myTurn || deadline == null) return;
    const left = remainingMs(deadline, clockOffset);
    if (left == null) return;
    const known = warned.current.deadline === deadline;
    if (!known) warned.current = { deadline, done: false };
    if (warned.current.done) return;
    const fire = () => {
      warned.current = { deadline, done: true };
      playTimeWarning();
    };
    if (left <= TURN_WARNING_MS) {
      if (known && left > 0) fire();
      else warned.current = { deadline, done: true };
      return;
    }
    const id = window.setTimeout(fire, left - TURN_WARNING_MS);
    return () => window.clearTimeout(id);
  }, [enabled, live, myTurn, deadline, clockOffset]);
}
