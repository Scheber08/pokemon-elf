import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { detectLang, isLang, setCurrentLang, type Lang } from '../i18n/lang';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import type { SpriteStyle } from '../types';

export type Theme = 'dark' | 'light';

interface GlobalSettings {
  sprite: SpriteStyle;
  theme: Theme;
  lang: Lang;
}

interface SettingsCtx extends GlobalSettings {
  setSprite(s: SpriteStyle): void;
  setTheme(t: Theme): void;
  setLang(l: Lang): void;
}

const Ctx = createContext<SettingsCtx | null>(null);

function initialSettings(): GlobalSettings {
  const stored = load<Partial<GlobalSettings>>(STORAGE_KEYS.settings, {});
  const settings: GlobalSettings = {
    sprite: 'pixel',
    theme: 'dark',
    ...stored,
    // Ohne gespeicherte Wahl: Browsersprache (Deutsch → de, sonst en)
    lang: isLang(stored.lang) ? stored.lang : detectLang(),
  };
  // Schon vor dem ersten Rendern setzen, damit auch Nicht-React-Code die richtige Sprache kennt.
  setCurrentLang(settings.lang);
  return settings;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<GlobalSettings>(initialSettings);

  useEffect(() => {
    save(STORAGE_KEYS.settings, settings);
    setCurrentLang(settings.lang);
    document.documentElement.lang = settings.lang;
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      settings.theme === 'dark' ? '#0d1b2a' : '#f3f6f9',
    );
  }, [settings]);

  const setSprite = useCallback((sprite: SpriteStyle) => setSettings((s) => ({ ...s, sprite })), []);
  const setTheme = useCallback((theme: Theme) => setSettings((s) => ({ ...s, theme })), []);
  const setLang = useCallback((lang: Lang) => {
    setCurrentLang(lang);
    setSettings((s) => ({ ...s, lang }));
  }, []);

  const value = useMemo(
    () => ({ ...settings, setSprite, setTheme, setLang }),
    [settings, setSprite, setTheme, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings außerhalb des Providers');
  return v;
}
