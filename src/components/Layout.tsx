import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useScrollActiveIntoView } from '../lib/scrollActive';
import { ACHIEVEMENT_BADGE_EVENT, hasAchievementBadge } from './AchievementWatcher';
import { useT } from '../i18n';
import { useSettings } from '../state/Settings';

const TABS = [
  { to: '/', key: 'builder', end: true },
  { to: '/challenge', key: 'c340' },
  { to: '/taeglich', key: 'daily' },
  { to: '/151', key: 'c151' },
  { to: '/draft', key: 'draft' },
  { to: '/manager', key: 'manager' },
  { to: '/rangliste', key: 'leaderboard' },
  { to: '/trainer', key: 'trainer' },
] as const;

export function Header() {
  const { theme, setTheme, lang, setLang } = useSettings();
  const t = useT();
  const { pathname } = useLocation();
  // Handy: aktiven Reiter der Hauptnavigation ins Bild holen
  const navRef = useRef<HTMLElement>(null);
  useScrollActiveIntoView(navRef, [pathname]);
  // Punkt am Reiter „Trainer", solange neue Erfolge nicht angesehen sind
  const [badge, setBadge] = useState(hasAchievementBadge);
  useEffect(() => {
    const update = () => setBadge(hasAchievementBadge());
    window.addEventListener(ACHIEVEMENT_BADGE_EVENT, update);
    return () => window.removeEventListener(ACHIEVEMENT_BADGE_EVENT, update);
  }, []);
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
            // Beschriftung steht in der Zielsprache – Screenreader sprechen sie so richtig aus
            lang={lang === 'de' ? 'en' : 'de'}
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
      <nav className="tabs" aria-label={t.nav.mainNav} ref={navRef}>
        <div className="tabs__inner">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={'end' in tab ? tab.end : undefined}
              className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}
            >
              {t.nav.tabs[tab.key]}
              {tab.key === 'trainer' && badge && (
                <span className="tab__dot" title={t.nav.newAchievements}>
                  <span className="sr-only">{t.nav.newAchievements}</span>
                </span>
              )}
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
      {/* Stand der ausgelieferten Version – zeigt, ob das Neueste geladen ist */}
      <p className="site-footer__build muted small">{t.nav.buildDay(t.game.day(__BUILD_DAY__))}</p>
    </footer>
  );
}
