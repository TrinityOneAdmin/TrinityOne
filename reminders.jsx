// reminders.jsx — local "you're serving" reminders for confirmed rota slots.
// On the APK: @capacitor/local-notifications (fires even when the app is closed).
// On the web: the Notifications API (best-effort while a tab is alive). Exposes window.TrinityReminders.
(function () {
  const LS = 'trinityone.reminders.scheduled';   // { notifId: true } already-scheduled
  const cap = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null;
  const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
  const save = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} };
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

  window.TrinityReminders = { sync, ensurePerm };
})();
