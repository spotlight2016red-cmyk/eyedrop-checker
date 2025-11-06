import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'

// グローバルエラーハンドラー（未処理のエラーをキャッチ）
window.addEventListener('error', (event) => {
  // ネットワークエラーやリソース読み込みエラーは静かに処理
  const isNetworkError = event.error?.name === 'AbortError' ||
                         event.error?.message?.includes('Load failed') ||
                         event.error?.message?.includes('Fetch is aborted') ||
                         event.message?.includes('Load failed');
  
  if (isNetworkError) {
    console.warn('[Global] ネットワークエラー（再接続を試みます）:', event.message);
    return; // ユーザーには通知しない
  }
  
  // その他のエラーは通常通りログに出力
  console.error('[Global] 未処理のエラー:', event.error || event.message);
});

// Promise rejection のハンドラー
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason;
  const isNetworkError = error?.code === 'unavailable' ||
                        error?.code === 'deadline-exceeded' ||
                        error?.message?.includes('transport errored') ||
                        error?.message?.includes('Fetch is aborted') ||
                        error?.name === 'AbortError';
  
  if (isNetworkError) {
    console.warn('[Global] Promise rejection（ネットワークエラー）:', error.code || error.name);
    event.preventDefault(); // デフォルトのエラー処理を防ぐ
    return;
  }
  
  console.error('[Global] 未処理のPromise rejection:', error);
});

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

// Service Workerリセット処理（リセット中はReactアプリをレンダリングしない）
const params = new URLSearchParams(window.location.search);
const isResetting = params.get('reset-sw') === '1';

if (isResetting && 'serviceWorker' in navigator) {
  // Service Workerとキャッシュを完全にクリアしてからリロード
  Promise.all([
    navigator.serviceWorker.getRegistrations().then((regs) => {
      return Promise.all(regs.map(r => r.unregister()));
    }),
    caches ? caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))) : Promise.resolve()
  ]).then(() => {
    // 少し待ってからリロード（確実にクリアされるように）
    setTimeout(() => {
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('_reload', Date.now().toString()); // キャッシュ回避
      window.location.href = url.toString(); // replaceではなくhrefで確実にリロード
    }, 500);
  }).catch((err) => {
    console.error('[SW Reset] エラー:', err);
    // エラーが発生してもリロードを試みる
    setTimeout(() => {
      window.location.href = window.location.origin + window.location.pathname + '?_reload=' + Date.now();
    }, 500);
  });
} else if (!isResetting && 'serviceWorker' in navigator) {
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

// リセット処理中はReactアプリをレンダリングしない
if (!isResetting) {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>,
  )
}
