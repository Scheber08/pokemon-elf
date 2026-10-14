import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Footer, Header } from './components/Layout';
import { useT } from './i18n';
import { Builder } from './pages/Builder';
import { PokemonDataProvider } from './state/PokemonData';
import { SettingsProvider } from './state/Settings';
import { ToastProvider } from './state/Toast';

/**
 * Alle Seiten außer dem Builder (Startseite) werden erst beim Aufruf geladen – das hält das
 * Start-Bundle klein. Benannte Exporte → default für React.lazy.
 */
const Challenge340 = lazy(() => import('./pages/Challenge340').then((m) => ({ default: m.Challenge340 })));
const Challenge151 = lazy(() => import('./pages/Challenge151').then((m) => ({ default: m.Challenge151 })));
const Daily = lazy(() => import('./pages/Daily').then((m) => ({ default: m.Daily })));
const Draft = lazy(() => import('./pages/Draft').then((m) => ({ default: m.Draft })));
const DraftRoom = lazy(() => import('./pages/DraftRoom').then((m) => ({ default: m.DraftRoom })));
const Leaderboard = lazy(() => import('./pages/Leaderboard').then((m) => ({ default: m.Leaderboard })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Scouting = lazy(() => import('./pages/Scouting').then((m) => ({ default: m.Scouting })));
const About = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.About })));
const Privacy = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.Privacy })));
const NotFound = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.NotFound })));

/** Platzhalter, solange eine Seite nachlädt */
function PageLoading() {
  const t = useT();
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot__ball" aria-hidden="true" />
      <p>{t.builder.data.loading}</p>
    </div>
  );
}

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
              <Suspense fallback={<PageLoading />}>
                <Routes>
                  <Route path="/" element={<Builder />} />
                  <Route path="/challenge" element={<Challenge340 />} />
                  <Route path="/taeglich" element={<Daily />} />
                  <Route path="/151" element={<Challenge151 />} />
                  <Route path="/draft" element={<Draft />} />
                  <Route path="/draft/:code" element={<DraftRoom />} />
                  <Route path="/rangliste" element={<Leaderboard />} />
                  <Route path="/scouting" element={<Scouting />} />
                  <Route path="/spieler/:entryId" element={<Profile />} />
                  <Route path="/ueber" element={<About />} />
                  <Route path="/datenschutz" element={<Privacy />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </PokemonDataProvider>
          </main>
          <Footer />
        </ToastProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
