// A BLANK SCREEN IS THE WORST FAILURE THIS PRODUCT HAS, AND UNTIL NOW EVERY ONE OF THEM WAS SILENT.
//
// Neither app had an error boundary. React's rule is that an error thrown during render unmounts the WHOLE
// tree — so any one component throwing left `#root` with zero children: a white screen, no message, no way
// back, and nothing written down. This project's own notes call that class of bug the worst it ships, and it
// has shipped several: a duplicate top-level `const` blanking the APK, a regex cleanup crossing a method
// boundary, a `MEMBER_D` ReferenceError swallowed inside a nostr-tools handler.
//
// Measured on 2026-08-17: the steward console blanked itself twice in five minutes on the RELEASED build,
// with a React `insertBefore` reconciliation error. Roughly thirty attempts failed to reproduce it since, so
// the underlying race is not isolated and this boundary does not claim to fix it. What it does is convert a
// silent, unrecoverable white screen into a message and a Reload button — which is the difference between a
// steward thinking the app is dead and a steward getting back to work in five seconds.
//
// It also KEEPS THE DETAIL. The last crash is stored under `trinityone.lastcrash` so the next session can
// read what actually happened rather than trying to catch it live, which is exactly what cost this session an
// hour. Nothing is sent anywhere: it stays on the device, like everything else here.
//
// Deliberately plain. This renders when the app is already broken, so it uses no Icon, no shared component,
// no context — nothing that could itself be the thing that threw.
class TrinityErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }

  static getDerivedStateFromError(err) { return { err: err || new Error('Something went wrong') }; }

  componentDidCatch(err, info) {
    // Keep it where a human (or the next session) can find it. Bounded, because a crash loop must not fill
    // the member's storage — one record, overwritten.
    try {
      localStorage.setItem('trinityone.lastcrash', JSON.stringify({
        at: new Date().toISOString(),
        message: String((err && err.message) || err || '').slice(0, 400),
        stack: String((err && err.stack) || '').slice(0, 2000),
        components: String((info && info.componentStack) || '').slice(0, 2000),
        where: location.pathname,
      }));
    } catch (e) {}
    try { console.error('[trinityone] render crash', err, info); } catch (e) {}
  }

  render() {
    if (!this.state.err) return this.props.children;
    const wrap = { position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#F7F3EC', color: '#241E17', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', zIndex: 2147483647 };
    const card = { maxWidth: 420, width: '100%', textAlign: 'center' };
    const btn = { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 18, padding: '15px 18px', borderRadius: 14, border: 'none', background: '#C25A38', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
    const quiet = { ...btn, background: 'transparent', color: '#6B6157', fontSize: 14, marginTop: 6 };
    return (
      <div style={wrap} role="alert">
        <div style={card}>
          <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 12 }}>🕯️</div>
          <h1 style={{ fontSize: 21, fontWeight: 700, margin: '0 0 8px' }}>This screen stopped working</h1>
          {/* SAY THE TRUE THING. Nothing has been lost: the member's key, notes and church all live in this
              device's storage, and the church's documents are on the relay — a render crash touches none of
              them. That is the sentence that stops someone panicking and doing something irreversible. */}
          <p style={{ fontSize: 15, lineHeight: 1.55, color: '#4A423A', margin: '0 0 4px' }}>
            Nothing has been lost — your account, your notes and your church are all still on this device.
            Reloading almost always fixes it.
          </p>
          <button style={btn} onClick={() => { try { location.reload(); } catch (e) {} }}>Reload</button>
          <button style={quiet} onClick={() => this.setState({ err: null })}>Try this screen again</button>
          <p style={{ fontSize: 12, color: '#8A8078', lineHeight: 1.5, margin: '16px 0 0' }}>
            If it keeps happening, tell whoever set up your church — the details have been noted on this phone.
          </p>
        </div>
      </div>
    );
  }
}
window.TrinityErrorBoundary = TrinityErrorBoundary;
