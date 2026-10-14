import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useT } from '../i18n';
import { ApiRequestError } from '../lib/api/client';
import { requestRematch } from '../lib/api/draftClient';
import { draftSeason, groupEntries } from '../lib/draftEngine';
import { cupStatus } from '../lib/cup';
import { leagueRatings, resolveLeague } from '../lib/leagueTimeline';
import { showNotify } from '../lib/notify';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { useToast } from '../state/Toast';
import { draftErrorText, teamLabel, type DraftRoom } from '../state/useDraftRoom';
import { requestAchievementCheck } from './AchievementWatcher';
import { cupStatusText } from './CupBracket';
import { DraftResults } from './DraftResults';
import { DraftSquads } from './DraftSquads';
import { JerseyEditor } from './JerseyEditor';
import { EternalTable } from './EternalTable';
import { LeagueTicker } from './LeagueTicker';
import { KitPicker } from './KitPicker';
import '../styles/draft.css';
import { cleanKit } from '../lib/kits';
import { CrestEditor } from './CrestEditor';
import { cleanCrest } from '../lib/crest';
import { rosterOf } from '../lib/draftEngine';
import { ManagerCupView, useServerNow } from './ManagerSeason';
import { CaptainPicker } from './CaptainPicker';
import { captainWindowOpen, nextCareer } from '../lib/draftEngine';

/**
 * Nach dem letzten Pick: Das Ergebnis der Saison kommt vom Server (im Schnappschuss
 * gespeichert, damit es sich nach einem Deploy nicht ändert). Nur ältere Ligen ohne
 * gespeichertes Ergebnis simulieren es wie bisher aus dem Saison-Seed nach. Läuft die
 * gemeinsame Saison noch (Serverzeit vor startsAt + Spieltage × stepMs), gibt es den
 * synchronen Ticker, danach das Ergebnis.
 */
export function DraftSeasonStage({ room }: { room: DraftRoom }) {
  const t = useT();
  const { byId, scale } = usePokemonData();
  const { sprite, notify } = useSettings();
  const s = room.state!;
  const season = s.season;

  // Gespeichertes Ergebnis (league, ratings) – ältere Schnappschüsse haben es nicht; wird geprüft
  const storedRaw: unknown = s.league;
  const ratingsRaw: unknown = s.ratings;
  // Nur neu auswerten, wenn sich etwas Saison-Relevantes ändert (nicht bei Online-Status u. ä.)
  const key = JSON.stringify([
    season?.seed,
    s.teams.map((tm) => [tm.name, tm.formation, tm.slots, tm.ss]),
    storedRaw ?? null,
    ratingsRaw ?? null,
  ]);
  const league = useMemo(
    () => resolveLeague(storedRaw, s.teams.length, () => draftSeason(s, byId, scale('all'))),
    [key, byId, scale],
  );
  const ratings = useMemo(() => (league ? leagueRatings(league, ratingsRaw) : []), [league, key]);
  // Vereinsnamen der CPU-Teams erst bei der Anzeige übersetzen – gespeichert bleibt der deutsche Name
  const teamNames = useMemo(() => s.teams.map((tm) => teamLabel(tm, t)), [key, t]);
  const matchdays = useMemo(() => league?.matches.reduce((max, m) => Math.max(max, m.round), 0) ?? 0, [league]);
  const endsAt = season ? season.startsAt + matchdays * season.stepMs : 0;
  // Einmal beim Öffnen entscheiden; danach beendet der Ticker selbst (onDone)
  // Manager-Saison: Die Spieltage liefen schon einzeln – gleich das Ergebnis
  const [ticker, setTicker] = useState(() => !!season && s.settings.format !== 'manager' && Date.now() + room.clockOffset < endsAt);
  // Ewige Tabelle: frühere Ligen der Gruppe plus diese
  const entries = useMemo(() => groupEntries(s), [s.history, s.league, s.code]);
  const navigate = useNavigate();
  const toast = useToast();
  const [rematching, setRematching] = useState(false);
  const rematch = async (career = false) => {
    setRematching(true);
    try {
      const { code } = await requestRematch(s.code, career);
      navigate(`/draft/${code}`);
    } catch (err) {
      setRematching(false);
      toast(err instanceof ApiRequestError ? draftErrorText(err.message, err.code) || t.draft.season.rematchFailed : t.draft.season.rematchFailed);
    }
  };

  // Liga fertig (Ticker vorbei, Manager-Saison, späterer Besuch): neue Erfolge des Mitglieds melden
  const member = !!room.me;
  useEffect(() => {
    if (!ticker && member && league) requestAchievementCheck();
  }, [ticker, member, !!league]);

  if (!league || !season) {
    return (
      <div className="boot" role="status">
        <div className="boot__ball" aria-hidden="true" />
        <p>{t.draft.season.preparing}</p>
      </div>
    );
  }

  const meIndex = room.me ? s.teams.findIndex((tm) => tm.id === room.me!.id) : -1;
  const highlight = meIndex >= 0 ? meIndex : null;
  // Nach dem letzten Pick: Kapitän bis zum Anpfiff noch wählbar (Server rechnet neu)
  const now = useServerNow(room.clockOffset);
  const captainOpen = room.live && captainWindowOpen(s, now);

  return (
    <div className="draft-season">
      {meIndex >= 0 && captainOpen && (
        <section className="card draft-captain-window" aria-live="polite">
          <p className="kicker">⏱ {t.captain.windowTitle(Math.max(0, Math.ceil((season!.startsAt - now) / 1000)))}</p>
          <CaptainPicker
            formation={s.teams[meIndex].formation}
            slots={s.teams[meIndex].slots}
            captain={s.teams[meIndex].captain ?? null}
            onChange={(c) => room.setCaptain(c)}
            hint={t.captain.windowNote}
          />
        </section>
      )}
      {ticker ? (
        <LeagueTicker
          league={league}
          teamNames={teamNames}
          highlight={highlight}
          startsAt={season.startsAt}
          stepMs={season.stepMs}
          clockOffset={room.clockOffset}
          lineups={s.teams.map((tm) => ({ formation: tm.formation, ids: tm.slots, jerseys: tm.jerseys, captain: tm.captain, kit: cleanKit(tm.kit), cheer: tm.cheer, crest: cleanCrest(tm.crest) }))}
          onDone={() => {
            setTicker(false);
            // Tab im Hintergrund: Saisonende melden (wie „Du bist dran" – nur mit Erlaubnis)
            if (notify && highlight != null) {
              const place = league.table.findIndex((r) => r.team === highlight) + 1;
              const body = league.cup
                ? t.online.seasonDoneCup(cupStatusText(t, cupStatus(league.cup, highlight)))
                : t.online.seasonDoneLeague(place);
              showNotify(t.online.seasonDoneHeading(s.settings.name || t.online.leagueFallback(s.code)), body, `draft-season-${s.code}`);
            }
          }}
          preKickoff={
            <DraftSquads
              teams={s.teams}
              ratings={ratings}
              names={teamNames}
              highlight={highlight}
              sprite={sprite}
              setPiece={s.settings.setPiece}
              shinies={s.shinies}
            />
          }
        />
      ) : (
        <DraftResults
          league={league}
          teams={s.teams}
          ratings={ratings}
          highlight={highlight}
          sprite={sprite}
          code={s.code}
          leagueName={s.settings.name}
          picks={s.picks}
          transfers={s.manager?.transfers}
          shinies={s.shinies}
        />
      )}
      {s.manager?.cup && league && (
        <ManagerCupView
          cup={s.manager.cup}
          you={meIndex >= 0 ? meIndex : null}
          nameOf={(i) => (s.teams[i] ? teamLabel(s.teams[i], t) : league.teams[i]?.name ? t.game.club(league.teams[i].name) : `Team ${i + 1}`)}
        />
      )}
      {meIndex >= 0 && (
        <>
          <KitPicker kit={cleanKit(s.teams[meIndex].kit)} onChange={(kit) => room.setKit(kit)} cheer={s.teams[meIndex].cheer ?? ''} onCheer={(c) => room.setCheer(c)} />
          <CrestEditor crest={cleanCrest(s.teams[meIndex].crest)} onChange={(c) => room.setCrest(c)} pokemon={rosterOf(s.teams[meIndex])} />
        </>
      )}
      {meIndex >= 0 && (
        <JerseyEditor
          formation={s.teams[meIndex].formation}
          slots={s.teams[meIndex].slots}
          ss={s.settings.setPiece ? s.teams[meIndex].ss : null}
          jerseys={s.teams[meIndex].jerseys ?? {}}
          onChange={(j) => room.setJerseys(j)}
        />
      )}
      {!ticker && entries.length > 1 && <EternalTable entries={entries} youTeamId={room.me?.id ?? null} />}
      <div className="actionbar">
        {s.rematch ? (
          <Link className="btn btn--primary" to={`/draft/${s.rematch}`}>
            {t.draft.season.toRematch}
          </Link>
        ) : (
          room.me &&
          room.live && (
            <>
              {s.settings.format === 'manager' && league && (() => {
                // Vorschau: in welcher Liga die nächste Karriere-Saison spielt
                try {
                  const next = nextCareer({ settings: s.settings, league, teams: s.teams, career: s.career });
                  return (
                    <p className="draft-career__preview">
                      {t.online.careerNext(t.online.careerTier[next.tier])}
                      {next.move === 'up' && <strong> ⬆ {t.online.careerUp}</strong>}
                      {next.move === 'down' && <strong> ⬇ {t.online.careerDown}</strong>}
                    </p>
                  );
                } catch {
                  return null;
                }
              })()}
              {s.settings.format === 'manager' && (
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={rematching}
                  title={t.draft.season.careerTitle}
                  onClick={() => void rematch(true)}
                >
                  {rematching ? t.draft.season.rematchBusy : t.draft.season.career}
                </button>
              )}
              <button
                type="button"
                className={`btn ${s.settings.format === 'manager' ? '' : 'btn--primary'}`}
                disabled={rematching}
                title={t.draft.season.rematchTitle}
                onClick={() => void rematch()}
              >
                {rematching ? t.draft.season.rematchBusy : t.draft.season.rematch}
              </button>
            </>
          )
        )}
        <Link className="btn" to="/draft">
          {t.draft.season.newLeague}
        </Link>
      </div>
    </div>
  );
}
