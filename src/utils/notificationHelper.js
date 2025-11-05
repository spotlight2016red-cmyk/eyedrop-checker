export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

export async function showNotification(title, options = {}) {
  console.log('[NotifHelper] Showing notification:', title, options);
  try {
    // Service Worker経由を試す
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        console.log('[NotifHelper] Using SW to show notification');
        const result = await reg.showNotification(title, options);
        console.log('[NotifHelper] SW通知送信結果:', result);
        return result;
      }
    }
    // SWがない場合、直接Notification APIを使用
    if ('Notification' in window && Notification.permission === 'granted') {
      console.log('[NotifHelper] Using Notification API directly');
      const result = new Notification(title, options);
      console.log('[NotifHelper] 直接通知送信結果:', result);
      return result;
    } else {
      console.warn('[NotifHelper] 通知が送れません。許可状態:', Notification.permission);
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
        await showNotification('目薬の時間です', {
          body: `${slot === 'morning' ? '朝' : slot === 'noon' ? '昼' : '夜'}の目薬を忘れずに。` ,
          tag: `eyedrop-${slot}-${todayKey}`,
          renotify: true,
          silent: false,
          badge: '/vite.svg',
          icon: '/vite.svg',
          data: { slot, date: todayKey }
        });
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


