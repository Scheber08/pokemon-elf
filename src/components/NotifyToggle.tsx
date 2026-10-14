import { useT } from '../i18n';
import { notifyPermission, notifySupported, requestNotify } from '../lib/notify';
import { useSettings } from '../state/Settings';
import { useToast } from '../state/Toast';
import '../styles/draft.css';

/** Browser-Benachrichtigung an/aus (gespeichert) – beim Einschalten wird um Erlaubnis gefragt. */
export function NotifyToggle() {
  const t = useT();
  const { notify, setNotify } = useSettings();
  const toast = useToast();
  if (!notifySupported()) return null;
  const on = notify && notifyPermission() === 'granted';
  return (
    <button
      type="button"
      className={`draft-sound ${on ? 'is-on' : ''}`}
      aria-pressed={on}
      title={t.online.notifyTitle}
      onClick={async () => {
        if (on) return setNotify(false);
        if (await requestNotify()) setNotify(true);
        else toast(t.online.notifyDenied);
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0" fill="currentColor" />
      </svg>
      <span>{on ? t.online.notifyOn : t.online.notifyOff}</span>
    </button>
  );
}
