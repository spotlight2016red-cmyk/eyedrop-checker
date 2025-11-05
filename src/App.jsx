import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { startScheduler, requestPermission, showNotification } from './utils/notificationHelper.js'
import { AvatarMascot } from './components/AvatarMascot.jsx'

const STORAGE_KEY = 'eyedrop-checker:v1';

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

function App() {
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('eyedrop-checker:settings');
      return raw ? JSON.parse(raw) : { notifications: false, times: { morning: '08:00', noon: '12:00', night: '20:00' } };
    } catch {
      return { notifications: false, times: { morning: '08:00', noon: '12:00', night: '20:00' } };
    }
  });
  const [banner, setBanner] = useState(null); // { text, slot }

  const key = useMemo(() => todayKey(), []);
  const day = data[key] ?? { morning: false, noon: false, night: false, note: '' };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    localStorage.setItem('eyedrop-checker:settings', JSON.stringify(settings));
  }, [settings]);

  // start local scheduler
  useEffect(() => {
    requestPermission();
    const stop = startScheduler(() => data, () => settings);
    return () => stop && stop();
  }, [data, settings]);

  // handle deep-link from notification: /?slot=...&date=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slot = params.get('slot');
    const date = params.get('date');
    if (slot && date) {
      const jp = slot === 'morning' ? '朝' : slot === 'noon' ? '昼' : '夜';
      setBanner({ text: `通知から開きました（${jp}）`, slot });
      // 1回だけにするためURLをクリーンアップ
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url);
    }

    // SWからのpostMessage（フォーカスのみでナビゲートしないケースのバックアップ表示）
    if ('serviceWorker' in navigator) {
      const onMsg = (e) => {
        const data = e.data || {};
        if (data.type === 'from-notification' && data.slot) {
          const jp2 = data.slot === 'morning' ? '朝' : data.slot === 'noon' ? '昼' : '夜';
          setBanner({ text: `通知から開きました（${jp2}）`, slot: data.slot });
        }
        // localStorageフラグを立てる指示
        if (data.type === 'set-notif-flag' && data.slot && data.date) {
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
            if (parsed.slot && parsed.date === key) {
              const jp3 = parsed.slot === 'morning' ? '朝' : parsed.slot === 'noon' ? '昼' : '夜';
              setBanner({ text: `通知から開きました（${jp3}）`, slot: parsed.slot });
              localStorage.removeItem('eyedrop-checker:notif-flag');
            }
          }
        } catch {}
      };
      
      // フォーカス時と初回ロード時にチェック
      checkFlag();
      const onFocus = () => setTimeout(checkFlag, 100);
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(checkFlag, 100);
      });
      
      return () => {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        window.removeEventListener('focus', onFocus);
      };
    }
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

  const doneCount = SLOTS.filter(s => day[s.id]).length;
  const progress = Math.round((doneCount / SLOTS.length) * 100);

  return (
    <div className="wrap">
      <div style={{ display:'flex', justifyContent:'center' }}>
        <AvatarMascot size={100} />
      </div>
      {banner && (
        <div className="banner">
          {banner.text}
          {banner.slot && (
            <button
              className="btn"
              style={{ marginLeft: 8 }}
              onClick={() => {
                toggle(banner.slot);
                setBanner(null);
              }}
            >{banner.slot === 'morning' ? '朝' : banner.slot === 'noon' ? '昼' : '夜'}を「済」にする</button>
          )}
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
            className={`slot ${day[slot.id] ? 'on' : ''}`}
            onClick={() => toggle(slot.id)}
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
          </label>
          <button
            className="btn"
            onClick={() => {
              if (!('Notification' in window)) return alert('このブラウザは通知に未対応です');
              if (Notification.permission !== 'granted') {
                Notification.requestPermission().then((p) => {
                  if (p === 'granted') showNotification('テスト通知', { body: '目薬チェックのテストです', data: { slot: 'morning', date: key }, tag: `test-${key}` });
                });
              } else {
                showNotification('テスト通知', { body: '目薬チェックのテストです', data: { slot: 'morning', date: key }, tag: `test-${key}` });
              }
            }}
          >テスト通知</button>
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
      </section>

      <footer className="foot">家族みんなで健康に。忘れない工夫を。</footer>
    </div>
  )
}

export default App
