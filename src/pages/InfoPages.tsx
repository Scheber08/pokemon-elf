import { Link } from 'react-router-dom';
import { useT } from '../i18n';

export function About() {
  const t = useT();
  const a = t.info.about;
  return (
    <div className="page prose-page">
      <header className="page-head">
        <h1 className="page-title">{a.title}</h1>
      </header>
      <section className="card prose">
        <p>
          <strong>Pokémon Elf</strong>
          {a.intro}
        </p>
        <p>
          {a.dataPre}
          <a href="https://pokeapi.co" target="_blank" rel="noreferrer">
            {a.dataLink}
          </a>
          {a.dataPost}
        </p>
        <p>
          {a.guidePre}
          <Link to="/scouting">{a.guideLink}</Link>
          {a.guidePost}
        </p>
        <h2 className="section-title">{a.newsTitle}</h2>
        <ul>
          {a.news.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2 className="section-title">{a.contactTitle}</h2>
        <p>{a.contact}</p>
        <p className="muted small">{a.disclaimer}</p>
      </section>
    </div>
  );
}

export function Privacy() {
  const t = useT();
  const p = t.info.privacy;
  return (
    <div className="page prose-page">
      <header className="page-head">
        <h1 className="page-title">{p.title}</h1>
      </header>
      <section className="card prose">
        <p>{p.intro}</p>
        <h2 className="section-title">{p.localTitle}</h2>
        <p>{p.local}</p>
        <h2 className="section-title">{p.leaderboardTitle}</h2>
        <p>{p.leaderboardIntro}</p>
        <ul>
          {p.leaderboardItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{p.leaderboardStorage}</p>
        <h2 className="section-title">{p.leaguesTitle}</h2>
        <p>{p.leagues}</p>
        <p>{p.leaguesAbuse}</p>
        <h2 className="section-title">{p.externalTitle}</h2>
        <p>
          {p.externalPre}
          <code>raw.githubusercontent.com</code>
          {p.externalPost}
        </p>
        <h2 className="section-title">{p.sharedTitle}</h2>
        <p>{p.shared}</p>
      </section>
    </div>
  );
}

export function NotFound() {
  const t = useT();
  const n = t.info.notFound;
  return (
    <div className="page prose-page">
      <section className="card prose empty">
        <h1 className="page-title">{n.title}</h1>
        <p>{n.text}</p>
        <Link className="btn btn--primary" to="/">
          {n.back}
        </Link>
        {/* Oder gleich in einen anderen Modus */}
        <p className="muted small not-found__or">{n.or}</p>
        <p className="not-found__links">
          {(
            [
              ['/taeglich', t.nav.tabs.daily],
              ['/challenge', t.nav.tabs.c340],
              ['/draft', t.nav.tabs.draft],
              ['/rangliste', t.nav.tabs.leaderboard],
            ] as const
          ).map(([to, label]) => (
            <Link key={to} className="btn btn--small" to={to}>
              {label}
            </Link>
          ))}
        </p>
      </section>
    </div>
  );
}
