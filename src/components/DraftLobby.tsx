import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { draftLink } from '../lib/api/draftClient';
import type { DraftSettings } from '../lib/api/draftContract';
import { copyText } from '../lib/exportImage';
import { usePokemonData } from '../state/PokemonData';
import { useToast } from '../state/Toast';
import {
  cleanTeamName,
  forgetLeague,
  loadTeamPrefs,
  saveTeamPrefs,
  startBlocker,
  type DraftRoom,
  type TeamPrefs,
} from '../state/useDraftRoom';
import { DraftTeamTags } from './DraftBoard';
import { DraftSettingsForm, DraftSettingsSummary, DraftTeamFields } from './DraftSettingsForm';
import '../styles/draft.css';

/** Liga-Code groß + Link kopieren / Teilen. */
function DraftCodeCard({ code }: { code: string }) {
  const toast = useToast();
  const link = draftLink(code);
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  const canShare = typeof nav.share === 'function';
  return (
    <section className="card draft-code" aria-labelledby="draft-code-title">
      <span id="draft-code-title" className="kicker">
        Liga-Code
      </span>
      <p className="draft-code__value" aria-label={`Liga-Code ${code.split('').join(' ')}`}>
        {code}
      </p>
      <div className="draft-code__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={async () => toast((await copyText(link)) ? 'Link kopiert' : 'Kopieren hat nicht geklappt')}
        >
          Link kopieren
        </button>
        {canShare && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              nav
                .share?.({ title: 'Pokémon Elf – Fantasy-Draft', text: `Komm in meine Draft-Liga! Code: ${code}`, url: link })
                .catch(() => {
                  /* abgebrochen */
                })
            }
          >
            Teilen
          </button>
        )}
      </div>
      <p className="muted small draft-code__link">{link}</p>
      <p className="muted small">Freunde öffnen den Link oder geben den Code unter „Mit Code beitreten" ein.</p>
    </section>
  );
}

/** Beitreten (Teamname + Formation). */
function JoinCard({ room }: { room: DraftRoom }) {
  const [prefs, setPrefs] = useState<TeamPrefs>(loadTeamPrefs);
  const s = room.state!;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (room.join(prefs.name, prefs.formation)) saveTeamPrefs(prefs);
  };
  if (room.full) {
    return (
      <section className="card" aria-labelledby="draft-join-title">
        <h2 id="draft-join-title" className="section-title">
          Mitspielen
        </h2>
        <p className="notice">
          Die Liga ist voll ({s.teams.length}/{s.settings.maxTeams}). Du kannst zuschauen – vielleicht wird noch ein Platz frei.
        </p>
      </section>
    );
  }
  return (
    <form className="card" aria-labelledby="draft-join-title" onSubmit={submit}>
      <h2 id="draft-join-title" className="section-title">
        Mitspielen
      </h2>
      <DraftTeamFields
        name={prefs.name}
        formation={prefs.formation}
        onName={(name) => setPrefs((p) => ({ ...p, name }))}
        onFormation={(formation) => setPrefs((p) => ({ ...p, formation }))}
      />
      <button
        type="submit"
        className="btn btn--primary btn--big"
        disabled={!cleanTeamName(prefs.name) || room.status !== 'open' || room.busy.join}
        aria-busy={room.busy.join}
      >
        {room.busy.join ? 'Trete bei …' : 'Beitreten'}
      </button>
    </form>
  );
}

/** Eigenes Team bearbeiten + Liga verlassen. */
function MyTeamCard({ room }: { room: DraftRoom }) {
  const navigate = useNavigate();
  const toast = useToast();
  const me = room.me!;
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  // Server hat den neuen Namen übernommen → Eingabe wieder an den Server-Wert binden
  useEffect(() => {
    if (nameDraft != null && cleanTeamName(nameDraft) === me.name) setNameDraft(null);
  }, [me.name]);

  const commit = () => {
    if (nameDraft == null) return;
    const clean = cleanTeamName(nameDraft);
    if (!clean || clean === me.name) {
      setNameDraft(null);
      return;
    }
    if (room.updateTeam({ name: clean })) saveTeamPrefs({ name: clean, formation: me.formation });
    else setNameDraft(null);
  };

  const leave = () => {
    const msg = room.isHost
      ? 'Liga wirklich verlassen? Ein anderes Team wird Host.'
      : 'Liga wirklich verlassen? Dein Team wird entfernt.';
    if (!window.confirm(msg)) return;
    if (room.leave()) {
      forgetLeague(room.state!.code);
      toast('Liga verlassen');
      navigate('/draft');
    }
  };

  return (
    <section className="card" aria-labelledby="draft-me-title">
      <h2 id="draft-me-title" className="section-title">
        Dein Team
      </h2>
      <DraftTeamFields
        name={nameDraft ?? me.name}
        formation={me.formation}
        onName={setNameDraft}
        onCommit={commit}
        onFormation={(formation) => {
          if (formation !== me.formation && room.updateTeam({ formation })) saveTeamPrefs({ name: me.name, formation });
        }}
      />
      <button type="button" className="btn btn--ghost btn--small" onClick={leave}>
        Liga verlassen
      </button>
    </section>
  );
}

/** Lobby: Code teilen, Teams, eigenes Team, Einstellungen (Host live), Start. readOnly: öffentliche Vorschau ohne Live-Verbindung. */
export function DraftLobby({ room, readOnly = false }: { room: DraftRoom; readOnly?: boolean }) {
  const { list } = usePokemonData();
  const s = room.state!;
  const { me } = room;
  // Host-Werkzeuge nur mit Live-Verbindung (die Vorschau kennt die eigene Rolle nicht)
  const isHost = room.isHost && !readOnly;
  const blocker = startBlocker(s, list);
  /** Liganame tippt der Host lokal; gesendet wird kurz nach der letzten Taste */
  const [leagueName, setLeagueName] = useState<string | null>(null);

  useEffect(() => {
    if (leagueName == null || leagueName === s.settings.name) return;
    const id = window.setTimeout(() => room.updateSettings({ name: leagueName }), 600);
    return () => window.clearTimeout(id);
  }, [leagueName]);
  useEffect(() => {
    if (leagueName != null && leagueName === s.settings.name) setLeagueName(null);
  }, [s.settings.name]);

  const settingsValue: DraftSettings = { ...s.settings, name: leagueName ?? s.settings.name };
  const onSettings = (patch: Partial<DraftSettings>) => {
    const { name, ...rest } = patch;
    if (name !== undefined) setLeagueName(name);
    if (Object.keys(rest).length) room.updateSettings(rest);
  };

  const move = (index: number, dir: -1 | 1) => {
    const ids = s.teams.map((t) => t.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    room.setOrder(ids);
  };

  return (
    <div className="draft-lobby">
      <div className="draft-lobby__main">
        <DraftCodeCard code={s.code} />
        <section className="card" aria-labelledby="draft-teams-title">
          <h2 id="draft-teams-title" className="section-title">
            Teams{' '}
            <span className="muted">
              ({s.teams.length}/{s.settings.maxTeams})
            </span>
          </h2>
          <ol className="draft-lobby__teams">
            {s.teams.map((t, i) => (
              <li key={t.id} className={`draft-lobby__team ${t.id === s.you ? 'is-mine' : ''}`}>
                <span className="draft__no">{i + 1}</span>
                <span className="draft-lobby__name">
                  <strong>{t.name}</strong>
                  <small>{t.formation}</small>
                </span>
                <DraftTeamTags team={t} host={t.id === s.hostTeamId} you={t.id === s.you} />
                {isHost && (
                  <span className="draft-lobby__tools">
                    {s.settings.order === 'host' && (
                      <>
                        <button
                          type="button"
                          className="draft-icon-btn"
                          aria-label={`${t.name} nach oben`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="draft-icon-btn"
                          aria-label={`${t.name} nach unten`}
                          disabled={i === s.teams.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </button>
                      </>
                    )}
                    {t.id !== s.hostTeamId && (
                      <button
                        type="button"
                        className="draft-icon-btn draft-icon-btn--danger"
                        aria-label={`${t.name} entfernen`}
                        title="Team entfernen"
                        onClick={() => (t.cpu || window.confirm(`${t.name} aus der Liga entfernen?`)) && room.removeTeam(t.id)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p className="muted small">
            {s.settings.order === 'random'
              ? 'Die Draft-Reihenfolge wird beim Start ausgelost.'
              : 'Draft-Reihenfolge wie in der Liste (Runde 2 rückwärts – Snake-Draft).'}
          </p>
          {isHost && (
            <button
              type="button"
              className="btn btn--small"
              disabled={room.full}
              // Unterwegs nicht disabled, damit der Tastaturfokus bleibt – gesendet wird ohnehin nur einmal
              aria-disabled={room.busy['add-cpu'] || undefined}
              aria-busy={room.busy['add-cpu']}
              onClick={() => !room.busy['add-cpu'] && room.addCpu()}
            >
              CPU-Team hinzufügen
            </button>
          )}
        </section>
        {me ? (
          <MyTeamCard room={room} />
        ) : readOnly ? (
          <section className="card" aria-labelledby="draft-join-title">
            <h2 id="draft-join-title" className="section-title">
              Mitspielen
            </h2>
            <p className="notice draft-readonly">
              Nur Ansicht – die Live-Verbindung steht noch nicht. Beitreten (bzw. dein Team, falls du schon dabei bist)
              gibt es, sobald sie da ist.
            </p>
          </section>
        ) : (
          <JoinCard room={room} />
        )}
      </div>

      <div className="draft-lobby__side">
        <section className="card" aria-labelledby="draft-settings-title">
          <h2 id="draft-settings-title" className="section-title">
            Einstellungen
          </h2>
          {isHost ? (
            <DraftSettingsForm
              value={settingsValue}
              onChange={onSettings}
              list={list}
              teamsJoined={s.teams.length}
              busy={room.busy.settings}
            />
          ) : (
            <>
              <DraftSettingsSummary settings={s.settings} />
              <p className="hint hint--active draft-wait" role="status">
                {readOnly ? (
                  'Nur Ansicht – ohne Live-Verbindung.'
                ) : (
                  <>
                    <span className="boot__ball boot__ball--small" aria-hidden="true" /> Warte auf den Host …
                  </>
                )}
              </p>
            </>
          )}
        </section>
        {isHost && (
          <section className="card draft-start">
            <button
              type="button"
              className="btn btn--primary btn--big"
              disabled={!!blocker || room.status !== 'open' || room.busy.start}
              aria-busy={room.busy.start}
              onClick={room.start}
            >
              {room.busy.start ? 'Draft wird gestartet …' : 'Draft starten'}
            </button>
            {blocker ? (
              <p className="hint">{blocker}</p>
            ) : (
              <p className="hint">
                {s.teams.length} Teams · Snake-Draft über {s.settings.setPiece ? 12 : 11} Runden.{' '}
                {s.settings.pickSeconds
                  ? `Läuft der ${s.settings.pickSeconds}-s-Timer ab, wählt der Server automatisch.`
                  : 'Ohne Timer kannst du für abwesende Teams automatisch wählen lassen.'}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
