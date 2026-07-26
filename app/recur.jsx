// recur.jsx — expand a church's REGULAR MEETINGS into concrete calendar occurrences. A recurring meeting is
// defined ONCE ({ recur:'weekly'|'fortnightly'|'monthly', day:0-6, time, ... anchored at `date` }); the calendar
// shows it as if each occurrence existed, so a church's rhythm (Sunday service, midweek) auto-populates without
// creating hundreds of one-off events. One-off events (no `recur`, a fixed `date`) pass through unchanged.
// Shared by the member app + the steward console (loaded in both shells). Pure — no I/O.
(function () {
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function expandEvents(events, fromISO, days) {
    const out = [];
    const from = new Date((fromISO || iso(new Date())) + 'T00:00:00'); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + (days || 60));
    const inRange = (d) => d >= from && d <= to;
    for (const e of (events || [])) {
      if (!e) continue;
      if (!e.recur) { out.push({ ...e }); continue; }   // one-off — always kept (finite; consumers filter/sort by date)
      const anchor = e.date ? new Date(e.date + 'T00:00:00') : new Date(from);
      const day = (typeof e.day === 'number') ? e.day : anchor.getDay();
      if (e.recur === 'monthly') {                      // once a month, on the first matching weekday of the month
        let m = new Date(from.getFullYear(), from.getMonth(), 1);
        while (m <= to) {
          const occ = new Date(m); while (occ.getDay() !== day) occ.setDate(occ.getDate() + 1);
          if (inRange(occ) && occ >= anchor) out.push({ ...e, date: iso(occ), seriesDate: e.date, recurring: true });
          m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
        }
      } else {                                          // weekly / fortnightly
        const step = e.recur === 'fortnightly' ? 14 : 7;
        let cur = new Date(Math.max(from.getTime(), anchor.getTime())); cur.setHours(0, 0, 0, 0);
        while (cur.getDay() !== day) cur.setDate(cur.getDate() + 1);
        if (step === 14) { const weeks = Math.round((cur - anchor) / (7 * 864e5)); if (weeks % 2 !== 0) cur.setDate(cur.getDate() + 7); }   // stay in phase with the anchor
        for (; cur <= to; cur.setDate(cur.getDate() + step)) if (cur >= anchor) out.push({ ...e, date: iso(cur), seriesDate: e.date, recurring: true });
      }
    }
    return out.sort((a, b) => ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')));
  }

  window.expandEvents = expandEvents;
  window.RECUR_DOW = DOW;
  // THE canonical "what calendar day is it here?" for both shells (this file loads in each).
  // `new Date().toISOString().slice(0,10)` is the UTC day and is WRONG for a calendar date: east of Greenwich
  // it is yesterday for part of every evening, west of it, tomorrow. That shipped real bugs — a care need
  // published dated yesterday (already expired, invisible), and the kids check-in roll emptying mid-service
  // when the UTC day rolled over. Use this for anything a human would call "today"; toISOString is fine only
  // for timestamps and export filenames.
  window.todayISO = () => iso(new Date());
})();
