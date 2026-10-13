/**
 * Aktive Sprache – ohne React, damit auch Hooks, runFinish & Co. Texte in der
 * aktuellen Sprache erzeugen können. Der SettingsProvider hält sie aktuell.
 */
export type Lang = 'de' | 'en';
export const LANGS: Lang[] = ['de', 'en'];

let current: Lang = 'de';

export function currentLang(): Lang {
  return current;
}

export function setCurrentLang(lang: Lang): void {
  current = lang;
}

export function isLang(x: unknown): x is Lang {
  return x === 'de' || x === 'en';
}

/** Startsprache: Browser auf Deutsch → de, sonst en. */
export function detectLang(): Lang {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    return langs.some((l) => l?.toLowerCase().startsWith('de')) ? 'de' : 'en';
  } catch {
    return 'de';
  }
}

export function localeOf(lang: Lang = current): string {
  return lang === 'de' ? 'de-DE' : 'en-US';
}

/** Zahl im Format der Sprache (de: 1,5 · en: 1.5). */
export function fmtNumber(n: number, digits = 0, lang: Lang = current): string {
  return n.toLocaleString(localeOf(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
