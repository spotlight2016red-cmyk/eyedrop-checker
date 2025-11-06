import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'

// Lightweight mobile console (eruda) auto-loader
(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const debugOn = params.get('debug') === '1' || localStorage.getItem('eruda') === 'on';
    if (!debugOn) return;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/eruda';
    script.onload = () => {
      try { window.eruda && window.eruda.init(); } catch {}
    };
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(script));
  } catch {}
})();

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
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        // SWの更新を検知
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // 新しいSWがインストールされたら、ユーザーに通知（または自動リロード）
                console.log('新しいバージョンが利用可能です。ページをリロードしてください。');
                // 自動リロード（必要に応じてコメントアウト）
                // window.location.reload();
              }
            });
          }
        });
      }).catch(() => {});
      
      // 定期的にSWの更新をチェック
      setInterval(() => {
        navigator.serviceWorker.getRegistration().then((registration) => {
          if (registration) {
            registration.update();
          }
        });
      }, 60000); // 1分ごとにチェック
    });
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
