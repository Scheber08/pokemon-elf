import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Globale Styles zuerst – Komponenten-CSS (run.css, ticker.css, daily.css) baut darauf auf.
import './styles/global.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
