import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Footer, Header } from './components/Layout';
import { useT } from './i18n';
import { Builder } from './pages/Builder';
import { Challenge151 } from './pages/Challenge151';
import { Challenge340 } from './pages/Challenge340';
import { Daily } from './pages/Daily';
import { Draft } from './pages/Draft';
import { DraftRoom } from './pages/DraftRoom';
import { About, NotFound, Privacy } from './pages/InfoPages';
import { Leaderboard } from './pages/Leaderboard';
import { Scouting } from './pages/Scouting';
import { PokemonDataProvider } from './state/PokemonData';
import { SettingsProvider } from './state/Settings';
import { ToastProvider } from './state/Toast';

function RouteEffects() {
  const { pathname } = useLocation();
  const t = useT();
  useEffect(() => {
    // Online-Ligen (/draft/CODE) setzen ihren Titel selbst (Liganame, „Du bist dran")
    const title = t.nav.titles[pathname] ?? (pathname.startsWith('/draft/') ? t.nav.onlineLeague : undefined);
    document.title = title ? `${title} · Pokémon Elf` : t.nav.siteTitle;
  }, [pathname, t]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function SkipLink() {
  const t = useT();
  return (
    <a className="skip-link" href="#main">
      {t.nav.skip}
    </a>
  );
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <SettingsProvider>
        <ToastProvider>
          <SkipLink />
          <Header />
          <main id="main" className="main">
            <PokemonDataProvider>
              <RouteEffects />
              <Routes>
                <Route path="/" element={<Builder />} />
                <Route path="/challenge" element={<Challenge340 />} />
                <Route path="/taeglich" element={<Daily />} />
                <Route path="/151" element={<Challenge151 />} />
                <Route path="/draft" element={<Draft />} />
                <Route path="/draft/:code" element={<DraftRoom />} />
                <Route path="/rangliste" element={<Leaderboard />} />
                <Route path="/scouting" element={<Scouting />} />
                <Route path="/ueber" element={<About />} />
                <Route path="/datenschutz" element={<Privacy />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </PokemonDataProvider>
          </main>
          <Footer />
        </ToastProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
