import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import type { SpriteStyle } from '../types';

export type Theme = 'dark' | 'light';

interface GlobalSettings {
  sprite: SpriteStyle;
  theme: Theme;
}

interface SettingsCtx extends GlobalSettings {
  setSprite(s: SpriteStyle): void;
  setTheme(t: Theme): void;
}

const DEFAULTS: GlobalSettings = { sprite: 'pixel', theme: 'dark' };
const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<GlobalSettings>(() => ({
    ...DEFAULTS,
    ...load<Partial<GlobalSettings>>(STORAGE_KEYS.settings, {}),
  }));

  useEffect(() => {
    save(STORAGE_KEYS.settings, settings);
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      settings.theme === 'dark' ? '#0d1b2a' : '#f3f6f9',
    );
  }, [settings]);

  const setSprite = useCallback((sprite: SpriteStyle) => setSettings((s) => ({ ...s, sprite })), []);
  const setTheme = useCallback((theme: Theme) => setSettings((s) => ({ ...s, theme })), []);

  const value = useMemo(() => ({ ...settings, setSprite, setTheme }), [settings, setSprite, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings außerhalb des Providers');
  return v;
}
