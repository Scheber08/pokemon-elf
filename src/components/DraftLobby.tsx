import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n';
import { draftLink } from '../lib/api/draftClient';
import { DRAFT_LIMITS, type DraftSettings } from '../lib/api/draftContract';
import { CUP_SIZE } from '../lib/cup';
import { copyText } from '../lib/exportImage';
import { qrPath, type QrPath } from '../lib/qr';
import { usePokemonData } from '../state/PokemonData';
import { useToast } from '../state/Toast';
import {
  cleanTeamName,
  forgetLeague,
  loadTeamPrefs,
  saveTeamPrefs,
  startBlocker,
  teamLabel,
  type DraftRoom,
  type TeamPrefs,
} from '../state/useDraftRoom';
import { DraftTeamTags } from './DraftBoard';
import { DraftPresets } from './DraftPresets';
import { DraftSettingsForm, DraftSettingsSummary, DraftTeamFields } from './DraftSettingsForm';
import { EternalTable } from './EternalTable';
import { TrainerAvatar } from './TrainerAvatar';
import { KitPicker } from './KitPicker';
import { parseLook } from '../lib/trainer';
import '../styles/draft.css';
import { cleanKit } from '../lib/kits';
import { CrestEditor } from './CrestEditor';
import { cleanCrest } from '../lib/crest';
import { rosterOf } from '../lib/draftEngine';
import { Crest } from './Crest';

/** QR-Code des Liga-Links – zum Scannen, wenn alle im selben Raum sitzen. */
function DraftQr({ link }: { link: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<QrPath | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || qr) return;
    let alive = true;
    qrPath(link).then(
      (q) => alive && setQr(q),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [open, link, qr]);
  // Ruhezone: 4 Module rundum (QR-Standard)
  const q = 4;
  return (
    <>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? t.online.qrHide : t.online.qrShow}
      </button>
      {open && (
        <div className="draft-code__qr">
          {qr ? (
            <svg viewBox={`${-q} ${-q} ${qr.size + 2 * q} ${qr.size + 2 * q}`} role="img" aria-label={t.online.qrAria} shapeRendering="crispEdges">
              <rect x={-q} y={-q} width={qr.size + 2 * q} height={qr.size + 2 * q} fill="#fff" />
              <path d={qr.d} fill="#000" />
            </svg>
          ) : (
            <p className="muted small" role="status">
              {failed ? t.online.qrFailed : t.online.qrLoading}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** Liga-Code groß + Link kopieren / Teilen. */
function DraftCodeCard({ code }: { code: string }) {
  const t = useT();
  const toast = useToast();
  const link = draftLink(code);
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  const canShare = typeof nav.share === 'function';
  return (
    <section className="card draft-code" aria-labelledby="draft-code-title">
      <span id="draft-code-title" className="kicker">
        {t.online.leagueCode}
      </span>
      <p className="draft-code__value" aria-label={t.online.codeAria(code.split('').join(' '))}>
        {code}
      </p>
      <div className="draft-code__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={async () => toast((await copyText(link)) ? t.online.linkCopied : t.online.copyFailed)}
        >
          {t.online.copyLink}
        </button>
        {canShare && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              nav
                .share?.({ title: t.online.shareTitle, text: t.online.shareText(code), url: link })
                .catch(() => {
                  /* abgebrochen */
                })
            }
          >
            {t.online.share}
          </button>
        )}
        <DraftQr link={link} />
      </div>
      <p className="muted small draft-code__link">{link}</p>
      <p className="muted small">{t.online.codeCardHint}</p>
    </section>
  );
}

/** Beitreten (Teamname + Formation). */
function JoinCard({ room }: { room: DraftRoom }) {
  const t = useT();
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
          {t.online.playAlong}
        </h2>
        <p className="notice">{t.online.leagueFull(s.teams.length, s.settings.maxTeams)}</p>
      </section>
    );
  }
  return (
    <form className="card" aria-labelledby="draft-join-title" onSubmit={submit}>
      <h2 id="draft-join-title" className="section-title">
        {t.online.playAlong}
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
        {room.busy.join ? t.online.joining : t.online.join}
      </button>
    </form>
  );
}

/** Eigenes Team bearbeiten + Liga verlassen. */
function MyTeamCard({ room }: { room: DraftRoom }) {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const me = room.me!;
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  // Server hat den neuen Namen übernommen → Eingabe wieder an den Server-Wert binden
  useEffect(() => {
    if (nameDraft != null && cleanTeamName(nameDraft) === me.name) setNameDraft(null);
  }, [me.name]);

  const commit = (value: string | null = nameDraft) => {
    if (value == null) return;
    const clean = cleanTeamName(value);
    if (!clean || clean === me.name) {
      setNameDraft(null);
      return;
    }
    if (room.updateTeam({ name: clean })) saveTeamPrefs({ name: clean, formation: me.formation });
    else setNameDraft(null);
  };

  const leave = () => {
    const msg = room.isHost ? t.online.leaveConfirmHost : t.online.leaveConfirm;
    if (!window.confirm(msg)) return;
    if (room.leave()) {
      forgetLeague(room.state!.code);
      toast(t.online.left);
      navigate('/draft');
    }
  };

  return (
    <section className="card" aria-labelledby="draft-me-title">
      <h2 id="draft-me-title" className="section-title">
        {t.online.yourTeam}
      </h2>
      <DraftTeamFields
        name={nameDraft ?? me.name}
        formation={me.formation}
        onName={setNameDraft}
        onCommit={(value) => commit(value ?? nameDraft)}
        onFormation={(formation) => {
          if (formation !== me.formation && room.updateTeam({ formation })) saveTeamPrefs({ name: me.name, formation });
        }}
      />
      <KitPicker kit={cleanKit(me.kit)} onChange={(kit) => room.setKit(kit)} cheer={me.cheer ?? ''} onCheer={(c) => room.setCheer(c)} />
      <CrestEditor crest={cleanCrest(me.crest)} onChange={(c) => room.setCrest(c)} pokemon={rosterOf(me)} />
      <button type="button" className="btn btn--ghost btn--small" onClick={leave}>
        {t.online.leave}
      </button>
    </section>
  );
}

/** Lobby: Code teilen, Teams, eigenes Team, Einstellungen (Host live), Start. readOnly: öffentliche Vorschau ohne Live-Verbindung. */
export function DraftLobby({ room, readOnly = false }: { room: DraftRoom; readOnly?: boolean }) {
  const { all: list } = usePokemonData();
  const t = useT();
  const s = room.state!;
  const { me } = room;
  // Host-Werkzeuge nur mit Live-Verbindung (die Vorschau kennt die eigene Rolle nicht)
  const isHost = room.isHost && !readOnly;
  const blocker = startBlocker(s, list, t);
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
    const ids = s.teams.map((x) => x.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    room.setOrder(ids);
  };

  return (
    <div className="draft-lobby">
      <div className="draft-lobby__main">
        <DraftCodeCard code={s.code} />
        {s.career && (
          <section className="card draft-career" aria-label={t.online.careerTitle}>
            <p className="kicker">{t.online.careerTitle}</p>
            <p className="draft-career__tier">
              <strong>{t.online.careerSeason(s.career.season, t.online.careerTier[s.career.tier])}</strong>
              {s.career.move === 'up' && <span className="draft-career__move is-up"> ⬆ {t.online.careerUp}</span>}
              {s.career.move === 'down' && <span className="draft-career__move is-down"> ⬇ {t.online.careerDown}</span>}
            </p>
            <p className="muted small">{t.online.careerNote}</p>
          </section>
        )}
        <section className="card" aria-labelledby="draft-teams-title">
          <h2 id="draft-teams-title" className="section-title">
            {t.online.teams}{' '}
            <span className="muted">
              ({s.teams.length}/{s.settings.maxTeams})
            </span>
          </h2>
          <ol className="draft-lobby__teams">
            {s.teams.map((team, i) => {
              // Vereinsnamen der CPU-Teams erst bei der Anzeige übersetzen
              const name = teamLabel(team, t);
              return (
                <li key={team.id} className={`draft-lobby__team ${team.id === s.you ? 'is-mine' : ''}`}>
                  <span className="draft__no">{i + 1}</span>
                  <span className="draft-lobby__who">
                    {team.trainer && <TrainerAvatar look={parseLook(team.trainer)} size={36} companion={false} />}
                    {cleanCrest(team.crest) && <Crest crest={cleanCrest(team.crest)!} size={24} />}
                    <span className="draft-lobby__name">
                      <strong>{name}</strong>
                      <small>{team.formation}</small>
                    </span>
                  </span>
                  <DraftTeamTags team={team} host={team.id === s.hostTeamId} you={team.id === s.you} />
                  {isHost && (
                    <span className="draft-lobby__tools">
                      {s.settings.order === 'host' && (
                        <>
                          <button
                            type="button"
                            className="draft-icon-btn"
                            aria-label={t.online.moveUp(name)}
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="draft-icon-btn"
                            aria-label={t.online.moveDown(name)}
                            disabled={i === s.teams.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            ↓
                          </button>
                        </>
                      )}
                      {team.id !== s.hostTeamId && (
                        <button
                          type="button"
                          className="draft-icon-btn draft-icon-btn--danger"
                          aria-label={t.online.removeAria(name)}
                          title={t.online.removeTitle}
                          onClick={() => (team.cpu || window.confirm(t.online.removeConfirm(name))) && room.removeTeam(team.id)}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="muted small">
            {s.settings.order === 'random'
              ? t.online.orderRandom
              : s.settings.snake === false
                ? t.online.orderHostFixed
                : t.online.orderHost}
          </p>
          <p className="muted small">{t.online.fillNote(s.settings.format === 'cup' ? CUP_SIZE : DRAFT_LIMITS.leagueSize)}</p>
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
              {t.online.addCpu}
            </button>
          )}
          {isHost && s.settings.maxTeams - s.teams.length >= 2 && (
            <button
              type="button"
              className="btn btn--small"
              aria-disabled={room.busy['add-cpu'] || undefined}
              aria-busy={room.busy['add-cpu']}
              onClick={() => !room.busy['add-cpu'] && room.fillCpu()}
            >
              {t.online.fillCpu(s.settings.maxTeams - s.teams.length)}
            </button>
          )}
        </section>
        {me ? (
          <MyTeamCard room={room} />
        ) : readOnly ? (
          <section className="card" aria-labelledby="draft-join-title">
            <h2 id="draft-join-title" className="section-title">
              {t.online.playAlong}
            </h2>
            <p className="notice draft-readonly">{t.online.readOnlyLobby}</p>
          </section>
        ) : (
          <JoinCard room={room} />
        )}
      </div>

      <div className="draft-lobby__side">
        <section className="card" aria-labelledby="draft-settings-title">
          <h2 id="draft-settings-title" className="section-title">
            {t.online.settings}
          </h2>
          {isHost ? (
            <>
              <DraftPresets value={settingsValue} list={list} teamsJoined={s.teams.length} onApply={onSettings} disabled={room.busy.settings} />
              <DraftSettingsForm
                value={settingsValue}
                onChange={onSettings}
                list={list}
                teamsJoined={s.teams.length}
                busy={room.busy.settings}
              />
            </>
          ) : (
            <>
              <DraftSettingsSummary settings={s.settings} />
              <p className="hint hint--active draft-wait" role="status">
                {readOnly ? (
                  t.online.readOnlySettings
                ) : (
                  <>
                    <span className="boot__ball boot__ball--small" aria-hidden="true" />
                    {t.online.waitingHost}
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
              {room.busy.start ? t.online.starting : s.career ? t.online.careerStart : t.online.start}
            </button>
            {blocker ? (
              <p className="hint">{blocker}</p>
            ) : (
              <p className="hint">
                {t.online.startInfo(s.teams.length, s.settings.setPiece ? 12 : 11, s.settings.snake !== false)}{' '}
                {s.settings.pickSeconds ? t.online.startTimer(s.settings.pickSeconds) : t.online.startNoTimer}
              </p>
            )}
            {!blocker && (
              <p className="hint">
                {(() => {
                  const rounds = s.settings.setPiece ? 12 : 11;
                  const humans = s.teams.filter((tm) => !tm.cpu).length;
                  const cpus = s.teams.length - humans;
                  // Längstens: jeder menschliche Pick bis zum Timer, CPU-Picks mit ihrer kurzen Pause
                  const draftMs = rounds * (humans * s.settings.pickSeconds * 1000 + cpus * DRAFT_LIMITS.cpuPickMs);
                  const days = s.settings.format === 'cup' ? (s.settings.cupGroups ? 9 : 4) : 2 * (DRAFT_LIMITS.leagueSize - 1);
                  const seasonMs = DRAFT_LIMITS.seasonLeadMs + days * DRAFT_LIMITS.seasonStepMs;
                  const min = (ms: number) => Math.max(1, Math.round(ms / 60_000));
                  return s.settings.pickSeconds ? t.online.duration(min(draftMs), min(seasonMs)) : t.online.durationNoTimer(min(seasonMs));
                })()}
              </p>
            )}
          </section>
        )}
        {!!s.history?.length && <EternalTable entries={s.history} youTeamId={me?.id ?? null} title={t.draft.eternal.soFar} />}
      </div>
    </div>
  );
}
