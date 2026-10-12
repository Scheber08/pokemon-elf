import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Segmented } from '../components/Segmented';
import { CHALLENGE_LABEL, leaderboard, type LeaderboardEntry, type Period } from '../lib/leaderboard';
import { playerName } from '../lib/runFinish';
import { formatRecord } from '../lib/season';
import { save, STORAGE_KEYS } from '../lib/storage';
import { useToast } from '../state/Toast';
import type { ChallengeKey } from '../types';

const CHALLENGES: ChallengeKey[] = ['c340', 'retro340', 'c151'];
const PLAY_LINK: Record<ChallengeKey, string> = { c340: '/challenge', retro340: '/151', c151: '/151' };

export function Leaderboard() {
  const toast = useToast();
  const [challenge, setChallenge] = useState<ChallengeKey>('c340');
  const [period, setPeriod] = useState<Period>('all');
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(playerName);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    leaderboard
      .top(challenge, period)
      .then((r) => !cancelled && setRows(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [challenge, period]);

  const me = name.trim().toLowerCase();

  return (
    <div className="page leaderboard">
      <header className="page-head">
        <h1 className="page-title">Rangliste</h1>
        <p className="page-lead">
          Jeder abgeschlossene Run wird eingetragen – angezeigt wird dein bester. Sortiert nach Punkten, dann
          Team-Score.
        </p>
      </header>

      {leaderboard.kind === 'local' ? (
        <p className="notice">
          Lokale Rangliste – sie lebt nur in diesem Browser. Eine Online-Rangliste mit „Anmelden, um auf der Rangliste
          zu spielen" ist vorbereitet (siehe README).
        </p>
      ) : (
        !leaderboard.isLoggedIn() && <p className="notice">Anmelden, um auf der Rangliste zu spielen.</p>
      )}

      <div className="leaderboard__controls">
        <div className="tabs-inline" role="tablist" aria-label="Challenge">
          {CHALLENGES.map((c) => (
            <button
              key={c}
              role="tab"
              type="button"
              aria-selected={challenge === c}
              className={`tab-inline ${challenge === c ? 'is-active' : ''}`}
              onClick={() => setChallenge(c)}
            >
              {CHALLENGE_LABEL[c]}
            </button>
          ))}
        </div>
        <Segmented
          label="Zeitraum"
          hideLabel
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'today', label: 'Heute' },
            { value: 'all', label: 'Allzeit' },
          ]}
        />
      </div>

      <section className="card" role="tabpanel" aria-label={CHALLENGE_LABEL[challenge]}>
        {error && <p className="notice notice--error">Rangliste nicht erreichbar: {error}</p>}
        {!rows && !error && <p className="muted">Lade …</p>}
        {rows && rows.length === 0 && (
          <div className="empty">
            <p>Noch keine Einträge{period === 'today' ? ' heute' : ''}.</p>
            <Link className="btn btn--primary" to={PLAY_LINK[challenge]}>
              Jetzt spielen
            </Link>
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="table-scroll">
            <table className="league-table leaderboard__table">
              <thead>
                <tr>
                  <th scope="col">Platz</th>
                  <th scope="col" className="left">
                    Spieler
                  </th>
                  <th scope="col">Bilanz</th>
                  <th scope="col">Pkt</th>
                  <th scope="col">Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={r.player.trim().toLowerCase() === me ? 'is-user' : ''}>
                    <td>{i + 1}</td>
                    <td className="left">
                      <strong>{r.player}</strong>
                      {r.teamName && <span className="rating">{r.teamName}</span>}
                    </td>
                    <td className="mono">{formatRecord(r.record)}</td>
                    <td>{r.points}</td>
                    <td>
                      <strong>{r.score}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form
        className="card namefield"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = name.trim().slice(0, 24) || 'Trainer';
          save(STORAGE_KEYS.playerName, clean);
          setName(clean);
          toast('Spielername gespeichert');
        }}
      >
        <label className="field__label" htmlFor="lb-name">
          Spielername für neue Einträge
        </label>
        <div className="namefield__row">
          <input id="lb-name" className="input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn">
            Speichern
          </button>
        </div>
      </form>
    </div>
  );
}
