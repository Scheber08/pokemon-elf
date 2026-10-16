/** Zeitangaben relativ zu jetzt – geteilt von Online-Lobbys und Spielerprofil. */
import type { Messages } from '../i18n';

/** „gerade eben“, „vor 5 Min.“, „vor 3 Std.“ – ab zwei Tagen „vor 4 Tagen“ statt „vor 96 Std.“ */
export function ago(ms: number, t: Messages, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 1) return t.online.justNow;
  if (min < 60) return t.online.minutesAgo(min);
  const hours = Math.round(min / 60);
  if (hours < 48) return t.online.hoursAgo(hours);
  return t.online.daysAgo(Math.round(hours / 24));
}
