// landing-today.jsx — renders the REAL Today screen for the marketing preview, standalone. The Today screen is
// coupled to the app runtime (localStorage prefs, the Bible engine, and a big ctx of live state + handlers), so
// we provide lightweight stand-ins here rather than boot the whole app — it renders its empty/personal state.
// NOTE: if the Today screen grows a new ctx field or Bible method, add it here or the preview goes blank.

// prefs the screen reads (normally from app.jsx)
window.lsGet = window.lsGet || function (key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
window.lsSet = window.lsSet || function (key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} };

// the Scripture engine (normally engine.js, which would auto-download a Bible — too heavy for a preview). A
// benign shim: not-loaded, so the screen shows its fallback verse text from the sample data.
window.Bible = window.Bible || {
  loaded: false, activeVersion: 'WEB',
  parseRef: () => null, books: () => [], getVerses: () => [],
  bookName: (b) => b, bookAbbr: (b) => b, maxChapter: () => 1,
};

const noop = () => {};
// a friendly, signed-in personal identity so the hero reads as a real, lived-in screen — no church context, so
// the church-specific sections stay empty (a clean personal preview).
const ctx = {
  identity: { name: 'Maria', avatar: { kind: 'monogram', color: '#C25A38' } },
  dark: false, loc: null, church: null, planProgress: {},
  churchDevos: [], churchRosters: [], netAnnouncements: [], netUnread: 0, servPending: [],
  care: null, careFocus: null, safeguard: null, pinnedSermon: null, newJournal: null, servNext: null,
  canDMPeer: () => false,
  toggleDark: noop, go: noop, toast: noop, playSermon: noop,
  openReader: noop, openListen: noop, openSearch: noop, openDM: noop, openPlan: noop,
  openServing: noop, openShareSheet: noop, openChurchDevo: noop, openChurchSwitcher: noop, openNotifications: noop,
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <div className="lumen" style={{ width: 392, height: 846 }}>
    <PhoneFrame>
      <div style={{ position: 'absolute', inset: 0 }}><TodayScreen ctx={ctx} /></div>
      <TabBar active="today" onChange={() => {}} />
    </PhoneFrame>
  </div>
);
