import { Link, NavLink } from 'react-router-dom';
import { useT } from '../i18n';
import { useSettings } from '../state/Settings';

const TABS = [
  { to: '/', key: 'builder', end: true },
  { to: '/challenge', key: 'c340' },
  { to: '/taeglich', key: 'daily' },
  { to: '/151', key: 'c151' },
  { to: '/draft', key: 'draft' },
  { to: '/rangliste', key: 'leaderboard' },
] as const;

export function Header() {
  const { theme, setTheme, lang, setLang } = useSettings();
  const t = useT();
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="logo" aria-label={t.nav.homeAria}>
          <span className="logo__ball" aria-hidden="true" />
          <span className="logo__text">
            Pokémon <b>Elf</b>
          </span>
          <span className="logo__sub">{t.nav.logoSub}</span>
        </Link>
        <div className="site-header__tools">
          <button
            type="button"
            className="icon-btn lang-toggle"
            onClick={() => setLang(lang === 'de' ? 'en' : 'de')}
            aria-label={t.nav.langSwitchTo}
            title={t.nav.langSwitchTo}
          >
            <span aria-hidden="true">{lang === 'de' ? 'EN' : 'DE'}</span>
          </button>
          <button
            type="button"
            className="icon-btn theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? t.nav.themeToLight : t.nav.themeToDark}
            title={theme === 'dark' ? t.nav.themeLight : t.nav.themeDark}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </div>
      <nav className="tabs" aria-label={t.nav.mainNav}>
        <div className="tabs__inner">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={'end' in tab ? tab.end : undefined}
              className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}
            >
              {t.nav.tabs[tab.key]}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="subnav">
        <Link to="/scouting" className="subnav__link">
          <span aria-hidden="true">/</span>scouting <span className="subnav__hint">{t.nav.scoutingHint}</span>
        </Link>
      </div>
    </header>
  );
}

export function Footer() {
  const t = useT();
  return (
    <footer className="site-footer">
      <p>{t.nav.footerDisclaimer}</p>
      <p className="site-footer__links">
        <Link to="/scouting">{t.nav.footerScouting}</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/ueber">{t.nav.footerAbout}</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/datenschutz">{t.nav.footerPrivacy}</Link>
      </p>
    </footer>
  );
}
