/**
 * Übersetzungen (Deutsch/Englisch).
 *
 *   const t = useT();             // in Komponenten – aktualisiert sich beim Sprachwechsel
 *   t.builder.saveImage           // String
 *   t.draft.round(3, 11)          // Funktion für Platzhalter/Mehrzahl
 *   messages().errors.network     // außerhalb von React (Hooks-Helfer, runFinish …)
 *
 * Neue Texte: Schlüssel in src/i18n/de/<bereich>.ts anlegen, dieselbe Form in
 * src/i18n/en/<bereich>.ts übersetzen – fehlt etwas, schlägt die Typprüfung fehl.
 */
import { useSettings } from '../state/Settings';
import { de, type Messages } from './de';
import { en } from './en';
import { currentLang, type Lang } from './lang';

export * from './lang';
export type { Messages };

const CATALOGS: Record<Lang, Messages> = { de, en };

/** Katalog einer Sprache (Standard: aktive Sprache) – auch außerhalb von React nutzbar. */
export function messages(lang: Lang = currentLang()): Messages {
  return CATALOGS[lang];
}

/** Katalog der aktiven Sprache für Komponenten. */
export function useT(): Messages {
  return CATALOGS[useSettings().lang];
}

export function useLang(): Lang {
  return useSettings().lang;
}
