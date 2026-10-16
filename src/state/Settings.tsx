import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { currentLang, detectLang, isLang, setCurrentLang, type Lang } from '../i18n/lang';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import type { SpriteStyle } from '../types';

export type Theme = 'dark' | 'light';

interface GlobalSettings {
  sprite: SpriteStyle;
  theme: Theme;
  lang: Lang;
  /** Signaltöne (z. B. „Du bist dran" im Online-Draft) */
  sound: boolean;
  /** Browser-Benachrichtigung, wenn man im Online-Draft dran ist (Tab im Hintergrund) */
  notify: boolean;
  /** Spielwiedergabe beim Klick aufs Ergebnis: 2D-Ansicht, Bericht oder aus */
  replay: ReplayMode;
}

export type ReplayMode = 'pitch' | 'report' | 'off';
const isReplayMode = (v: unknown): v is ReplayMode => v === 'pitch' || v === 'report' || v === 'off';

interface SettingsCtx extends GlobalSettings {
  setSprite(s: SpriteStyle): void;
  setTheme(t: Theme): void;
  setLang(l: Lang): void;
  setSound(on: boolean): void;
  setNotify(on: boolean): void;
  setReplay(mode: ReplayMode): void;
}

const Ctx = createContext<SettingsCtx | null>(null);

/** Design ohne gespeicherte Wahl: wie das Gerät (hell/dunkel), sonst dunkel */
export function detectTheme(): Theme {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function initialSettings(): GlobalSettings {
  const stored = load<Partial<GlobalSettings>>(STORAGE_KEYS.settings, {});
  const settings: GlobalSettings = {
    sprite: 'pixel',
    ...stored,
    theme: stored.theme === 'light' || stored.theme === 'dark' ? stored.theme : detectTheme(),
    sound: stored.sound !== false,
    notify: stored.notify === true,
    replay: isReplayMode(stored.replay) ? stored.replay : 'pitch',
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
  const setSound = useCallback((sound: boolean) => setSettings((s) => ({ ...s, sound })), []);
  const setNotify = useCallback((notify: boolean) => setSettings((s) => ({ ...s, notify })), []);
  const setReplay = useCallback((replay: ReplayMode) => setSettings((s) => ({ ...s, replay })), []);

  const value = useMemo(
    () => ({ ...settings, setSprite, setTheme, setLang, setSound, setNotify, setReplay }),
    [settings, setSprite, setTheme, setLang, setSound, setNotify, setReplay],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const noop = () => {};

/**
 * Ohne Provider – statisches Rendern (Tests) oder eigene Wurzeln wie der Bild-Export:
 * gespeicherte Werte in der aktiven Sprache, Änderungen wirken nicht.
 */
function fallbackSettings(): SettingsCtx {
  const stored = load<Partial<GlobalSettings>>(STORAGE_KEYS.settings, {});
  return {
    sprite: stored.sprite ?? 'pixel',
    theme: stored.theme ?? 'dark',
    lang: currentLang(),
    sound: stored.sound ?? true,
    notify: stored.notify === true,
    replay: isReplayMode(stored.replay) ? stored.replay : 'pitch',
    setSprite: noop,
    setTheme: noop,
    setLang: noop,
    setSound: noop,
    setNotify: noop,
    setReplay: noop,
  };
}

export function useSettings(): SettingsCtx {
  return useContext(Ctx) ?? fallbackSettings();
}
