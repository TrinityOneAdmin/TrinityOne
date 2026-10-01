// recur.jsx — expand a church's REGULAR MEETINGS into concrete calendar occurrences. A recurring meeting is
// defined ONCE ({ recur:'weekly'|'fortnightly'|'monthly', day:0-6, time, ... anchored at `date` }); the calendar
// shows it as if each occurrence existed, so a church's rhythm (Sunday service, midweek) auto-populates without
// creating hundreds of one-off events. One-off events (no `recur`, a fixed `date`) pass through unchanged.
// Shared by the member app + the steward console (loaded in both shells). Pure — no I/O.
(function () {
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // "WHICH WEEK" OF A MONTHLY MEETING. nth 1-5 is the 1st…5th such weekday; nth -1 (NTH_LAST) is the LAST one in
  // the month — the 4th in some months and the 5th in others, which no fixed number can say (owner decision
  // 2026-10-01: a monthly meeting started on the 29th-31st defaults to "last <weekday>", not a 5th that skips
  // most months). -1 is the iCalendar spelling too (RRULE BYDAY=-1FR), so scripts/public-calendar.mjs writes it
  // straight through. AN OLDER APP reads -1 as "not 1-5": its calendar shows the 1st weekday (as for a missing
  // nth), an older CONSOLE labels the meeting "undefined FRI" / "undefined Friday", and re-saving it in an older
  // console's edit dialog turns "Last" into the 1st for good (its publishEvent drops -1 to null). Any other
  // spelling of "last" does the same, so every device must update together (release note).
  // Returns a local Date AT NOON, or null when the month has no such weekday (a 5th that does not exist).
  //
  // NOON, NOT MIDNIGHT, THROUGHOUT THIS FILE. Where a clock change happens AT midnight (Santiago, Beirut, the
  // Azores) that day has no 00:00: `new Date(y, m, d)` and `setDate()` land on 01:00 instead, and a date reached
  // by walking day by day across it stays at 01:00 — past a window end of 00:00 on the same day, so an
  // occurrence falling exactly ON the last day of the window was dropped (re-audit of ffcdcfe, finding 3:
  // start 2026-08-10, 1st Monday, Until 2026-09-07 published nothing in America/Santiago). A clock change
  // moves noon by an hour at most, never onto another day, so every instant here is a calendar day's noon.
  const NTH_LAST = -1;
  function nthWeekdayOfMonth(y, m, day, nth) {
    if (nth === NTH_LAST) {
      const d = new Date(y, m + 1, 0, 12);          // the month's last day
      while (d.getDay() !== day) d.setDate(d.getDate() - 1);
      return d;
    }
    const d = new Date(y, m, 1, 12);
    while (d.getDay() !== day) d.setDate(d.getDate() + 1);
    d.setDate(d.getDate() + 7 * ((nth || 1) - 1));
    return d.getMonth() === m ? d : null;
  }

  function expandEvents(events, fromISO, days) {
    const out = [];
    const from = new Date((fromISO || iso(new Date())) + 'T12:00:00'); from.setHours(12, 0, 0, 0);   // noon — see above
    const to = new Date(from); to.setDate(to.getDate() + (days || 60));
    const inRange = (d) => d >= from && d <= to;
    for (const e of (events || [])) {
      if (!e) continue;
      if (!e.recur) { out.push({ ...e }); continue; }   // one-off — always kept (finite; consumers filter/sort by date)
      const anchor = e.date ? new Date(e.date + 'T12:00:00') : new Date(from);
      const day = (typeof e.day === 'number') ? e.day : anchor.getDay();
      if (e.recur === 'monthly') {
        const nth = (typeof e.nth === 'number' && ((e.nth >= 1 && e.nth <= 5) || e.nth === NTH_LAST)) ? e.nth : 1;
        let m = new Date(from.getFullYear(), from.getMonth(), 1, 12);
        while (m <= to) {
          const occ = nthWeekdayOfMonth(m.getFullYear(), m.getMonth(), day, nth);
          if (occ && inRange(occ) && occ >= anchor) out.push({ ...e, date: iso(occ), seriesDate: e.date, recurring: true });
          m = new Date(m.getFullYear(), m.getMonth() + 1, 1, 12);
        }
      } else {                                          // weekly / fortnightly
        const step = e.recur === 'fortnightly' ? 14 : 7;
        let cur = new Date(Math.max(from.getTime(), anchor.getTime())); cur.setHours(12, 0, 0, 0);
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
