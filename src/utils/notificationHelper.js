export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

export async function showNotification(title, options = {}) {
  console.log('[NotifHelper] Showing notification:', title, options);
  
  // PCかスマホかを判定
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                (window.navigator.standalone === true) ||
                document.referrer.includes('android-app://');
  
  // スマホPWAの場合はService Worker経由、それ以外は直接Notification APIを使用
  const useSW = isMobile && isPWA;
  
  try {
    if (useSW && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        console.log('[NotifHelper] Using SW to show notification (mobile PWA)');
        try {
          await reg.showNotification(title, options);
          console.log('[NotifHelper] SW通知送信完了');
          return;
        } catch (swError) {
          console.error('[NotifHelper] SW通知エラー、直接APIにフォールバック:', swError);
          // SW経由が失敗した場合、直接APIにフォールバック
        }
      }
    }
    
    // PCまたはSWがない場合、直接Notification APIを使用
    if ('Notification' in window && Notification.permission === 'granted') {
      console.log('[NotifHelper] Using Notification API directly');
      
      // Chromeではフォーカス中のページでは通知が表示されないことがあるため、警告を追加
      const isPageFocused = document.hasFocus();
      if (isPageFocused) {
        console.warn('[NotifHelper] ⚠️ ページがフォーカス中です。Chromeではフォーカス中のページでは通知が表示されない場合があります。');
        console.log('[NotifHelper] ヒント: 別のタブを開くか、ウィンドウを最小化してから通知を確認してください。');
      }
      
      const result = new Notification(title, options);
      console.log('[NotifHelper] 直接通知送信完了:', result);
      
      // 通知が実際に表示されたか確認（5秒後にチェック）
      let notificationShown = false;
      
      // 通知の表示イベントを監視
      result.onshow = () => {
        notificationShown = true;
        console.log('[NotifHelper] ✅ 通知が表示されました:', title);
      };
      
      result.onerror = (e) => {
        console.error('[NotifHelper] ❌ 通知エラー:', e);
        alert('通知の表示に失敗しました。ブラウザの通知設定を確認してください。\n\nChrome: chrome://settings/content/notifications');
      };
      
      result.onclose = () => {
        console.log('[NotifHelper] 通知が閉じられました');
      };
      
      setTimeout(() => {
        if (!notificationShown && isPageFocused) {
          console.warn('[NotifHelper] ⚠️ 通知が表示されていない可能性があります。');
          console.log('[NotifHelper] 原因: Chromeではフォーカス中のページでは通知が表示されないことがあります。');
          console.log('[NotifHelper] 解決方法:');
          console.log('[NotifHelper] 1. 別のタブを開いて、そのタブで通知を試してください');
          console.log('[NotifHelper] 2. ウィンドウを最小化してから通知を試してください');
          console.log('[NotifHelper] 3. 通知センター（macOS右上、Windows右下）を確認してください');
          
          // フォーカス中で通知が表示されない場合、ページ内バナーを表示するイベントを発火
          if (options.data) {
            if (options.data.slot) {
              // 通常の通知（slotあり）
              console.log('[NotifHelper] ページ内バナー表示イベントを発火');
              window.dispatchEvent(new CustomEvent('show-in-app-notification', {
                detail: {
                  title,
                  body: options.body || '',
                  slot: options.data.slot,
                  date: options.data.date
                }
              }));
            } else if (options.data.type === 'family-notification') {
              // 家族通知（slotなし）
              console.log('[NotifHelper] 家族通知のページ内バナー表示イベントを発火');
              window.dispatchEvent(new CustomEvent('show-family-notification', {
                detail: {
                  title,
                  body: options.body || ''
                }
              }));
            }
          }
        }
      }, 5000);
      
      // 通知クリック時の処理（直接APIの場合）
      if (options.data) {
        result.onclick = (e) => {
          console.log('[NotifHelper] 通知クリック:', options.data);
          e.preventDefault();
          result.close();
          
          // ウィンドウをフォーカス
          window.focus();
          
          // localStorageにフラグを設定してバナーを表示
          if (options.data.slot && options.data.date) {
            try {
              const flagData = { slot: options.data.slot, date: options.data.date };
              localStorage.setItem('eyedrop-checker:notif-flag', JSON.stringify(flagData));
              console.log('[NotifHelper] localStorageフラグを設定:', flagData);
              
              // イベントを発火してApp.jsxに通知
              window.dispatchEvent(new CustomEvent('notification-clicked', { detail: flagData }));
              
              // URLパラメータも設定（バックアップ）
              const url = new URL(window.location.href);
              url.searchParams.set('slot', options.data.slot);
              url.searchParams.set('date', options.data.date);
              window.history.replaceState({}, '', url);
              
              // 少し待ってからリロードしてバナーを表示
              setTimeout(() => {
                window.location.reload();
              }, 100);
            } catch (err) {
              console.error('[NotifHelper] フラグ設定エラー:', err);
              // エラー時はURLパラメータのみ
              const url = new URL(window.location.href);
              url.searchParams.set('slot', options.data.slot);
              url.searchParams.set('date', options.data.date);
              window.location.href = url.toString();
            }
          }
        };
      }
      
      return result;
    } else {
      console.warn('[NotifHelper] 通知が送れません。許可状態:', Notification.permission);
      alert(`通知が送れません。許可状態: ${Notification.permission}\n\nブラウザの設定から通知を許可してください。`);
    }
  } catch (e) {
    console.error('[NotifHelper] Error showing notification:', e);
    // エラー時も直接Notification APIを試す
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        return new Notification(title, options);
      } catch (e2) {
        console.error('[NotifHelper] 直接通知もエラー:', e2);
      }
    }
  }
}

function parseTimeToToday(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startScheduler(getData, getSettings) {
  // runs every minute; triggers at configured times, once per slot per day
  let timer = null;
  const SLOT_KEYS = ['morning','noon','night'];

  const tick = async () => {
    const settings = getSettings();
    if (!settings?.notifications) return;
    const now = new Date();
    const data = getData();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const day = data[todayKey] ?? { morning:false, noon:false, night:false };

    // last notified state
    const ln = settings.lastNotified ?? {}; // { morning: 'YYYY-MM-DD', ... }

    for (const slot of SLOT_KEYS) {
      const t = settings.times?.[slot];
      if (!t) continue;
      const target = parseTimeToToday(t);
      const diffMs = now - target; // >=0 means passed
      const alreadyNotifiedToday = ln[slot] === todayKey;
      const alreadyDone = !!day[slot];

      // window: trigger within 0..59,000 ms (same minute)
      if (diffMs >= 0 && diffMs < 60000 && !alreadyNotifiedToday && !alreadyDone) {
        const notificationOptions = {
          body: `${slot === 'morning' ? '朝' : slot === 'noon' ? '昼' : '夜'}の目薬を忘れずに。` ,
          tag: `eyedrop-${slot}-${todayKey}`,
          renotify: true,
          silent: false,
          badge: '/vite.svg',
          icon: '/vite.svg',
          data: { slot, date: todayKey }
        };
        
        const result = await showNotification('目薬の時間です', notificationOptions);
        
        // フォーカス中の場合は即座にページ内バナーも表示
        if (document.hasFocus() && result) {
          let notificationShown = false;
          result.onshow = () => {
            notificationShown = true;
          };
          
          // 1秒後に通知が表示されていない場合はページ内バナーを表示
          setTimeout(() => {
            if (!notificationShown) {
              console.log('[Scheduler] フォーカス中のためページ内バナーを表示:', slot);
              window.dispatchEvent(new CustomEvent('show-in-app-notification', {
                detail: {
                  title: '目薬の時間です',
                  body: notificationOptions.body,
                  slot,
                  date: todayKey
                }
              }));
            }
          }, 1000);
        }
        
        // store last notified via localStorage (settings saver should pick up)
        try {
          const newSettings = { ...settings, lastNotified: { ...(settings.lastNotified ?? {}), [slot]: todayKey } };
          localStorage.setItem('eyedrop-checker:settings', JSON.stringify(newSettings));
        } catch {}
      }
    }
  };

  // immediate alignment to minute
  const now = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    tick();
    timer = setInterval(tick, 60000);
  }, Math.max(0, msToNextMinute));

  return () => { if (timer) clearInterval(timer); };
}


