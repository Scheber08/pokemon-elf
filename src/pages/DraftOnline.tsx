import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DraftSettingsForm, DraftTeamFields } from '../components/DraftSettingsForm';
import { DRAFT_PRESET_IDS, DRAFT_PRESETS } from '../config/draftPresets';
import { useT, type Messages } from '../i18n';
import { ApiRequestError } from '../lib/api/client';
import { createDraft, fetchPublicLobbies, isDraftCode, normalizeDraftCode } from '../lib/api/draftClient';
import {
  DEFAULT_DRAFT_SETTINGS,
  DRAFT_LIMITS,
  LOBBY_REGION_MANY,
  type DraftSettings,
  type DraftSettingsPatch,
  type PublicLobby,
} from '../lib/api/draftContract';
import { normalizeSettings } from '../lib/draftEngine';
import { load, save } from '../lib/storage';
import { usePokemonData } from '../state/PokemonData';
import {
  cleanTeamName,
  draftErrorText,
  fitSettingsPatch,
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

/**
 * Zuletzt benutzte Einstellungen (Liganame nicht) – ungültige Reste fallen auf die Standardwerte
 * zurück. Ältere Stände (region/legends) schreibt normalizeSettings um.
 */
function initialSettings(list: Pokemon[]): DraftSettings {
  const stored = load<DraftSettingsPatch | null>(SETTINGS_KEY, null);
  try {
    return { ...normalizeSettings({ ...stored, name: '' }, DEFAULT_DRAFT_SETTINGS, list) };
  } catch {
    return { ...DEFAULT_DRAFT_SETTINGS };
  }
}

function errorText(e: unknown, t: Messages): string {
  return e instanceof ApiRequestError ? draftErrorText(e.message, e.code) : t.online.unknownRetry;
}

/** Neue Liga erstellen → /draft/CODE */
function CreateLeague() {
  const t = useT();
  const { all: list } = usePokemonData();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<DraftSettings>(() => initialSettings(list));
  const [team, setTeam] = useState<TeamPrefs>(loadTeamPrefs);
  const [busy, setBusy] = useState(false);
  /** Fehler – Text erst beim Rendern (folgt der Sprache) */
  const [failure, setFailure] = useState<{ err: unknown } | 'teamNameMissing' | null>(null);
  const error = failure === 'teamNameMissing' ? t.online.teamNameMissing : failure ? errorText(failure.err, t) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const teamName = cleanTeamName(team.name);
    if (!teamName) {
      setFailure('teamNameMissing');
      return;
    }
    setBusy(true);
    setFailure(null);
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
      setFailure({ err });
      setBusy(false);
    }
  };

  return (
    <form className="card draft-create" aria-labelledby="draft-create-title" onSubmit={submit}>
      <h2 id="draft-create-title" className="section-title">
        {t.online.createTitle}
      </h2>
      <div className="field draft-presets">
        <span className="field__label">{t.online.presets}</span>
        <div className="chips">
          {DRAFT_PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="chip"
              title={t.online.presetNote[id]}
              onClick={() => {
                // Vorlage anwenden; reicht der Pool nicht für die gewählte Teamzahl, sinkt sie mit
                const fitted = fitSettingsPatch(settings, DRAFT_PRESETS[id], list);
                if (fitted) setSettings((s) => ({ ...s, ...fitted }));
              }}
            >
              {t.online.presetName[id]}
            </button>
          ))}
        </div>
      </div>
      <DraftSettingsForm value={settings} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} list={list} />
      <h3 className="draft-subtitle">{t.online.yourTeam}</h3>
      <DraftTeamFields
        name={team.name}
        formation={team.formation}
        onName={(name) => setTeam((x) => ({ ...x, name }))}
        onFormation={(formation) => setTeam((x) => ({ ...x, formation }))}
      />
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--primary btn--big" disabled={busy || !cleanTeamName(team.name)} aria-busy={busy}>
        {busy ? t.online.creating : t.online.create}
      </button>
      <p className="muted small">{t.online.createHint}</p>
    </form>
  );
}

/** Mit Code beitreten (auch eingefügte Links werden erkannt). */
function JoinByCode() {
  const t = useT();
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
        {t.online.joinByCode}
      </h2>
      <label className="sr-only" htmlFor={id}>
        {t.online.leagueCode}
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
          {t.online.join}
        </button>
      </div>
      <p id={`${id}-hint`} className="muted small">
        {t.online.codeHint(DRAFT_LIMITS.codeLength)}
      </p>
    </form>
  );
}

/** Ligen, in denen dieses Gerät mitspielt – zum Zurückkehren ohne Link (nur lokal gespeichert). */
function RecentLeagues() {
  const t = useT();
  const [leagues] = useState(() => loadRecentLeagues());
  if (!leagues.length) return null;
  return (
    <section className="card draft-lobbies" aria-labelledby="draft-recent-title">
      <h2 id="draft-recent-title" className="section-title">
        {t.online.recentTitle}
      </h2>
      <ul className="draft-lobbies__list">
        {leagues.map((l) => (
          <li key={l.code} className="draft-lobbies__item">
            <div className="draft-lobbies__info">
              <strong className="draft-lobbies__name">{l.name || t.online.leagueFallback(l.code)}</strong>
              <span className="draft-lobbies__facts">
                <span>{l.team}</span>
                <span>{phaseLabel(l.phase, t)}</span>
                <span>{ago(l.at, t)}</span>
              </span>
            </div>
            <Link className={`btn btn--small ${l.phase === 'done' ? '' : 'btn--primary'}`} to={`/draft/${l.code}`}>
              {l.phase === 'done' ? t.online.result : t.online.resume}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Phase einer gemerkten Liga (lokal gespeichert – Unbekanntes bleibt leer). */
function phaseLabel(phase: RecentLeague['phase'], t: Messages): string {
  return Object.hasOwn(t.online.phase, phase) ? t.online.phase[phase] : '';
}

/** Pool einer Lobby-Zeile: alle Generationen, genau eine oder mehrere (LOBBY_REGION_MANY). */
function lobbyPoolLabel(region: PublicLobby['region'], t: Messages): string {
  if (region === 0) return t.game.allRegions;
  if (region === LOBBY_REGION_MANY) return t.online.manyGens;
  return t.game.region[region] ?? '?';
}

function timerLabel(seconds: number, t: Messages): string {
  return seconds ? t.online.timerSeconds(seconds) : t.online.noTimer;
}

function ago(ms: number, t: Messages): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (min < 1) return t.online.justNow;
  if (min < 60) return t.online.minutesAgo(min);
  return t.online.hoursAgo(Math.round(min / 60));
}

/** Liste der öffentlichen Lobbys mit Aktualisieren. */
function PublicLobbies() {
  const t = useT();
  const [lobbies, setLobbies] = useState<PublicLobby[] | null>(null);
  const [loading, setLoading] = useState(false);
  /** Fehler der letzten Abfrage – Text erst beim Rendern (folgt der Sprache) */
  const [failure, setFailure] = useState<{ err: unknown } | null>(null);
  const error = failure ? errorText(failure.err, t) : null;

  const refresh = useCallback(() => {
    setLoading(true);
    fetchPublicLobbies()
      .then((res) => {
        setLobbies([...(res.lobbies ?? [])].sort((a, b) => b.createdAt - a.createdAt));
        setFailure(null);
      })
      .catch((err: unknown) => setFailure({ err }))
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
          {t.online.publicTitle}
        </h2>
        <button type="button" className="btn btn--small btn--ghost" onClick={refresh} disabled={loading} aria-busy={loading}>
          {loading ? t.online.loading : t.online.refresh}
        </button>
      </div>
      {error && <p className="notice notice--error">{error}</p>}
      {lobbies && !lobbies.length && !error && (
        <p className="muted small">{t.online.noPublic}</p>
      )}
      {lobbies && lobbies.length > 0 && (
        <ul className="draft-lobbies__list">
          {lobbies.map((l) => {
            const full = l.teams >= l.maxTeams;
            return (
              <li key={l.code} className="draft-lobbies__item">
                <div className="draft-lobbies__info">
                  <strong className="draft-lobbies__name">{l.name || t.online.leagueFallback(l.code)}</strong>
                  <span className="muted small">{t.online.byHost(l.hostName, ago(l.createdAt, t))}</span>
                  <span className="draft-lobbies__facts">
                    <span>{t.online.teamsOf(l.teams, l.maxTeams)}</span>
                    <span>
                      {lobbyPoolLabel(l.region, t)}
                      {l.legends ? t.online.plusLegends : ''}
                    </span>
                    <span>{timerLabel(l.pickSeconds, t)}</span>
                  </span>
                </div>
                <Link className={`btn btn--small ${full ? '' : 'btn--primary'}`} to={`/draft/${l.code}`}>
                  {full ? t.online.watch : t.online.join}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {!lobbies && !error && <p className="muted small">{t.online.loading}</p>}
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
  const t = useT();
  return (
    <div className="page draft draft-online">
      {modeSwitch}
      <header className="page-head">
        <h1 className="page-title">{t.online.title}</h1>
        <p className="page-lead">{t.online.lead}</p>
      </header>
      {supported == null && (
        <p className="runnet runnet--checking" role="status">
          <span className="runnet__dot" aria-hidden="true" />
          {t.online.checking}
        </p>
      )}
      {supported === false && (
        <div className="notice draft-offline" role="status">
          <p>
            <strong>{t.online.offlineTitle}</strong> {t.online.offlineText}
          </p>
          <div className="actionbar">
            <button type="button" className="btn btn--primary btn--small" onClick={onLocal}>
              {t.online.playLocal}
            </button>
            <button type="button" className="btn btn--small" onClick={onRetry}>
              {t.online.checkAgain}
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
              {t.online.retention(DRAFT_LIMITS.retentionDays)}{' '}
              <Link to="/datenschutz">{t.online.privacyLink}</Link>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
