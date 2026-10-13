import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DraftSettingsForm, DraftTeamFields } from '../components/DraftSettingsForm';
import { regionLabel } from '../config/regions';
import { ApiRequestError } from '../lib/api/client';
import { createDraft, fetchPublicLobbies, isDraftCode, normalizeDraftCode } from '../lib/api/draftClient';
import {
  DEFAULT_DRAFT_SETTINGS,
  DRAFT_LIMITS,
  type DraftSettings,
  type PublicLobby,
} from '../lib/api/draftContract';
import { normalizeSettings } from '../lib/draftEngine';
import { load, save } from '../lib/storage';
import { usePokemonData } from '../state/PokemonData';
import {
  cleanTeamName,
  loadRecentLeagues,
  loadTeamPrefs,
  saveTeamPrefs,
  type RecentLeague,
  type TeamPrefs,
} from '../state/useDraftRoom';
import type { Pokemon } from '../types';
import '../styles/draft.css';

const SETTINGS_KEY = 'draft-online:settings';
/** Öffentliche Lobbys neu laden, solange die Seite offen ist */
const LOBBY_REFRESH_MS = 20_000;

/** Zuletzt benutzte Einstellungen (Liganame nicht) – ungültige Reste fallen auf die Standardwerte zurück. */
function initialSettings(list: Pokemon[]): DraftSettings {
  const stored = load<Partial<DraftSettings> | null>(SETTINGS_KEY, null);
  try {
    return { ...normalizeSettings({ ...stored, name: '' }, DEFAULT_DRAFT_SETTINGS, list) };
  } catch {
    return { ...DEFAULT_DRAFT_SETTINGS };
  }
}

function errorText(e: unknown): string {
  return e instanceof ApiRequestError ? e.message : 'Unbekannter Fehler – bitte erneut versuchen';
}

/** Neue Liga erstellen → /draft/CODE */
function CreateLeague() {
  const { list } = usePokemonData();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<DraftSettings>(() => initialSettings(list));
  const [team, setTeam] = useState<TeamPrefs>(loadTeamPrefs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const teamName = cleanTeamName(team.name);
    if (!teamName) {
      setError('Gib deinem Team einen Namen');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { code } = await createDraft({
        settings: { ...settings, name: settings.name.trim() },
        teamName,
        formation: team.formation,
      });
      saveTeamPrefs({ name: teamName, formation: team.formation });
      save(SETTINGS_KEY, { ...settings, name: '' });
      navigate(`/draft/${code}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form className="card draft-create" aria-labelledby="draft-create-title" onSubmit={submit}>
      <h2 id="draft-create-title" className="section-title">
        Neue Liga erstellen
      </h2>
      <DraftSettingsForm value={settings} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} list={list} />
      <h3 className="draft-subtitle">Dein Team</h3>
      <DraftTeamFields
        name={team.name}
        formation={team.formation}
        onName={(name) => setTeam((t) => ({ ...t, name }))}
        onFormation={(formation) => setTeam((t) => ({ ...t, formation }))}
      />
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--primary btn--big" disabled={busy || !cleanTeamName(team.name)} aria-busy={busy}>
        {busy ? 'Liga wird erstellt …' : 'Liga erstellen'}
      </button>
      <p className="muted small">Du bist Host: Du stellst ein, fügst CPU-Teams hinzu und startest den Draft.</p>
    </form>
  );
}

/** Mit Code beitreten (auch eingefügte Links werden erkannt). */
function JoinByCode() {
  const navigate = useNavigate();
  const id = useId();
  const [code, setCode] = useState('');
  const valid = isDraftCode(code);
  return (
    <form
      className="card draft-joincode"
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) navigate(`/draft/${code}`);
      }}
    >
      <h2 id={`${id}-title`} className="section-title">
        Mit Code beitreten
      </h2>
      <label className="sr-only" htmlFor={id}>
        Liga-Code
      </label>
      <div className="draft-joincode__row">
        <input
          id={id}
          className="input draft-codeinput"
          value={code}
          placeholder="ABC234"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setCode(normalizeDraftCode(e.target.value))}
        />
        <button type="submit" className="btn btn--primary" disabled={!valid}>
          Beitreten
        </button>
      </div>
      <p id={`${id}-hint`} className="muted small">
        {DRAFT_LIMITS.codeLength} Zeichen – oder einfach den Einladungslink einfügen.
      </p>
    </form>
  );
}

const PHASE_LABEL: Record<RecentLeague['phase'], string> = {
  lobby: 'Lobby',
  drafting: 'Draft läuft',
  done: 'Fertig',
};

/** Ligen, in denen dieses Gerät mitspielt – zum Zurückkehren ohne Link (nur lokal gespeichert). */
function RecentLeagues() {
  const [leagues] = useState(() => loadRecentLeagues());
  if (!leagues.length) return null;
  return (
    <section className="card draft-lobbies" aria-labelledby="draft-recent-title">
      <h2 id="draft-recent-title" className="section-title">
        Deine Ligen
      </h2>
      <ul className="draft-lobbies__list">
        {leagues.map((l) => (
          <li key={l.code} className="draft-lobbies__item">
            <div className="draft-lobbies__info">
              <strong className="draft-lobbies__name">{l.name || `Liga ${l.code}`}</strong>
              <span className="draft-lobbies__facts">
                <span>{l.team}</span>
                <span>{PHASE_LABEL[l.phase] ?? ''}</span>
                <span>{ago(l.at)}</span>
              </span>
            </div>
            <Link className={`btn btn--small ${l.phase === 'done' ? '' : 'btn--primary'}`} to={`/draft/${l.code}`}>
              {l.phase === 'done' ? 'Ergebnis' : 'Weiter'}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function timerLabel(seconds: number): string {
  return seconds ? `${seconds} s` : 'ohne Timer';
}

function ago(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  return `vor ${Math.round(min / 60)} Std.`;
}

/** Liste der öffentlichen Lobbys mit Aktualisieren. */
function PublicLobbies() {
  const [lobbies, setLobbies] = useState<PublicLobby[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchPublicLobbies()
      .then((res) => {
        setLobbies([...(res.lobbies ?? [])].sort((a, b) => b.createdAt - a.createdAt));
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => document.visibilityState === 'visible' && refresh(), LOBBY_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <section className="card draft-lobbies" aria-labelledby="draft-lobbies-title">
      <div className="draft-lobbies__head">
        <h2 id="draft-lobbies-title" className="section-title">
          Öffentliche Lobbys
        </h2>
        <button type="button" className="btn btn--small btn--ghost" onClick={refresh} disabled={loading} aria-busy={loading}>
          {loading ? 'Lädt …' : 'Aktualisieren'}
        </button>
      </div>
      {error && <p className="notice notice--error">{error}</p>}
      {lobbies && !lobbies.length && !error && (
        <p className="muted small">Gerade wartet keine öffentliche Liga. Erstelle selbst eine – Lobby „Öffentlich".</p>
      )}
      {lobbies && lobbies.length > 0 && (
        <ul className="draft-lobbies__list">
          {lobbies.map((l) => {
            const full = l.teams >= l.maxTeams;
            return (
              <li key={l.code} className="draft-lobbies__item">
                <div className="draft-lobbies__info">
                  <strong className="draft-lobbies__name">{l.name || `Liga ${l.code}`}</strong>
                  <span className="muted small">
                    von {l.hostName} · {ago(l.createdAt)}
                  </span>
                  <span className="draft-lobbies__facts">
                    <span>
                      {l.teams}/{l.maxTeams} Teams
                    </span>
                    <span>
                      {regionLabel(l.region)}
                      {l.legends ? ' + Legendäre' : ''}
                    </span>
                    <span>{timerLabel(l.pickSeconds)}</span>
                  </span>
                </div>
                <Link className={`btn btn--small ${full ? '' : 'btn--primary'}`} to={`/draft/${l.code}`}>
                  {full ? 'Zuschauen' : 'Beitreten'}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {!lobbies && !error && <p className="muted small">Lädt …</p>}
    </section>
  );
}

interface Props {
  /** Umschalter Online-Liga / An einem Gerät */
  modeSwitch: ReactNode;
  /** Server kann Online-Ligen: null = wird noch geprüft */
  supported: boolean | null;
  onRetry: () => void;
  onLocal: () => void;
}

/** Online-Modus von /draft: Liga erstellen, mit Code beitreten, öffentliche Lobbys. */
export function DraftOnline({ modeSwitch, supported, onRetry, onLocal }: Props) {
  return (
    <div className="page draft draft-online">
      {modeSwitch}
      <header className="page-head">
        <h1 className="page-title">Fantasy-Draft</h1>
        <p className="page-lead">
          Online-Liga mit Freunden: Liga erstellen, Link teilen, live im Snake-Draft wählen – mit Pick-Timer, CPU-Teams
          und einer gemeinsamen Saison zum Schluss.
        </p>
      </header>
      {supported == null && (
        <p className="runnet runnet--checking" role="status">
          <span className="runnet__dot" aria-hidden="true" />
          Prüfe, ob Online-Ligen verfügbar sind …
        </p>
      )}
      {supported === false && (
        <div className="notice draft-offline" role="status">
          <p>
            <strong>Online-Ligen sind gerade nicht verfügbar</strong> – der Server ist nicht erreichbar oder kann noch
            keine Ligen. Ihr könnt trotzdem an einem Gerät draften.
          </p>
          <div className="actionbar">
            <button type="button" className="btn btn--primary btn--small" onClick={onLocal}>
              An einem Gerät spielen
            </button>
            <button type="button" className="btn btn--small" onClick={onRetry}>
              Erneut prüfen
            </button>
          </div>
        </div>
      )}
      {supported && (
        <div className="draft-online__grid">
          <CreateLeague />
          <div className="draft-online__side">
            <RecentLeagues />
            <JoinByCode />
            <PublicLobbies />
            <p className="muted small">
              Ligen werden nach {DRAFT_LIMITS.retentionDays} Tagen gelöscht. Mehr dazu im{' '}
              <Link to="/datenschutz">Datenschutz</Link>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
