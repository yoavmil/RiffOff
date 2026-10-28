import { StrictMode } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n';

/** Entry point shared by every design: `mount(App)` from the design's main.tsx. */
export function mount(App: ComponentType) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );

  // Register the service worker in production builds only, so the dev server
  // always serves fresh files.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        /* PWA install is optional; the app works without it */
      });
    });
  }
}
