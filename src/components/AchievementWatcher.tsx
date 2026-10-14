import { useEffect } from 'react';
import { useT } from '../i18n';
import { fetchMe } from '../lib/api/client';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import { useToast } from '../state/Toast';

/** Ereignis nach einem online gewerteten Run bzw. einer fertigen Online-Liga – prüft die Erfolge. */
export const ACHIEVEMENT_CHECK_EVENT = 'pokemon-elf:check-achievements';

/** Erfolge nachsehen lassen (z. B. nach einem gewerteten Run) – ohne Server bleibt es still. */
export function requestAchievementCheck(): void {
  window.dispatchEvent(new Event(ACHIEVEMENT_CHECK_EVENT));
}

/** Höchstens so viele Hinweise auf einmal */
const MAX_TOASTS = 3;

/**
 * Meldet neu erreichte Erfolge als Hinweis („Erfolg freigeschaltet: …"). Verglichen wird mit den
 * schon gesehenen (localStorage, wie auf der Trainer-Seite); ohne gespeicherte Liste wird sie nur
 * angelegt – sonst kämen beim ersten Mal alle alten Erfolge auf einmal.
 */
export function AchievementWatcher() {
  const t = useT();
  const toast = useToast();
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const me = await fetchMe();
        const seen = load<string[] | null>(STORAGE_KEYS.seenAchievements, null);
        const done = me.achievements.filter((a) => a.done);
        save(STORAGE_KEYS.seenAchievements, done.map((a) => a.id));
        if (!Array.isArray(seen)) return;
        const fresh = done.filter((a) => !seen.includes(a.id)).slice(0, MAX_TOASTS);
        for (const a of fresh) {
          const name = t.trainer.list[a.id]?.name ?? a.id;
          toast(`${t.trainer.unlocked(name)} (${t.trainer.reward(a.coins)} ◎)`);
        }
      } catch {
        // Offline oder Server-Fehler: kein Hinweis
      } finally {
        busy = false;
      }
    };
    window.addEventListener(ACHIEVEMENT_CHECK_EVENT, check);
    return () => window.removeEventListener(ACHIEVEMENT_CHECK_EVENT, check);
  }, [t, toast]);
  return null;
}
