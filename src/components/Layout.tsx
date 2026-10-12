import { Link, NavLink } from 'react-router-dom';
import { useSettings } from '../state/Settings';

const TABS = [
  { to: '/', label: 'Builder', end: true },
  { to: '/challenge', label: '34–0 Challenge' },
  { to: '/151', label: '151 Challenge' },
  { to: '/draft', label: 'Fantasy-Draft' },
  { to: '/rangliste', label: 'Rangliste' },
];

export function Header() {
  const { theme, setTheme } = useSettings();
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="logo" aria-label="Pokémon Elf – zur Startseite">
          <span className="logo__ball" aria-hidden="true" />
          <span className="logo__text">
            Pokémon <b>Elf</b>
          </span>
          <span className="logo__sub">Lineup Builder</span>
        </Link>
        <button
          type="button"
          className="icon-btn theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'}
          title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
      <nav className="tabs" aria-label="Hauptnavigation">
        <div className="tabs__inner">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="subnav">
        <Link to="/scouting" className="subnav__link">
          <span aria-hidden="true">/</span>scouting <span className="subnav__hint">Scouting-Guide →</span>
        </Link>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <p>
        Kostenloses Fan-Projekt. Nicht verbunden mit oder unterstützt von Nintendo, Game Freak, Creatures oder The
        Pokémon Company. Pokémon-Namen und -Artwork gehören ihren jeweiligen Eigentümern.
      </p>
      <p className="site-footer__links">
        <Link to="/scouting">Scouting-Guide</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/ueber">Über &amp; Kontakt</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/datenschutz">Datenschutz</Link>
      </p>
    </footer>
  );
}
