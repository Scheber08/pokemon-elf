import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n';
import { draftLink } from '../lib/api/draftClient';
import { DRAFT_GOALS, DRAFT_LIMITS, type DraftGoal, type DraftSettings, type DraftSnapshot } from '../lib/api/draftContract';
import { CUP_SIZE } from '../lib/cup';
import { copyText } from '../lib/exportImage';
import { qrPath, type QrPath } from '../lib/qr';
import { usePokemonData } from '../state/PokemonData';
import { useToast } from '../state/Toast';
import { useSettings } from '../state/Settings';
import { localeOf } from '../i18n/lang';
import { showNotify } from '../lib/notify';
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
import { pickNumbersLabel, poolOf, rosterOf, rounds as draftRounds } from '../lib/draftEngine';
import { Crest } from './Crest';
import { PoolStars } from './PoolStars';
import { FilterBar, useFilteredPokemon, type PokemonFilters } from './FilterBar';
import { PokemonGrid } from './PokemonGrid';
import { positionFit, type Scale } from '../lib/fit';
import { POSITIONS } from '../config/positions';
import type { Pokemon, PosCode } from '../types';

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

/** 🔍 Ganzen Pool vor dem Draft ansehen (Suche/Filter); Antippen nennt die beste Position. */
function LobbyPool({ pool, scale }: { pool: Pokemon[]; scale: Scale }) {
  const t = useT();
  const toast = useToast();
  const { sprite } = useSettings();
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<PokemonFilters>({ query: '', type: null, region: 0 });
  const filtered = useFilteredPokemon(pool, filters);
  const regions = new Set(pool.map((p) => p.gen)).size;
  return (
    <details className="card details lobby-pool" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>🔍 {t.online.poolBrowse(pool.length)}</summary>
      {open && (
        <>
          <FilterBar filters={filters} onChange={setFilters} showRegion={regions > 1} resultCount={filtered.length} />
          <PokemonGrid
            items={filtered}
            sprite={sprite}
            selectedId={null}
            onPick={(p) => {
              let best: { pos: PosCode; fit: number } | null = null;
              for (const pos of Object.keys(POSITIONS) as PosCode[]) {
                if (pos === 'SS') continue;
                const fit = positionFit(p, pos, scale);
                if (!best || fit > best.fit) best = { pos, fit };
              }
              if (best) toast(t.online.poolBrowseBest(t.game.pokemon(p), t.game.posName[best.pos], Math.round(best.fit)));
            }}
            className="pgrid-wrap--compact pgrid-wrap--scroll"
          />
        </>
      )}
    </details>
  );
}

/** Liga-Code groß + Link kopieren / Teilen. */
function DraftCodeCard({ code, name = '', settings, teams }: { code: string; name?: string; settings?: DraftSnapshot['settings']; teams?: number }) {
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
        {settings && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              // Einladung mit den wichtigsten Regeln – fertig für den Gruppenchat
              const regions = settings.gens.length >= 9 ? t.online.inviteAllRegions : settings.gens.map((g) => t.game.region[g] ?? g).join(', ');
              const rules = [regions, t.online.inviteTeams(teams ?? 0, settings.maxTeams), settings.pickSeconds > 0 ? t.online.invitePick(settings.pickSeconds) : t.online.inviteNoTimer];
              const text = t.online.inviteText(name, code, rules.join(' · '), link);
              toast((await copyText(text)) ? t.online.inviteCopied : t.online.copyFailed);
            }}
          >
            📋 {t.online.inviteCopy}
          </button>
        )}
        {canShare && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              nav
                .share?.({ title: t.online.shareTitle, text: t.online.shareText(code, name), url: link })
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

  // „Bereit“ vom Server zurückgesetzt (Host hat die Regeln geändert) – kurz Bescheid geben
  const selfUnready = useRef(false);
  const wasReady = useRef(!!me.ready);
  useEffect(() => {
    if (wasReady.current && !me.ready && !selfUnready.current) toast(t.online.readyReset);
    wasReady.current = !!me.ready;
    selfUnready.current = false;
  }, [me.ready]);

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
      {/* Der Host startet selbst – „bereit“ melden nur die Mitspieler */}
      {me.id !== room.state?.hostTeamId && (
        <button
          type="button"
          className={`btn btn--small ${me.ready ? 'btn--primary' : ''} draft-lobby__ready`}
          aria-pressed={!!me.ready}
          onClick={() => {
            if (me.ready) selfUnready.current = true;
            room.setReady(!me.ready);
          }}
        >
          {me.ready ? t.online.readyOn : t.online.readyOff}
        </button>
      )}
      <DraftTeamFields
        name={nameDraft ?? me.name}
        formation={me.formation}
        onName={setNameDraft}
        onCommit={(value) => commit(value ?? nameDraft)}
        onFormation={(formation) => {
          if (formation !== me.formation && room.updateTeam({ formation })) saveTeamPrefs({ name: me.name, formation });
        }}
      />
      {room.state?.settings.format !== 'cup' && (
        <label className="field draft-lobby__goal">
          <span className="field__label">{t.online.goalLabel}</span>
          <select
            className="input"
            value={me.goal ?? ''}
            onChange={(e) => room.setGoal(e.target.value ? (e.target.value as DraftGoal) : null)}
          >
            <option value="">{t.online.goalNone}</option>
            {DRAFT_GOALS.map((g) => (
              <option key={g} value={g}>
                {t.online.goal[g]}
              </option>
            ))}
          </select>
          <span className="muted small">{t.online.goalNote}</span>
        </label>
      )}
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
  const { all: list, scale } = usePokemonData();
  const t = useT();
  const s = room.state!;
  // Pool der aktuellen Einstellungen (für die „Stars im Pool“)
  const pool = useMemo(() => (list.length ? poolOf(s.settings, list) : []), [s.settings, list]);
  const { me } = room;
  // Host-Werkzeuge nur mit Live-Verbindung (die Vorschau kennt die eigene Rolle nicht)
  const isHost = room.isHost && !readOnly;
  // 🏆 Titelverteidiger: Meister der letzten Liga der Revanche-Kette (Name wie in der Teamliste)
  const lastLeague = s.history?.length ? s.history[s.history.length - 1] : null;
  const champRow = lastLeague?.rows.find((r) => r.rank === 1) ?? null;
  const defending = champRow?.teamId ?? null;
  const champTeam = defending ? s.teams.find((tm) => tm.id === defending) : undefined;
  const defendingName = champRow ? (champTeam ? teamLabel(champTeam, t) : champRow.cpu ? t.game.club(champRow.name) : champRow.name) : null;
  const blocker = startBlocker(s, list, t);
  /** Liganame tippt der Host lokal; gesendet wird kurz nach der letzten Taste */
  const [leagueName, setLeagueName] = useState<string | null>(null);
  // Alle Mitspieler bereit: den Host benachrichtigen (Tab im Hintergrund, nur mit Erlaubnis)
  const { notify } = useSettings();
  const others = s.teams.filter((tm) => !tm.cpu && tm.id !== s.hostTeamId);
  const allReady = others.length > 0 && others.every((tm) => tm.ready);
  useEffect(() => {
    if (!allReady || !isHost || !notify) return;
    showNotify(s.settings.name || t.online.leagueFallback(s.code), t.online.readyNotify(others.length), `draft-ready-${s.code}`);
  }, [allReady]);

  // Neuer Mitspieler in der Lobby: kurz begrüßen (nicht beim ersten Laden, nicht das eigene Team)
  const toast = useToast();
  // … und beim Gehen (verlassen oder vom Host entfernt) kurz verabschieden
  const humans = s.teams.filter((tm) => !tm.cpu).map((tm) => ({ id: tm.id, name: tm.name }));
  const seenHumans = useRef(humans);
  useEffect(() => {
    const before = seenHumans.current;
    const fresh = humans.filter((tm) => !before.some((x) => x.id === tm.id) && tm.id !== me?.id);
    const gone = before.filter((tm) => !humans.some((x) => x.id === tm.id) && tm.id !== me?.id);
    seenHumans.current = humans;
    for (const tm of fresh) toast(t.online.joinedLobby(tm.name));
    for (const tm of gone) toast(t.online.leftLobby(tm.name));
  }, [humans.map((tm) => tm.id).join('|')]);
  // Mitspieler meldet sich bereit: kurz anzeigen (nicht beim ersten Laden, nicht das eigene Team)
  const readyIds = s.teams.filter((tm) => !tm.cpu && tm.ready).map((tm) => tm.id);
  const seenReady = useRef(readyIds);
  useEffect(() => {
    const fresh = s.teams.filter((tm) => readyIds.includes(tm.id) && !seenReady.current.includes(tm.id) && tm.id !== me?.id);
    seenReady.current = readyIds;
    for (const tm of fresh) toast(t.online.readyLobby(tm.name));
  }, [readyIds.join('|')]);

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
  /** Reihenfolge zufällig mischen (nur UI-Zufall – die Reihenfolge selbst legt der Server fest) */
  const shuffleOrder = () => {
    const ids = s.teams.map((x) => x.id);
    const before = ids.join('|');
    for (let tries = 0; tries < 5 && ids.join('|') === before; tries++) {
      for (let k = ids.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [ids[k], ids[j]] = [ids[j], ids[k]];
      }
    }
    room.setOrder(ids);
  };

  return (
    <div className="draft-lobby">
      <div className="draft-lobby__main">
        <DraftCodeCard code={s.code} name={s.settings.name} settings={s.settings} teams={s.teams.length} />
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
          {defendingName && <p className="small draft-lobby__defending-line">{t.online.defending(defendingName)}</p>}
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
                      <strong>
                        {name}
                        {team.id === defending && (
                          <span className="draft-lobby__defending" title={t.online.defendingTitle}>
                            {' '}
                            <span aria-hidden="true">🏆</span>
                            <span className="sr-only">{t.online.defendingTitle}</span>
                          </span>
                        )}
                      </strong>
                      <small>
                        {team.formation}
                        {team.cpu && s.settings.cpuLevel && s.settings.cpuLevel !== 'normal' && (
                          <span className="draft-lobby__cpulevel" title={t.draft.local.cpuLevel}>
                            {' · '}
                            {t.draft.local.cpuLevels[s.settings.cpuLevel]}
                          </span>
                        )}
                        {team.goal && <span title={t.online.goalLabel}> · 🎯 {t.online.goal[team.goal]}</span>}
                        {team.ready && <span className="draft-lobby__ready-mark"> · ✓ {t.online.readyMark}</span>}
                      </small>
                    </span>
                  </span>
                  <DraftTeamTags team={team} host={team.id === s.hostTeamId} you={team.id === s.you} />
                  {isHost && (
                    // Nur ein Knopf (Entfernen, ohne Pfeile): passt auch auf dem Handy in die Zeile
                    <span className={`draft-lobby__tools ${s.settings.order !== 'host' ? 'draft-lobby__tools--single' : ''}`}>
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
          {s.teams.length >= 2 && (() => {
            // Formations-Mix der Lobby: häufigste zuerst, bei Gleichstand in Reihenfolge der Teams
            const count = new Map<string, number>();
            for (const tm of s.teams) count.set(tm.formation, (count.get(tm.formation) ?? 0) + 1);
            const list = [...count].sort((a, b) => b[1] - a[1]).map(([f, n]) => (n > 1 ? `${f} ×${n}` : f));
            const solo = me != null && count.get(me.formation) === 1;
            return (
              <p className="small draft-lobby__formations">
                {t.online.lobbyFormations(list.join(' · '))}
                {solo && <span className="muted">{t.online.lobbyFormationSolo}</span>}
              </p>
            );
          })()}
          <p className="muted small">
            {s.settings.order === 'random'
              ? t.online.orderRandom
              : s.settings.snake === false
                ? t.online.orderHostFixed
                : t.online.orderHost}
          </p>
          {s.settings.order === 'host' && me && s.teams.length >= 2 && (() => {
            // Feste Reihenfolge: die eigenen Pick-Nummern vorab (die ersten vier)
            const n = s.teams.length;
            const at = s.teams.findIndex((tm) => tm.id === me.id);
            if (at < 0) return null;
            return (
              <p className="small draft-lobby__mypicks">
                {t.online.myPicks(pickNumbersLabel(at, n, n * draftRounds(s.settings), s.settings.snake !== false))}
              </p>
            );
          })()}
          {isHost && s.settings.order === 'host' && s.teams.length >= 2 && (
            <button type="button" className="btn btn--small draft-lobby__shuffle" onClick={shuffleOrder}>
              {t.online.shuffleOrder}
            </button>
          )}
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
        {pool.length > 0 && <PoolStars pool={pool} scale={scale('all')} formations={s.teams.map((tm) => tm.formation)} />}
        {pool.length > 0 && <LobbyPool pool={pool} scale={scale('all')} />}
        {isHost && (
          <section className="card draft-start">
            <button
              type="button"
              className={`btn btn--primary btn--big ${allReady && !blocker ? 'draft-start--go' : ''}`}
              disabled={!!blocker || room.status !== 'open' || room.busy.start}
              aria-busy={room.busy.start}
              onClick={room.start}
            >
              {room.busy.start ? t.online.starting : s.career ? t.online.careerStart : t.online.start}
            </button>
            {(() => {
              // Mitspieler (ohne Host und CPU), die sich bereit gemeldet haben
              const others = s.teams.filter((tm) => !tm.cpu && tm.id !== s.hostTeamId);
              if (!others.length) return null;
              const ready = others.filter((tm) => tm.ready).length;
              return <p className={`hint ${ready === others.length ? 'draft-lobby__ready-mark' : ''}`}>{t.online.readyCount(ready, others.length)}</p>;
            })()}
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
                  // Runden inkl. Standardschütze und Bank (Manager-Saison)
                  const rounds = draftRounds(s.settings);
                  const humans = s.teams.filter((tm) => !tm.cpu).length;
                  const cpus = s.teams.length - humans;
                  // Längstens: jeder menschliche Pick bis zum Timer, CPU-Picks mit ihrer kurzen Pause
                  const draftMs = rounds * (humans * s.settings.pickSeconds * 1000 + cpus * DRAFT_LIMITS.cpuPickMs);
                  const days = s.settings.format === 'cup' ? (s.settings.cupGroups ? 9 : 4) : 2 * (DRAFT_LIMITS.leagueSize - 1);
                  const seasonMs = DRAFT_LIMITS.seasonLeadMs + days * DRAFT_LIMITS.seasonStepMs;
                  const min = (ms: number) => Math.max(1, Math.round(ms / 60_000));
                  return s.settings.pickSeconds ? t.online.duration(min(draftMs), min(seasonMs)) : t.online.durationNoTimer(min(seasonMs));
                })()}
                {list.length > 0 && ` ${t.online.poolLine(poolOf(s.settings, list).length, draftRounds(s.settings) * s.teams.length)}`}
              </p>
            )}
            {!blocker && s.settings.format !== 'manager' && (() => {
              // 🕒 Uhrzeit bei sofortigem Start (Draft-Ende spätestens, Saisonende) – nicht in der Manager-Saison (läuft über Tage)
              const rounds = draftRounds(s.settings);
              const humans = s.teams.filter((tm) => !tm.cpu).length;
              const draftMs = rounds * (humans * s.settings.pickSeconds * 1000 + (s.teams.length - humans) * DRAFT_LIMITS.cpuPickMs);
              const days = s.settings.format === 'cup' ? (s.settings.cupGroups ? 9 : 4) : 2 * (DRAFT_LIMITS.leagueSize - 1);
              const seasonMs = DRAFT_LIMITS.seasonLeadMs + days * DRAFT_LIMITS.seasonStepMs;
              const clock = (ms: number) => new Date(Date.now() + ms).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' });
              return (
                <p className="hint draft-lobby__endsat">
                  🕒 {s.settings.pickSeconds ? t.online.endsAt(clock(draftMs), clock(draftMs + seasonMs)) : t.online.endsAtNoTimer(clock(seasonMs))}
                </p>
              );
            })()}
          </section>
        )}
        {!!s.history?.length && <EternalTable entries={s.history} youTeamId={me?.id ?? null} title={t.draft.eternal.soFar} />}
      </div>
    </div>
  );
}
