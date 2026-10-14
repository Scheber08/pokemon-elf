import { useCallback, useState } from 'react';
import { cleanCrest, type Crest } from '../lib/crest';
import { load, save, STORAGE_KEYS } from '../lib/storage';

/** Vereinswappen eines Modus auf diesem Gerät (localStorage) – reine Optik. null = keins. */
export function useCrest(scope: string): [Crest | null, (next: Crest | null) => void] {
  const key = STORAGE_KEYS.crest(scope);
  const [crest, setCrest] = useState<Crest | null>(() => cleanCrest(load<unknown>(key, null)));
  const update = useCallback(
    (next: Crest | null) => {
      const clean = cleanCrest(next);
      save(key, clean);
      setCrest(clean);
    },
    [key],
  );
  return [crest, update];
}
