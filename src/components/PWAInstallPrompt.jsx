import { useState, useEffect } from 'react';
import './PWAInstallPrompt.css';

export function PWAInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // iOSかどうか判定
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    // PWAとしてインストール済みかどうか判定
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
                       (window.navigator.standalone === true) ||
                       document.referrer.includes('android-app://');
    setIsStandalone(standalone);

    // まだインストールされていない場合、一度だけ表示
    if (!standalone) {
      const hasSeenPrompt = localStorage.getItem('pwa-install-prompt-seen');
      if (!hasSeenPrompt) {
        // 少し遅延して表示（ユーザーがアプリを使い始めてから）
        setTimeout(() => {
          setShowPrompt(true);
        }, 3000);
      }
    }
  }, []);

  const handleClose = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-prompt-seen', 'true');
  };

  const handleInstall = () => {
    if (isIOS) {
      // iOSの場合は手順を表示
      setShowPrompt(false);
      alert('iOSの場合:\n1. 画面下部の「共有」ボタンをタップ\n2. 「ホーム画面に追加」を選択\n3. 「追加」をタップ');
    } else {
      // Androidの場合はブラウザのインストールプロンプトを表示
      // Chromeの場合、beforeinstallpromptイベントを使用
      window.addEventListener('beforeinstallprompt', (e) => {
        e.prompt();
      });
    }
    localStorage.setItem('pwa-install-prompt-seen', 'true');
  };

  if (isStandalone || !showPrompt) return null;

  return (
    <div className="pwa-install-overlay">
      <div className="pwa-install-card">
        <button className="pwa-install-close" onClick={handleClose}>×</button>
        <h3 className="pwa-install-title">ホーム画面に追加</h3>
        <p className="pwa-install-desc">
          アプリをホーム画面に追加すると、通知がより確実に届き、より快適に使えます。
        </p>
        {isIOS ? (
          <div className="pwa-install-steps">
            <p className="pwa-install-step-title">iOSの場合:</p>
            <ol className="pwa-install-step-list">
              <li>画面下部の<span className="pwa-install-highlight">「共有」</span>ボタンをタップ</li>
              <li><span className="pwa-install-highlight">「ホーム画面に追加」</span>を選択</li>
              <li><span className="pwa-install-highlight">「追加」</span>をタップ</li>
            </ol>
          </div>
        ) : (
          <div className="pwa-install-steps">
            <p className="pwa-install-step-title">Androidの場合:</p>
            <ol className="pwa-install-step-list">
              <li>ブラウザのメニュー（<span className="pwa-install-highlight">⋮</span>）をタップ</li>
              <li><span className="pwa-install-highlight">「アプリをインストール」</span>または<span className="pwa-install-highlight">「ホーム画面に追加」</span>を選択</li>
            </ol>
          </div>
        )}
        <button className="pwa-install-btn" onClick={handleInstall}>
          追加する
        </button>
        <button className="pwa-install-later" onClick={handleClose}>
          後で
        </button>
      </div>
    </div>
  );
}

