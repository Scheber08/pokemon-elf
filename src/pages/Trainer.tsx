import { setAchievementBadge } from '../components/AchievementWatcher';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENTS, type AchievementStats } from '../lib/achievements';
import { fetchMe } from '../lib/api/client';
import type { MeResponse } from '../lib/api/contract';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import { TrainerEditor } from '../components/TrainerEditor';
import '../styles/trainer.css';

type Status = { status: 'loading' } | { status: 'ready'; me: MeResponse } | { status: 'error'; message: string };

const CATEGORY_OF = new Map(ACHIEVEMENTS.map((a) => [a.id, a.category]));

/** /trainer – Erfolge und Münzen des eigenen Geräts. */
export function Trainer() {
  const t = useT();
  const tx = t.trainer;
  const [state, setState] = useState<Status>({ status: 'loading' });
  /** Beim Öffnen schon bekannte Erfolge – alles andere Erreichte ist „neu" */
  const [seen] = useState(() => new Set(load<string[]>(STORAGE_KEYS.seenAchievements, [])));

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    fetchMe().then(
      (me) => {
        setState({ status: 'ready', me });
        save(
          STORAGE_KEYS.seenAchievements,
          me.achievements.filter((a) => a.done).map((a) => a.id),
        );
      },
      (e: unknown) => setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, []);

  useEffect(() => {
    reload();
    setAchievementBadge(false);
  }, [reload]);

  useEffect(() => {
    document.title = `${tx.title} · Pokémon Elf`;
  }, [tx.title]);

  return (
    <div className="page trainer">
      <header className="page-head">
        <span className="kicker">{tx.kicker}</span>
        <h1 className="page-title">{tx.title}</h1>
        <p className="page-lead">{tx.lead}</p>
      </header>

      {state.status === 'loading' ? (
        <p className="notice" role="status">
          {tx.loading}
        </p>
      ) : state.status === 'error' ? (
        <div className="notice notice--error" role="alert">
          <p>{tx.error(state.message)}</p>
          <button type="button" className="btn btn--small" onClick={reload}>
            {tx.retry}
          </button>
        </div>
      ) : (
        <>
          <Wallet me={state.me} />
          {state.me.stats && <RecordCard stats={state.me.stats} />}
          <TrainerEditor me={state.me} onMe={(me) => setState({ status: 'ready', me })} />
          <Achievements me={state.me} seen={seen} />
        </>
      )}
    </div>
  );
}

/** Münzen: Kontostand, verdient, Fortschritt der Erfolge */
function Wallet({ me }: { me: MeResponse }) {
  const t = useT();
  const tx = t.trainer;
  const done = me.achievements.filter((a) => a.done).length;
  return (
    <>
      <section className="card trainer__wallet" aria-label={tx.coins} aria-live="polite">
        <span className="trainer__coin" aria-hidden="true">
          ◎
        </span>
        <div>
          <strong className="trainer__balance">{tx.coinsValue(me.coins.balance)}</strong>
          <p className="muted small">
            {tx.earned(me.coins.earned)} · {tx.progress(done, me.achievements.length)}
          </p>
        </div>
      </section>
      {!me.player && <p className="notice">{tx.noName}</p>}
    </>
  );
}

/** Fast geschafft: offene Erfolge mit Teilfortschritt, am weitesten zuerst (höchstens 3) */
export function closest(me: MeResponse): MeResponse['achievements'] {
  return me.achievements
    .filter((a) => !a.done && a.goal > 1 && a.value > 0)
    .sort((a, b) => b.value / b.goal - a.value / a.goal || a.goal - a.value - (b.goal - b.value))
    .slice(0, 3);
}

/** Bilanz: die Kennzahlen hinter den Erfolgen auf einen Blick */
export function RecordCard({ stats }: { stats: AchievementStats }) {
  const tx = useT().trainer.record;
  const d = stats.draft;
  const items: [string, string | number][] = [
    [tx.runs, stats.runs],
    [tx.streak, stats.dailyStreak],
    [tx.dailyWins, stats.dailyWins],
    [tx.bestPlace, stats.bestPlace != null ? `${stats.bestPlace}.` : '–'],
    [tx.leagues, d.leagues],
    [tx.titles, d.titles + d.cups + d.manager],
    // Podestplätze (Ligen, Turniere und Manager-Saisons zusammen), perfekte Saisons (nur Siege) über alle Challenges
    [tx.podiums, d.podiums],
    [tx.perfect, Object.values(stats.challenges).reduce((sum, c) => sum + (c?.perfect ?? 0), 0)],
  ];
  return (
    <section className="card trainer__record" aria-labelledby="trainer-record">
      <h2 id="trainer-record" className="section-title">
        {tx.title}
      </h2>
      <dl className="trainer__record-grid">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="muted small">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Achievements({ me, seen }: { me: MeResponse; seen: Set<string> }) {
  const t = useT();
  const tx = t.trainer;
  const near = closest(me);
  // Nur offene Erfolge zeigen – mit den Münzen, die dort noch zu holen sind
  const [openOnly, setOpenOnly] = useState(false);
  const open = me.achievements.filter((a) => !a.done);
  const openCoins = open.reduce((sum, a) => sum + a.coins, 0);
  return (
    <>
      {open.length > 0 && open.length < me.achievements.length && (
        <p className="achievements__filter">
          <button type="button" className="btn btn--small btn--ghost" aria-pressed={openOnly} onClick={() => setOpenOnly((v) => !v)}>
            {openOnly ? '✓ ' : ''}
            {tx.openOnly(open.length, openCoins)}
          </button>
        </p>
      )}
      {near.length > 0 && (
        <section className="card" aria-labelledby="ach-near">
          <h2 id="ach-near" className="section-title">
            {tx.nearTitle}
          </h2>
          <ul className="achievements">
            {near.map((a) => (
              <AchievementItem key={a.id} a={a} fresh={false} />
            ))}
          </ul>
        </section>
      )}
      {ACHIEVEMENT_CATEGORIES.map((cat) => {
        const all = me.achievements.filter((a) => CATEGORY_OF.get(a.id) === cat);
        const items = openOnly ? all.filter((a) => !a.done) : all;
        if (!items.length) return null;
        return (
          <section key={cat} className="card" aria-labelledby={`ach-${cat}`}>
            <h2 id={`ach-${cat}`} className="section-title">
              {tx.category[cat]}{' '}
              <small className="muted">{tx.progressValue(all.filter((a) => a.done).length, all.length)}</small>
              {all.length > 0 && all.every((a) => a.done) && (
                <span className="achievements__complete" role="img" title={tx.categoryComplete} aria-label={tx.categoryComplete}>
                  {' '}
                  ✅
                </span>
              )}
            </h2>
            <ul className="achievements">
              {items.map((a) => (
                <AchievementItem key={a.id} a={a} fresh={a.done && !seen.has(a.id)} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** Ein Erfolg: Name, Beschreibung, Fortschritt und Belohnung */
export function AchievementItem({ a, fresh }: { a: MeResponse['achievements'][number]; fresh: boolean }) {
  const tx = useT().trainer;
  const text = tx.list[a.id] ?? { name: a.id, desc: '' };
  return (
    <li className={`achievement ${a.done ? 'is-done' : ''}`}>
      <span className="achievement__icon" aria-hidden="true">
        {a.done ? '★' : '☆'}
      </span>
      <div className="achievement__body">
        <strong className="achievement__name">
          {text.name}
          {fresh && <span className="achievement__new">{tx.newBadge}</span>}
        </strong>
        <span className="achievement__desc">{text.desc}</span>
        {!a.done && a.goal > 1 && (
          <span
            className="achievement__bar"
            role="progressbar"
            aria-label={tx.progressAria(text.name)}
            aria-valuemin={0}
            aria-valuemax={a.goal}
            aria-valuenow={a.value}
          >
            <span style={{ width: `${(a.value / a.goal) * 100}%` }} />
          </span>
        )}
      </div>
      <span className="achievement__reward" title={tx.rewardTitle(a.coins)}>
        {a.done ? tx.done : a.goal > 1 ? tx.progressValue(a.value, a.goal) : ''}
        <small>{tx.reward(a.coins)} ◎</small>
      </span>
    </li>
  );
}
