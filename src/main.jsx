import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if ('serviceWorker' in navigator) {
  // Optional: reset SW via query param
  const params = new URLSearchParams(window.location.search);
  if (params.get('reset-sw') === '1') {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
      caches && caches.keys().then(keys => keys.forEach(k => caches.delete(k))).finally(() => {
        const url = new URL(window.location.href);
        url.search = '';
        window.location.replace(url.toString());
      });
    });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
