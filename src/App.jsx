import { useEffect, useMemo, useState, useRef } from 'react'
import './App.css'
import { startScheduler, requestPermission, showNotification } from './utils/notificationHelper.js'
import { AvatarMascot } from './components/AvatarMascot.jsx'
import { useAuth } from './contexts/AuthContext.jsx'
import { Login } from './components/Login.jsx'
import { CameraMonitor } from './components/CameraMonitor.jsx'
import { PhotoCapture } from './components/PhotoCapture.jsx'
import { FamilyNotification, notifyFamily } from './components/FamilyNotification.jsx'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from './config/firebase.js'
import { PWAInstallPrompt } from './components/PWAInstallPrompt.jsx'

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const SLOTS = [
  { id: 'morning', label: '朝' },
  { id: 'noon', label: '昼' },
  { id: 'night', label: '夜' },
];

function AppContent() {
  const { user, logout } = useAuth();
  const storageKey = `eyedrop-checker:v1:${user?.uid || 'guest'}`;
  const settingsKey = `eyedrop-checker:settings:${user?.uid || 'guest'}`;
  
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(settingsKey);
      return raw ? JSON.parse(raw) : { notifications: false, times: { morning: '08:00', noon: '12:00', night: '20:00' } };
    } catch {
      return { notifications: false, times: { morning: '08:00', noon: '12:00', night: '20:00' } };
    }
  });
  const [banner, setBanner] = useState(null); // { text, slot }
  const [highlightSlot, setHighlightSlot] = useState(null); // 'morning' | 'noon' | 'night' | null
  const [updateAvailable, setUpdateAvailable] = useState(false); // SW更新が利用可能か
  const processedNotificationsRef = useRef(new Set()); // 処理済み通知IDを追跡（メモリ用）

  const key = useMemo(() => todayKey(), []);
  const day = data[key] ?? { morning: false, noon: false, night: false, note: '' };

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(data));
  }, [data, storageKey]);

  useEffect(() => {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, [settings, settingsKey]);

  // ログイン後に通知許可を要求
  useEffect(() => {
    if (!user) return;
    
    // 通知許可が`default`の場合は自動的に要求
    if ('Notification' in window && Notification.permission === 'default') {
      console.log('[App] ログイン検出: 通知許可を要求します');
      requestPermission().then((permission) => {
        console.log('[App] 通知許可結果:', permission);
        if (permission === 'granted') {
          console.log('[App] ✅ 通知許可が取得されました');
        } else if (permission === 'denied') {
          console.warn('[App] ⚠️ 通知許可が拒否されました');
        }
      }).catch((err) => {
        console.error('[App] 通知許可要求エラー:', err);
      });
    }
  }, [user]);

  // start local scheduler
  useEffect(() => {
    requestPermission();
    const stop = startScheduler(() => data, () => settings);
    return () => stop && stop();
  }, [data, settings]);

  // 家族通知のリアルタイム監視（自分宛の通知を受け取る）
  useEffect(() => {
    if (!user?.email) {
      console.log('[App] 家族通知監視: ユーザーがログインしていません');
      return;
    }

    const processedNotificationsKey = `eyedrop-checker:processed-notifications:${user.uid}`; // localStorage用キー

    // localStorageから処理済み通知IDを読み込む
    try {
      const saved = localStorage.getItem(processedNotificationsKey);
      if (saved) {
        const savedIds = JSON.parse(saved);
        processedNotificationsRef.current = new Set(savedIds);
        console.log('[App] 処理済み通知IDを読み込み:', savedIds.length, '件');
      }
    } catch (err) {
      console.error('[App] 処理済み通知IDの読み込みエラー:', err);
    }

    console.log('[App] 家族通知監視開始:', user.email);
    const q = query(
      collection(db, 'notifications'),
      where('email', '==', user.email),
      where('read', '==', false)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log('[App] 通知スナップショット更新:', snapshot.size, '件');
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const notifId = change.doc.id;
          const notif = change.doc.data();
          
          // 既に処理済みの通知はスキップ（メモリ + localStorageの両方をチェック）
          if (processedNotificationsRef.current.has(notifId)) {
            // スキップログは出力しない（コンソールが煩雑になるため）
            return;
          }

          // localStorageもチェック（タブ間でも共有）
          try {
            const saved = localStorage.getItem(processedNotificationsKey);
            if (saved) {
              const savedIds = JSON.parse(saved);
              if (savedIds.includes(notifId)) {
                // スキップログは出力しない（コンソールが煩雑になるため）
                processedNotificationsRef.current.add(notifId); // メモリにも追加
                return;
              }
            }
          } catch (err) {
            console.error('[App] localStorageチェックエラー:', err);
          }
          
          // 処理済みフラグを設定（メモリ + localStorage）
          processedNotificationsRef.current.add(notifId);
          try {
            const saved = localStorage.getItem(processedNotificationsKey);
              const savedIds = saved ? JSON.parse(saved) : [];
              if (!savedIds.includes(notifId)) {
                savedIds.push(notifId);
                // 配列のサイズを制限する（最新100件を保持）
                const limitedIds = savedIds.slice(-100);
                localStorage.setItem(processedNotificationsKey, JSON.stringify(limitedIds));
                console.log('[App] 新しい通知を処理:', notifId, '（処理済み:', limitedIds.length, '件）');
              }
          } catch (err) {
            console.error('[App] localStorage保存エラー:', err);
          }
          
          // 通知を送信（カメラ監視からの通知か、家族からの通知かを判定）
          const notificationTitle = notif.type === 'camera-alert' 
            ? '目薬の使用を確認してください' 
            : '家族からの通知';
          const notificationTag = notif.type === 'camera-alert'
            ? `camera-no-motion-${key}`
            : `family-${change.doc.id}`;
          const notificationData = notif.type === 'camera-alert'
            ? { type: 'camera-no-motion', date: key, message: notif.message }
            : { type: 'family-notification', id: change.doc.id };
          
          const notificationResult = showNotification(notificationTitle, {
            body: notif.message,
            tag: notificationTag,
            data: notificationData
          });
          
          // フォーカス中の場合は即座にページ内バナーも表示（スマホでも確実に表示）
          if (document.hasFocus()) {
            if (notif.type === 'camera-alert') {
              console.log('[App] カメラ監視通知: フォーカス中のためページ内バナーを表示');
              setBanner({ 
                text: notif.message,
                slot: null // カメラ監視通知はslotがない
              });
            } else {
              console.log('[App] 家族通知: フォーカス中のためページ内バナーを表示');
              setBanner({ 
                text: `家族からの通知\n${notif.message}`,
                slot: null // 家族通知はslotがない
              });
            }
            
            // 通知が表示された場合はバナーを閉じる（ただし、Service Worker経由の場合はonshowが発火しない可能性がある）
            setTimeout(async () => {
              try {
                const result = await notificationResult;
                if (result) {
                  result.onshow = () => {
                    console.log('[App] 家族通知: 通知が表示された');
                    // 通知が表示された場合はバナーを閉じる（ユーザーが既に通知を見た）
                    // ただし、フォーカス中のページでは通知が表示されない場合が多いので、バナーは残す
                  };
                }
              } catch (e) {
                console.error('[App] 家族通知: 通知結果の取得エラー', e);
              }
            }, 100);
          }
        }
      });
    }, (error) => {
      console.error('[App] 通知監視エラー:', error);
    });

    return () => {
      console.log('[App] 家族通知監視を停止');
      unsubscribe();
    };
  }, [user]);

  // SW更新の検知
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (registration) {
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  setUpdateAvailable(true);
                }
              });
            }
          });
          // 定期的に更新をチェック
          setInterval(() => {
            registration.update();
          }, 60000);
        }
      });
    }
  }, []);

  // handle deep-link from notification: /?slot=...&date=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slot = params.get('slot');
    const date = params.get('date');
    if (slot && date) {
      const jp = slot === 'morning' ? '朝' : slot === 'noon' ? '昼' : '夜';
      setBanner({ text: `通知から開きました\n${jp}の目薬を済にしますか？`, slot });
      setHighlightSlot(slot);
      // 1回だけにするためURLをクリーンアップ
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url);
    }

    // SWからのpostMessage（フォーカスのみでナビゲートしないケースのバックアップ表示）
    if ('serviceWorker' in navigator) {
      const onMsg = (e) => {
        console.log('[App] SW message received:', e.data);
        const data = e.data || {};
        
        // カメラ監視からの通知（動きなし）
        if (data.type === 'camera-no-motion' && data.date === key) {
          console.log('[App] Showing camera-no-motion banner:', data.message);
          setBanner({ 
            text: data.message || `${key}の目薬が使用されていません（5分以上動きが検出されませんでした）`, 
            slot: null 
          });
          return;
        }
        
        if (data.type === 'from-notification' && data.slot) {
          console.log('[App] Showing banner from notification:', data.slot);
          const jp2 = data.slot === 'morning' ? '朝' : data.slot === 'noon' ? '昼' : '夜';
          setBanner({ text: `通知から開きました\n${jp2}の目薬を済にしますか？`, slot: data.slot });
          setHighlightSlot(data.slot);
        }
        // localStorageフラグを立てる指示
        if (data.type === 'set-notif-flag' && data.slot && data.date) {
          console.log('[App] Setting notif flag:', data.slot, data.date);
          try {
            localStorage.setItem('eyedrop-checker:notif-flag', JSON.stringify({ slot: data.slot, date: data.date }));
          } catch {}
        }
      };
      navigator.serviceWorker.addEventListener('message', onMsg);
      
      // ページフォーカス時にlocalStorageフラグをチェック（Chrome向け）
      const checkFlag = () => {
        try {
          const flag = localStorage.getItem('eyedrop-checker:notif-flag');
          if (flag) {
            const parsed = JSON.parse(flag);
            console.log('[App] Found notif flag:', parsed);
            if (parsed.slot && parsed.date === key) {
              const jp3 = parsed.slot === 'morning' ? '朝' : parsed.slot === 'noon' ? '昼' : '夜';
              console.log('[App] Showing banner from flag:', parsed.slot);
              setBanner({ text: `通知から開きました\n${jp3}の目薬を済にしますか？`, slot: parsed.slot });
              setHighlightSlot(parsed.slot);
              localStorage.removeItem('eyedrop-checker:notif-flag');
            }
          }
        } catch (e) {
          console.error('[App] Error checking flag:', e);
        }
      };
      
      // フォーカス時と初回ロード時にチェック
      checkFlag();
      const onFocus = () => {
        console.log('[App] Window focused, checking flag...');
        setTimeout(checkFlag, 100);
      };
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          console.log('[App] Page visible, checking flag...');
          setTimeout(checkFlag, 100);
        }
      });
      
      return () => {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        window.removeEventListener('focus', onFocus);
      };
    }
  }, [key]);

  // notification-clickedイベントをリッスン（直接Notification APIからの通知クリック）
  useEffect(() => {
    const handleNotificationClick = (e) => {
      console.log('[App] notification-clickedイベント受信:', e.detail);
      const { slot, date, type, message } = e.detail || {};
      
      // カメラ監視からの通知（動きなし）
      if (type === 'camera-no-motion' && date === key) {
        console.log('[App] カメラ監視通知: バナーを表示');
        setBanner({ 
          text: message || `${key}の目薬が使用されていません（5分以上動きが検出されませんでした）`, 
          slot: null 
        });
        return;
      }
      
      // 通常のスロット通知（朝/昼/夜）
      if (slot && date === key) {
        const jp = slot === 'morning' ? '朝' : slot === 'noon' ? '昼' : '夜';
        console.log('[App] バナーを表示:', slot);
        setBanner({ text: `通知から開きました\n${jp}の目薬を済にしますか？`, slot });
        setHighlightSlot(slot);
      }
    };
    
    // フォーカス中で通知が表示されない場合のページ内バナー表示
    const handleInAppNotification = (e) => {
      console.log('[App] show-in-app-notificationイベント受信:', e.detail);
      const { slot, date, title, body } = e.detail || {};
      if (slot && date === key) {
        const jp = slot === 'morning' ? '朝' : slot === 'noon' ? '昼' : '夜';
        console.log('[App] ページ内バナーを表示:', slot);
        setBanner({ text: `${title}\n${body}\n${jp}の目薬を済にしますか？`, slot });
        setHighlightSlot(slot);
      }
    };
    
    // 家族通知のページ内バナー表示（showNotification関数から発火）
    const handleFamilyNotification = (e) => {
      console.log('[App] show-family-notificationイベント受信:', e.detail);
      const { title, body } = e.detail || {};
      if (title && body) {
        console.log('[App] 家族通知のページ内バナーを表示');
        setBanner({ text: `${title}\n${body}`, slot: null });
      }
    };
    
    window.addEventListener('notification-clicked', handleNotificationClick);
    window.addEventListener('show-in-app-notification', handleInAppNotification);
    window.addEventListener('show-family-notification', handleFamilyNotification);
    
    return () => {
      window.removeEventListener('notification-clicked', handleNotificationClick);
      window.removeEventListener('show-in-app-notification', handleInAppNotification);
      window.removeEventListener('show-family-notification', handleFamilyNotification);
    };
  }, [key]);

  const toggle = (slotId) => {
    setData((prev) => ({
      ...prev,
      [key]: { ...((prev[key]) ?? {}), ...day, [slotId]: !day[slotId] }
    }));
  };

  const resetToday = () => {
    setData((prev) => ({ ...prev, [key]: { morning: false, noon: false, night: false, note: '' } }));
  };

  const resetApp = async () => {
    if (!confirm('アプリを完全にリセットしますか？\n\nこれにより、Service Workerのキャッシュとアプリの設定がクリアされます。')) {
      return;
    }
    
    try {
      // Service Workerを登録解除
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.unregister();
          console.log('[App] Service Workerを登録解除しました');
        }
      }
      
      // キャッシュをクリア
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        console.log('[App] キャッシュをクリアしました');
      }
      
      // localStorageをクリア（任意）
      // 注意: データを保持したい場合は、この部分をコメントアウトしてください
      // localStorage.clear();
      
      // 強制リロード（キャッシュを無視）
      window.location.href = window.location.origin + window.location.pathname;
    } catch (err) {
      console.error('[App] リセットエラー:', err);
      alert('リセット中にエラーが発生しました。ページを手動でリロードしてください。');
    }
  };

  const doneCount = SLOTS.filter(s => day[s.id]).length;
  const progress = Math.round((doneCount / SLOTS.length) * 100);

  return (
    <div className="wrap">
      <PWAInstallPrompt />
      <div style={{ display:'flex', justifyContent:'center' }}>
        <AvatarMascot size={100} />
      </div>
      {banner && (
        <div className="banner">
          <div style={{ whiteSpace: 'pre-line' }}>{banner.text}</div>
          {banner.slot ? (
            <button
              className="banner-btn"
              onClick={() => {
                toggle(banner.slot);
                setBanner(null);
                setHighlightSlot(null);
              }}
            >{banner.slot === 'morning' ? '朝' : banner.slot === 'noon' ? '昼' : '夜'}を「済」にする</button>
          ) : (
            <button
              className="banner-btn"
              onClick={() => {
                setBanner(null);
                setHighlightSlot(null);
              }}
              style={{ background: 'linear-gradient(135deg, #64748b 0%, #475569 100%)' }}
            >閉じる</button>
          )}
        </div>
      )}
      
      {updateAvailable && (
        <div className="banner" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', borderColor: '#f59e0b', color: '#92400e' }}>
          <div style={{ whiteSpace: 'pre-line' }}>新しいバージョンが利用可能です</div>
          <button
            className="banner-btn"
            onClick={async () => {
              // より安全な更新方法：SWを無効化してからリロード
              if ('serviceWorker' in navigator) {
                try {
                  const registration = await navigator.serviceWorker.getRegistration();
                  if (registration) {
                    // すべてのSWを登録解除
                    await registration.unregister();
                    // キャッシュをクリア
                    if ('caches' in window) {
                      const cacheNames = await caches.keys();
                      await Promise.all(cacheNames.map(name => caches.delete(name)));
                    }
                  }
                } catch (err) {
                  console.error('SW更新エラー:', err);
                }
              }
              // 強制リロード（キャッシュを無視）
              window.location.href = window.location.href.split('?')[0] + '?reload=' + Date.now();
            }}
            style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
          >アプリを更新</button>
        </div>
      )}
      <h1 className="title">目薬チェック</h1>
      <p className="subtitle">{key} の記録</p>

      <div className="progress">
        <div className="bar" style={{ width: `${progress}%` }} />
        <div className="labels">
          <span>{progress}%</span>
          <button className="link" onClick={resetToday}>今日をリセット</button>
        </div>
      </div>

      <div className="grid">
        {SLOTS.map((slot) => (
          <button
            key={slot.id}
            className={`slot ${day[slot.id] ? 'on' : ''} ${highlightSlot === slot.id ? 'highlight' : ''}`}
            onClick={() => {
              toggle(slot.id);
              if (highlightSlot === slot.id) setHighlightSlot(null);
            }}
          >
            <span className="slot-label">{slot.label}</span>
            <span className="slot-state">{day[slot.id] ? '済' : '未'}</span>
          </button>
        ))}
      </div>

      <div className="note">
        <label>
          メモ
          <textarea
            placeholder="気づいたことをメモ"
            value={day.note ?? ''}
            onChange={(e) => setData((prev) => ({
              ...prev,
              [key]: { ...day, note: e.target.value }
            }))}
          />
        </label>
      </div>

      <details className="history">
        <summary>最近の履歴</summary>
        <ul>
          {Object.entries(data)
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))
            .slice(0, 7)
            .map(([k, v]) => (
              <li key={k}>
                <span className="date">{k}</span>
                <span className="dots">
                  <i className={v.morning ? 'dot on' : 'dot'} title="朝" />
                  <i className={v.noon ? 'dot on' : 'dot'} title="昼" />
                  <i className={v.night ? 'dot on' : 'dot'} title="夜" />
                </span>
              </li>
            ))}
        </ul>
      </details>

      <section className="weekly">
        <h2 className="sec-title">1週間の進捗</h2>
        <ul className="weekly-list">
          {Array.from({ length: 7 }).map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const k = `${yyyy}-${mm}-${dd}`;
            const dayData = data[k] ?? { morning: false, noon: false, night: false };
            const cnt = ['morning','noon','night'].filter(s => dayData[s]).length;
            const pct = Math.round((cnt / 3) * 100);
            return (
              <li key={k} className="weekly-row">
                <span className="w-date">{k}</span>
                <div className="w-bar"><i style={{ width: `${pct}%` }} /></div>
                <span className="w-pct">{pct}%</span>
              </li>
            );
          }).reverse()}
        </ul>
      </section>

      <section className="settings">
        <h2 className="sec-title">通知設定</h2>
        <div className="settings-row">
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={async (e) => {
                const on = e.target.checked;
                if (on && 'Notification' in window) {
                  try { await Notification.requestPermission(); } catch {}
                }
                setSettings((s) => ({ ...s, notifications: on }));
              }}
            />
            <span>通知を有効にする</span>
            {settings.notifications && 'Notification' in window && (
              <span style={{ fontSize: '12px', color: Notification.permission === 'granted' ? '#22c55e' : Notification.permission === 'denied' ? '#ef4444' : '#64748b', marginLeft: '8px' }}>
                {Notification.permission === 'granted' ? '（許可済み）' : Notification.permission === 'denied' ? '（拒否）' : '（未許可）'}
              </span>
            )}
          </label>
          <button
            className="btn"
            onClick={async () => {
              console.log('[App] テスト通知ボタンクリック');
              if (!('Notification' in window)) {
                alert('このブラウザは通知に未対応です。ChromeまたはSafariでホーム画面に追加してください。');
                return;
              }
              
              console.log('[App] Notification.permission:', Notification.permission);
              
              // Service WorkerとPWAチェック
              const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                           (window.navigator.standalone === true) ||
                           document.referrer.includes('android-app://');
              const hasSW = 'serviceWorker' in navigator;
              let swRegistered = false;
              if (hasSW) {
                try {
                  const reg = await navigator.serviceWorker.getRegistration();
                  swRegistered = !!reg;
                  console.log('[App] Service Worker登録:', swRegistered);
                } catch (e) {
                  console.error('[App] SW登録確認エラー:', e);
                }
              }
              
              // PCの場合はService Workerがなくても通知可能（スマホの場合はPWA必須）
              const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
              if (isMobile && !isPWA && !swRegistered) {
                alert('通知を使うには、ホーム画面に追加（PWAインストール）が必要です。\n\n手順:\n1. ブラウザメニューから「ホーム画面に追加」を選択\n2. インストール後、アイコンからアプリを起動\n3. 再度テスト通知を試してください');
                return;
              }
              
              if (Notification.permission !== 'granted') {
                console.log('[App] 通知許可をリクエスト');
                const p = await Notification.requestPermission();
                console.log('[App] 通知許可結果:', p);
                if (p === 'granted') {
                  console.log('[App] 通知許可OK、通知を送信');
                  const result = await showNotification('テスト通知', { body: '目薬チェックのテストです', data: { slot: 'morning', date: key }, tag: `test-${key}` });
                  console.log('[App] 通知送信結果:', result);
                  
                  // 通知が表示されたかチェック（3秒後に確認）
                  let notifiedShown = false;
                  if (result) {
                    result.onshow = () => {
                      notifiedShown = true;
                      console.log('[App] ✅ 通知が表示されました！');
                    };
                    setTimeout(() => {
                      if (!notifiedShown) {
                        console.warn('[App] ⚠️ 通知が表示されていない可能性があります');
                        // フォーカス中の場合はページ内バナーを表示
                        if (document.hasFocus()) {
                          console.log('[App] ページ内バナーを表示します');
                          setBanner({ text: 'テスト通知\n（フォーカス中のため通知が表示されない場合があります）', slot: 'morning' });
                        } else {
                          alert('通知が表示されていない可能性があります。\n\n確認事項:\n1. ブラウザの通知設定を確認してください\n2. システムの通知設定を確認してください\n3. 別のタブやウィンドウを開いて、通知が表示されるか確認してください\n\nChrome: chrome://settings/content/notifications\n\n通知が表示されない場合、ページをリロードして再度試してください。');
                        }
                      }
                    }, 3000);
                  }
                } else if (p === 'denied') {
                  alert('通知が拒否されました。ブラウザの設定から通知を許可してください。\n\nChrome: chrome://settings/content/notifications');
                }
              } else {
                console.log('[App] 通知許可済み、通知を送信');
                const result = await showNotification('テスト通知', { body: '目薬チェックのテストです', data: { slot: 'morning', date: key }, tag: `test-${key}` });
                console.log('[App] 通知送信結果:', result);
                
                // 通知が表示されたかチェック（3秒後に確認）
                let notifiedShown = false;
                if (result) {
                  result.onshow = () => {
                    notifiedShown = true;
                    console.log('[App] ✅ 通知が表示されました！');
                  };
                  setTimeout(() => {
                    if (!notifiedShown) {
                      console.warn('[App] ⚠️ 通知が表示されていない可能性があります');
                      alert('通知が表示されていない可能性があります。\n\n確認事項:\n1. ブラウザの通知設定を確認してください\n2. システムの通知設定を確認してください\n3. 別のタブやウィンドウを開いて、通知が表示されるか確認してください\n\nChrome: chrome://settings/content/notifications\n\n通知が表示されない場合、ページをリロードして再度試してください。');
                    }
                  }, 3000);
                }
              }
            }}
          >テスト通知</button>
          <button
            className="btn"
            onClick={() => {
              setUpdateAvailable(true);
            }}
            style={{ fontSize: '12px', padding: '6px 12px', marginLeft: '8px' }}
          >更新バナーテスト</button>
        </div>
        <div className="time-grid">
          {SLOTS.map(s => (
            <label key={s.id} className="time-item">
              <span>{s.label}の通知時刻</span>
              <input
                type="time"
                value={settings.times[s.id]}
                onChange={(e) => setSettings((prev) => ({
                  ...prev,
                  times: { ...prev.times, [s.id]: e.target.value }
                }))}
              />
            </label>
          ))}
        </div>
        <p className="hint">※ 通知はブラウザの設定に依存します。PWA化で安定化可能。</p>
        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #e5e7eb' }}>
          <button
            className="btn"
            onClick={resetApp}
            style={{ 
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              color: 'white',
              fontSize: '14px',
              padding: '8px 16px'
            }}
          >アプリを完全にリセット</button>
          <p className="hint" style={{ marginTop: '8px', fontSize: '12px' }}>
            Service Workerのキャッシュとアプリの設定をクリアして、初回起動時の状態に戻します<br />
            （通知許可の問題が解決しない場合にお試しください）
          </p>
        </div>
      </section>

      <FamilyNotification />

      <section className="camera-section">
        <CameraMonitor
          onMotionDetected={() => {
            console.log('動きが検出されました');
          }}
          onNoMotion={async () => {
            const message = `${key}の目薬が使用されていません（5分以上動きが検出されませんでした）`;
            // Firestore経由のみで通知を送信（onSnapshotで統一管理）
            // これにより、カメラ側、本人、家族すべてのデバイスで同じ通知が1回だけ送られる
            if (user) {
              await notifyFamily(user.uid, message, user.email);
            }
          }}
        />
      </section>

      <section className="photo-capture-section">
        <PhotoCapture />
      </section>

      <footer className="foot">
        家族みんなで健康に。忘れない工夫を。
        <div style={{ marginTop: '12px' }}>
          <button
            onClick={logout}
            className="btn"
            style={{ fontSize: '14px', padding: '8px 16px' }}
          >
            ログアウト
          </button>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div>読み込み中...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <AppContent />;
}
