import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { draftsSupported } from '../lib/api/draftClient';
import { NotifyToggle } from '../components/NotifyToggle';
import { CreateLeague, JoinByCode, RecentLeagues } from './DraftOnline';
import '../styles/draft.css';

/**
 * /manager – die Manager-Saison als eigener Menüpunkt: kurz erklärt, Liga direkt anlegen (Spielmodus
 * „Manager-Saison" vorbelegt), eigene Ligen und Beitreten per Code. Gespielt wird im Online-Draft (/draft/:code).
 */
export function Manager() {
  const t = useT();
  const tx = t.manager;
  const [supported, setSupported] = useState<boolean | null>(null);
  const [check, setCheck] = useState(0);
  useEffect(() => {
    let alive = true;
    draftsSupported(check > 0).then((ok) => alive && setSupported(ok));
    return () => {
      alive = false;
    };
  }, [check]);
  useEffect(() => {
    document.title = `${tx.title} · Pokémon Elf`;
  }, [tx.title]);

  return (
    <div className="page draft draft-online manager-page">
      <header className="page-head">
        <span className="kicker">{tx.kicker}</span>
        <h1 className="page-title">{tx.title}</h1>
        <p className="page-lead">{tx.lead}</p>
      </header>
      <section className="card manager-page__how" aria-labelledby="manager-how">
        <h2 id="manager-how" className="section-title">
          {tx.howTitle}
        </h2>
        <ol className="manager-page__steps">
          {tx.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {/* Hinweise schon vor der ersten Liga einschalten können */}
        <p className="manager-page__notify">
          <span className="muted small">{tx.notifyNote}</span> <NotifyToggle />
        </p>
      </section>
      {supported == null && (
        <p className="runnet runnet--checking" role="status">
          <span className="runnet__dot" aria-hidden="true" />
          {t.online.checking}
        </p>
      )}
      {supported === false && (
        <div className="notice draft-offline" role="status">
          <p>
            <strong>{t.online.offlineTitle}</strong> {tx.offline}
          </p>
          <button type="button" className="btn btn--small" onClick={() => setCheck((c) => c + 1)}>
            {t.online.checkAgain}
          </button>
        </div>
      )}
      {supported && (
        <div className="draft-online__grid">
          <CreateLeague preset={{ format: 'manager' }} storageKey="manager:settings" title={tx.createTitle} />
          <div className="draft-online__side">
            <RecentLeagues only="manager" />
            <JoinByCode />
            <p className="muted small">
              {tx.otherModes} <Link to="/draft">{t.nav.tabs.draft}</Link>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
