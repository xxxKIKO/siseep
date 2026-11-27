import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { initSentry } from './lib/sentry';

void initSentry();

// Start downloading the screens of this URL while the session is being restored, instead of
// waiting for the router (saves one round trip on a slow phone connection).
const path = window.location.pathname;
if (path.startsWith('/maestro')) void import('./portals/teacher');
if (path.startsWith('/director'))
  void Promise.all([import('./portals/director'), import('./portals/teacher')]);
if (path.startsWith('/padres')) void import('./portals/guardian');
if (path.startsWith('/admin')) void import('./portals/admin');

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
