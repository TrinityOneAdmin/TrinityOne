// landing-today.jsx — the render block for landing-app-today.html, extracted so it survives strict CSP.
// It renders the REAL Today screen (from app/screens-today) inside a phone frame, so the marketing preview
// can't drift from the actual app. Loaded after react-dom + the app scripts, which set the globals it uses
// (ReactDOM, PhoneFrame, TodayScreen, TabBar). The main strict build transpiles this app/*.jsx → .js.
// this preview reuses the REAL Today screen, which reads a couple of prefs via lsGet/lsSet (defined in the full
// app, which we don't load here). Provide lightweight globals so the standalone preview renders.
window.lsGet = window.lsGet || function (key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
window.lsSet = window.lsSet || function (key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} };

const D = window.LumenData;
// a friendly, signed-in identity so the hero reads as a real, lived-in screen
const ctx = {
  identity: { name: 'Maria', avatar: { kind: 'monogram', color: '#C25A38' } },
  dark: false,
  toggleDark() {}, openProfile() {}, openShare() {}, openReader() {},
  openListen() {}, openPlans() {}, openDevotional() {}, openSearch() {},
  go() {}, toast() {},
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <div className="lumen" style={{ width: 392, height: 846 }}>
    <PhoneFrame>
      <div style={{ position: 'absolute', inset: 0 }}><TodayScreen ctx={ctx} /></div>
      <TabBar active="today" onChange={() => {}} />
    </PhoneFrame>
  </div>
);
