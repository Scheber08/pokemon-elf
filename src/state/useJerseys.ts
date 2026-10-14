import { useCallback, useState } from 'react';
import { cleanJerseys, type Jerseys } from '../lib/jerseys';
import { load, save, STORAGE_KEYS } from '../lib/storage';

/** Höchstens so viele gespeicherte Nummern je Modus (gelten über alle Runs) */
const MAX_STORED = 99;

/**
 * Eigene Trikotnummern eines Modus auf diesem Gerät (localStorage) – gelten für jedes Team des
 * Modus, in dem das Pokémon spielt. Reine Optik, Runs und Wertung bleiben unberührt.
 */
export function useJerseys(scope: string): [Jerseys, (next: Jerseys) => void] {
  const key = STORAGE_KEYS.jerseys(scope);
  const [jerseys, setJerseys] = useState<Jerseys>(() => cleanJerseys(load<unknown>(key, {}), undefined, MAX_STORED));
  const update = useCallback(
    (next: Jerseys) => {
      const clean = cleanJerseys(next, undefined, MAX_STORED);
      save(key, clean);
      setJerseys(clean);
    },
    [key],
  );
  return [jerseys, update];
}
