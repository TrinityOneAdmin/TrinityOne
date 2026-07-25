// stew-console.jsx — shared pieces of the desktop Steward Console.
// Exports to window: ConsoleChrome (the console frame), WizMeetings + _wizMeetingId (the meetings editor used
// by the first-run wizard in stew-dashboard.jsx).
//
// This file used to hold StewWizard, a SECOND setup wizard. It was created 2026-06-08 in the mock-first console
// handoff; a first-run wizard was then added to the dashboard three days later without removing it, and the two
// diverged. On 2026-07-10 the meetings step was moved OUT of the dashboard wizard INTO StewWizard, on the stated
// belief that StewWizard was "the flow a new church actually runs" — the opposite of the truth: it rendered only
// with ?setup=1 and no church key, so every real church finished setup with an empty calendar and nothing said
// so. StewWizard and its steps were deleted 2026-07-25; there is now exactly one setup flow.

// ── console container (real app -- the fake browser chrome only shows in ?showcase mode) ──
function ConsoleChrome({ children, bg = 'var(--paper)', showcase = false, url = 'console.trinityone.app', accentStyle }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: bg, fontFamily: 'var(--font-ui)', ...(accentStyle || {}) }}>
      {showcase ? (
        <div style={{ height: 46, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 999, background: '#E06C5B' }} />
            <span style={{ width: 12, height: 12, borderRadius: 999, background: '#E0B860' }} />
            <span style={{ width: 12, height: 12, borderRadius: 999, background: '#5E8C6A' }} />
          </div>
          <div style={{ flex: 1, maxWidth: 520, margin: '0 auto', height: 28, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
            <Icon name="lock" size={13} color="var(--sage)" />
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 600 }}>{url}</span>
          </div>
          <div style={{ width: 52 }} />
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
    </div>
  );
}

// ════════════════════════════ WIZARD ════════════════════════════
// A collision-proof id for a wizard meeting row: Date.now() alone repeats within one synchronous loop.
function _wizMeetingId() { return 'evt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// editable text field for the wizard (the design-mock SkField is read-only)

// the church's regular meetings → recurring calendar events, so members' calendar auto-populates. Pre-filled
// with sensible defaults; each row is name / day / time / frequency. Published when leaving the step (goNext).
function WizMeetings({ meetings, setMeetings }) {
  const fld = { padding: '11px 12px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
  const set = (i, patch) => setMeetings(a => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 18 }}>Set your weekly rhythm — Sunday service, midweek, and so on. These fill your calendar automatically, so members always see what’s on. You can edit them or add more any time from the Calendar.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {meetings.map((m, i) => (
          <div key={i} style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <input value={m.title} onChange={e => set(i, { title: e.target.value })} placeholder="Meeting name" style={{ ...fld, flex: 1 }} />
              <button onClick={() => setMeetings(a => a.filter((_, j) => j !== i))} title="Remove this meeting" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 10, padding: '9px 10px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="trash" size={16} color="currentColor" /></button>
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <select value={m.day} onChange={e => set(i, { day: +e.target.value })} style={{ ...fld, flex: 1.3, cursor: 'pointer', fontWeight: 600 }}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, di) => <option key={di} value={di}>{d}</option>)}</select>
              <input type="time" value={m.time} onChange={e => set(i, { time: e.target.value })} style={{ ...fld, flex: 1 }} />
              <select value={m.recur} onChange={e => set(i, { recur: e.target.value })} style={{ ...fld, flex: 1.2, cursor: 'pointer', fontWeight: 600 }}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option></select>
            </div>
          </div>
        ))}
        <button onClick={() => setMeetings(a => [...a, { id: _wizMeetingId(), title: '', day: 0, time: '10:00', recur: 'weekly' }])} className="sk-btn sk-btn--ghost" style={{ padding: '11px 15px', fontSize: 14, justifyContent: 'center' }}><Icon name="plus" size={16} color="currentColor" /> Add another meeting</button>
      </div>
    </div>
  );
}







window.ConsoleChrome = ConsoleChrome;
