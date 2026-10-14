import { useCallback, useState } from 'react';
import { cleanKit, type Kit } from '../lib/kits';
import { load, save, STORAGE_KEYS } from '../lib/storage';

/** Trikotfarben eines Modus auf diesem Gerät (localStorage) – reine Optik. null = Standard. */
export function useKit(scope: string): [Kit | null, (next: Kit | null) => void] {
  const key = STORAGE_KEYS.kit(scope);
  const [kit, setKit] = useState<Kit | null>(() => cleanKit(load<unknown>(key, null)));
  const update = useCallback(
    (next: Kit | null) => {
      const clean = cleanKit(next);
      save(key, clean);
      setKit(clean);
    },
    [key],
  );
  return [kit, update];
}
