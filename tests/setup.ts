/**
 * Gemeinsamer Test-Start: Die Oberfläche spricht in Tests Deutsch – unabhängig von der
 * Systemsprache (detectLang liest navigator.languages). Tests für Englisch schalten selbst um
 * (setCurrentLang bzw. gespeicherte Einstellung lang: 'en').
 */
import { setCurrentLang } from '../src/i18n/lang';

Object.defineProperty(globalThis, 'navigator', {
  value: { ...(globalThis.navigator ?? {}), language: 'de-DE', languages: ['de-DE'] },
  configurable: true,
  writable: true,
});
setCurrentLang('de');
