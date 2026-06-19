// reminders.jsx — local "you're serving" reminders for confirmed rota slots.
// On the APK: @capacitor/local-notifications (fires even when the app is closed).
// On the web: the Notifications API (best-effort while a tab is alive). Exposes window.TrinityReminders.
(function () {
  const LS = 'trinityone.reminders.scheduled';   // { notifId: true } already-scheduled
  const cap = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null;
  const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
  const save = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} };

  // ── notification preferences (which kinds the member wants) — read by the settings UI, the reminder
  // scheduler, and the push registration (categories are forwarded to the relay so it filters there). ──
  const NPREFS = 'trinityone.notif';
  const NDEFAULTS = { enabled: true, dm: true, announce: true, serving: true, reminders: true };
  function getPrefs() { try { return { ...NDEFAULTS, ...(JSON.parse(localStorage.getItem(NPREFS) || '{}')) }; } catch { return { ...NDEFAULTS }; } }
  function savePrefs(p) { try { localStorage.setItem(NPREFS, JSON.stringify(p)); } catch {} }
  function hashId(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return (h % 2000000000) + 1; }
  // 18:00 the day before the slot (local time)
  function remindAt(dateStr) { try { const d = new Date(dateStr + 'T00:00'); d.setDate(d.getDate() - 1); d.setHours(18, 0, 0, 0); return d; } catch { return null; } }

  let perm = false;
  async function ensurePerm() {
    const LN = cap();
    if (LN) { try { const r = await LN.requestPermissions(); perm = r.display === 'granted'; } catch { perm = false; } return perm; }
    if (typeof Notification !== 'undefined') { try { perm = (await Notification.requestPermission()) === 'granted'; } catch { perm = false; } }
    return perm;
  }

  const webTimers = {};
  async function sync(slots) {
    const prefs = getPrefs();
    if (!prefs.enabled || !prefs.reminders) return;   // member turned serving reminders off
    slots = (slots || []).filter(s => s && s.date);
    if (!slots.length) return;
    const LN = cap();
    const done = load();
    const now = Date.now();
    if (!perm) { const ok = await ensurePerm(); if (!ok) return; }

    if (LN) {
      const toSchedule = [];
      slots.forEach(s => {
        const at = remindAt(s.date); if (!at || at.getTime() <= now) return;
        const id = hashId(s.id || (s.date + s.role)); if (done[id]) return;
        toSchedule.push({ id, title: 'You’re serving tomorrow', body: `${s.teamName || 'Serving'} · ${s.role || ''}${s.time ? ' at ' + s.time : ''}`, schedule: { at }, smallIcon: 'ic_stat_icon' });
        done[id] = true;
      });
      if (toSchedule.length) { try { await LN.schedule({ notifications: toSchedule }); save(done); } catch (e) { /* leave unsaved so we retry */ } }
      return;
    }

    // web fallback: schedule a timer while this tab is alive (covers near-term reminders)
    slots.forEach(s => {
      const at = remindAt(s.date); if (!at) return;
      const id = hashId(s.id || (s.date + s.role)); const ms = at.getTime() - now;
      if (ms <= 0 || ms > 1000 * 60 * 60 * 24 * 20) return;     // setTimeout caps ~24.8 days
      if (webTimers[id]) return;
      webTimers[id] = setTimeout(() => { try { new Notification('You’re serving tomorrow', { body: `${s.teamName || 'Serving'} · ${s.role || ''}${s.time ? ' at ' + s.time : ''}` }); } catch (e) {} }, ms);
    });
  }

  // ---- web push registration (PWA only; Capacitor uses local notifications) ----
  function b64ToU8(base64) {
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const s = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(s); const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  let pushDone = '', lastPubkey = '';
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // drop this device's push subscription (master toggle off): tell the relay, then unsubscribe locally
  async function unsubscribePush() {
    pushDone = '';
    if (isNative() || !('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      const auth = (window.Fellowship && window.Fellowship.signAuth) ? await window.Fellowship.signAuth(sub.endpoint) : null;
      try { await fetch('/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint, auth }) }); } catch {}
      try { await sub.unsubscribe(); } catch {}
    } catch (e) { /* best-effort */ }
  }
  // subscribe (or refresh) this device's push, forwarding the member's category prefs to the relay.
  // force=true re-sends even if already registered (used when prefs change). Native uses local notifs.
  async function registerPush(pubkey, force) {
    if (pubkey) lastPubkey = pubkey;
    pubkey = pubkey || lastPubkey;
    if (!pubkey) return;
    if (isNative()) return;                                          // native: local notifs, no web-push
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const prefs = getPrefs();
    if (!prefs.enabled) { await unsubscribePush(); return; }         // master toggle off → no push
    if (pushDone === pubkey && !force) return;
    try {
      if (Notification.permission !== 'granted') { const ok = await ensurePerm(); if (!ok) return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const vapid = await fetch('/push/vapid').then(r => r.json()).catch(() => null);
        if (!vapid || !vapid.publicKey) return;
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(vapid.publicKey) });
      }
      // prove control of the key (NIP-98), bound to this endpoint, so the relay won't accept a
      // subscription registered under someone else's pubkey
      const auth = (window.Fellowship && window.Fellowship.signAuth) ? await window.Fellowship.signAuth(sub.endpoint) : null;
      const cats = { dm: !!prefs.dm, announce: !!prefs.announce, serving: !!prefs.serving };
      await fetch('/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub, auth, prefs: cats }) });
      pushDone = pubkey;
    } catch (e) { /* push not available — local reminders still work */ }
  }

  window.TrinityReminders = { sync, ensurePerm, registerPush };
  // settings hook: read/update prefs; a change re-syncs the push subscription with the relay
  window.TrinityNotif = {
    get: getPrefs,
    permission: () => (typeof Notification !== 'undefined' ? Notification.permission : 'default'),
    ensurePerm,
    isNative,
    async set(patch) {
      const p = { ...getPrefs(), ...patch };
      savePrefs(p);
      try { await registerPush(null, true); } catch {}
      return p;
    },
  };
})();
