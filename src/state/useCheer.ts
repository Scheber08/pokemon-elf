import { useCallback, useState } from 'react';
import { cleanCheer } from '../lib/cheer';
import { load, save, STORAGE_KEYS } from '../lib/storage';

/** Torjubel eines Modus auf diesem Gerät (localStorage) – reine Optik. '' = keiner. */
export function useCheer(scope: string): [string, (next: string) => void] {
  const key = STORAGE_KEYS.cheer(scope);
  const [cheer, setCheer] = useState<string>(() => cleanCheer(load<unknown>(key, '')));
  const update = useCallback(
    (next: string) => {
      const clean = cleanCheer(next);
      save(key, clean);
      setCheer(clean);
    },
    [key],
  );
  return [cheer, update];
}
