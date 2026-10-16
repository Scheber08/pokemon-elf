import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Globale Styles zuerst – Komponenten-CSS (run.css, ticker.css, daily.css) baut darauf auf.
import './styles/global.css';
import { App } from './App';
import { installScrollFocus } from './lib/scrollFocus';

const root = document.getElementById('root')!;
// Breite Tabellen per Tastatur scrollbar (tabindex nur bei Überlauf) – auf body, damit Dialoge (Portal) mitzählen
installScrollFocus(document.body);
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
