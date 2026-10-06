import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initCapacitorPlatform } from './platform.ts'

// Initialize Capacitor native plugins (StatusBar, Android Back Button)
initCapacitorPlatform();

// Register Service Worker for PWA shell caching (browser environments)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('Pharmora POS ServiceWorker registered:', reg.scope);
      })
      .catch((err) => {
        console.warn('Pharmora POS ServiceWorker registration failed:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

