import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Footer, Header } from './components/Layout';
import { Builder } from './pages/Builder';
import { Challenge151 } from './pages/Challenge151';
import { Challenge340 } from './pages/Challenge340';
import { Draft } from './pages/Draft';
import { About, NotFound, Privacy } from './pages/InfoPages';
import { Leaderboard } from './pages/Leaderboard';
import { Scouting } from './pages/Scouting';
import { PokemonDataProvider } from './state/PokemonData';
import { SettingsProvider } from './state/Settings';
import { ToastProvider } from './state/Toast';

const TITLES: Record<string, string> = {
  '/': 'Builder',
  '/challenge': '34–0 Challenge',
  '/151': '151 Challenge',
  '/draft': 'Fantasy-Draft',
  '/rangliste': 'Rangliste',
  '/scouting': 'Scouting-Guide',
  '/ueber': 'Über & Kontakt',
  '/datenschutz': 'Datenschutz',
};

function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = TITLES[pathname];
    document.title = t ? `${t} · Pokémon Elf` : 'Pokémon Elf – Lineup Builder';
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <SettingsProvider>
        <ToastProvider>
          <a className="skip-link" href="#main">
            Zum Inhalt springen
          </a>
          <Header />
          <main id="main" className="main">
            <PokemonDataProvider>
              <RouteEffects />
              <Routes>
                <Route path="/" element={<Builder />} />
                <Route path="/challenge" element={<Challenge340 />} />
                <Route path="/151" element={<Challenge151 />} />
                <Route path="/draft" element={<Draft />} />
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
