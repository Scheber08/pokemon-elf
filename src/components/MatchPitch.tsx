import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { ballAt, buildReplay, PITCH_H, PITCH_W, playerAt, type ReplayLineup } from '../lib/matchReplay';
import { formatMinute, type Match } from '../lib/season';
import { SPRITE_BASE } from '../lib/sprites';

interface Props {
  match: Match;
  lineups: [ReplayLineup | null, ReplayLineup | null];
  nameOf: (team: number) => string;
  pokemonName: (id: number) => string;
}

/** Spielminuten pro Sekunde Wiedergabe (90 Minuten ≈ 45 s) */
const SPEED = 2;

/** 2D-Ansicht von oben: das Spiel als Animation – Formationen, Ballwege, Schüsse und die echten Tore. */
export function MatchPitch({ match, lineups, nameOf, pokemonName }: Props) {
  const t = useT();
  const tx = t.draft.replay;
  const replay = useMemo(() => buildReplay(match, lineups), [match, lineups]);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const last = useRef<number | null>(null);
  // Sprites, die nicht laden (z. B. offline) – dann bleibt der Punkt allein
  const [broken, setBroken] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const step = (now: number) => {
      const dt = last.current == null ? 0 : (now - last.current) / 1000;
      last.current = now;
      setTime((x) => {
        const next = Math.min(replay.end, x + dt * SPEED);
        if (next >= replay.end) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, replay.end]);

  const ball = ballAt(replay.keys, time);
  const goals = replay.events.filter((e) => e.kind === 'goal' && e.t <= time);
  const score = [goals.filter((e) => e.side === 0).length, goals.filter((e) => e.side === 1).length];
  const recent = replay.events.find((e) => e.t <= time && time - e.t < 2.2);
  // Szene läuft (kurz vor bis kurz nach dem Abschluss): der Schütze steht am Ball bzw. am Schusspunkt
  const scene = replay.events.find((e) => time >= e.t - 0.6 && time < e.t + 1.6);
  const shooter = scene ? scene.shooter : -1;
  const shooterPos = scene ? ballAt(replay.keys, Math.min(time, scene.t - 0.35)) : null;
  const minute = Math.max(1, Math.min(Math.ceil(time), 95));

  return (
    <div className="match-pitch">
      <div className="match-pitch__board" aria-live="polite">
        <span className="match-pitch__team">{nameOf(match.home)}</span>
        <strong className="match-pitch__score">
          {score[0]}:{score[1]}
        </strong>
        <span className="match-pitch__team match-pitch__team--away">{nameOf(match.away)}</span>
        <span className="match-pitch__clock">{formatMinute(minute)}</span>
      </div>
      <svg className="match-pitch__field" viewBox={`-3 -1 ${PITCH_W + 6} ${PITCH_H + 2}`} role="img" aria-label={tx.aria}>
        {Array.from({ length: 10 }, (_, i) => (
          <rect key={i} x={(i * PITCH_W) / 10} y={0} width={PITCH_W / 10} height={PITCH_H} fill={i % 2 ? '#2f8a3e' : '#2a7f39'} />
        ))}
        <g fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.35">
          <rect x="0" y="0" width={PITCH_W} height={PITCH_H} />
          <line x1={PITCH_W / 2} y1="0" x2={PITCH_W / 2} y2={PITCH_H} />
          <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r="9.15" />
          <rect x="0" y={PITCH_H / 2 - 20.16} width="16.5" height="40.32" />
          <rect x={PITCH_W - 16.5} y={PITCH_H / 2 - 20.16} width="16.5" height="40.32" />
          <rect x="0" y={PITCH_H / 2 - 9.16} width="5.5" height="18.32" />
          <rect x={PITCH_W - 5.5} y={PITCH_H / 2 - 9.16} width="5.5" height="18.32" />
          <rect x="-2" y={PITCH_H / 2 - 3.66} width="2" height="7.32" />
          <rect x={PITCH_W} y={PITCH_H / 2 - 3.66} width="2" height="7.32" />
        </g>
        {replay.players.map((p, i) => {
          let pos = playerAt(p, time, ball.x);
          if (i === shooter && shooterPos && scene) {
            // Weich hinein und wieder heraus (je eine Viertelminute)
            const f = Math.min(1, Math.max(0, (time - (scene.t - 0.6)) / 0.25), Math.max(0, (scene.t + 1.6 - time) / 0.25));
            const tx2 = shooterPos.x - (p.side === 0 ? 1.2 : -1.2);
            pos = { x: pos.x + (tx2 - pos.x) * f, y: pos.y + (shooterPos.y - pos.y) * f };
          }
          return (
            <g key={i} className={`match-pitch__player ${p.side === 0 ? 'is-home' : 'is-away'} ${i === shooter ? 'is-shooter' : ''}`}>
              <circle cx={pos.x} cy={pos.y} r={p.pos === 'TW' ? 1.9 : 1.7} />
              {p.pokemonId != null && !broken.has(p.pokemonId) && (
                <image
                  className="match-pitch__sprite"
                  href={`${SPRITE_BASE}${p.pokemonId}.png`}
                  x={pos.x - 3}
                  y={pos.y - 3.6}
                  width={6}
                  height={6}
                  onError={() => setBroken((b) => new Set(b).add(p.pokemonId!))}
                />
              )}
              {p.pokemonId != null && <title>{pokemonName(p.pokemonId)}</title>}
            </g>
          );
        })}
        <circle className="match-pitch__ball" cx={ball.x} cy={ball.y} r="0.95" />
      </svg>
      <p className="match-pitch__event" aria-live="polite">
        {recent
          ? recent.kind === 'goal'
            ? tx.goal(recent.scorer != null ? pokemonName(recent.scorer) : nameOf(recent.side === 0 ? match.home : match.away), recent.assist != null ? pokemonName(recent.assist) : null)
            : tx.shot(nameOf(recent.side === 0 ? match.home : match.away))
          : ' '}
      </p>
      <div className="match-pitch__controls">
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            if (time >= replay.end) setTime(0);
            setPlaying((x) => !x);
          }}
        >
          {playing ? tx.pause : time >= replay.end ? tx.again : tx.play}
        </button>
        <input
          type="range"
          className="match-pitch__slider"
          min={0}
          max={replay.end}
          step={0.1}
          value={time}
          aria-label={tx.seek}
          onChange={(e) => {
            setTime(Number(e.target.value));
          }}
        />
      </div>
    </div>
  );
}
