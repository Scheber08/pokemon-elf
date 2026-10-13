import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { draftSeason } from '../lib/draftEngine';
import { leagueRatings, resolveLeague } from '../lib/leagueTimeline';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { teamLabel, type DraftRoom } from '../state/useDraftRoom';
import { DraftResults } from './DraftResults';
import { DraftSquads } from './DraftSquads';
import { LeagueTicker } from './LeagueTicker';
import '../styles/draft.css';

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
  const { sprite } = useSettings();
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
  const [ticker, setTicker] = useState(() => !!season && Date.now() + room.clockOffset < endsAt);

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

  return (
    <div className="draft-season">
      {ticker ? (
        <LeagueTicker
          league={league}
          teamNames={teamNames}
          highlight={highlight}
          startsAt={season.startsAt}
          stepMs={season.stepMs}
          clockOffset={room.clockOffset}
          onDone={() => setTicker(false)}
          preKickoff={
            <DraftSquads
              teams={s.teams}
              ratings={ratings}
              names={teamNames}
              highlight={highlight}
              sprite={sprite}
              setPiece={s.settings.setPiece}
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
        />
      )}
      <div className="actionbar">
        <Link className="btn" to="/draft">
          {t.draft.season.newLeague}
        </Link>
      </div>
    </div>
  );
}
