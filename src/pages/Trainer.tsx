import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENTS } from '../lib/achievements';
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

function Achievements({ me, seen }: { me: MeResponse; seen: Set<string> }) {
  const t = useT();
  const tx = t.trainer;
  return (
    <>
      {ACHIEVEMENT_CATEGORIES.map((cat) => {
        const items = me.achievements.filter((a) => CATEGORY_OF.get(a.id) === cat);
        if (!items.length) return null;
        return (
          <section key={cat} className="card" aria-labelledby={`ach-${cat}`}>
            <h2 id={`ach-${cat}`} className="section-title">
              {tx.category[cat]}{' '}
              <small className="muted">{tx.progressValue(items.filter((a) => a.done).length, items.length)}</small>
            </h2>
            <ul className="achievements">
              {items.map((a) => {
                const text = tx.list[a.id] ?? { name: a.id, desc: '' };
                const fresh = a.done && !seen.has(a.id);
                return (
                  <li key={a.id} className={`achievement ${a.done ? 'is-done' : ''}`}>
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
                        <span className="achievement__bar" role="progressbar" aria-valuemin={0} aria-valuemax={a.goal} aria-valuenow={a.value}>
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
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
