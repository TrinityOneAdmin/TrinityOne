// screens-serving.jsx — member "Serving & Events". Driven by real serving requests the church
// p-tags to this member (Fellowship.subscribeMyServingRequests) + my replies + church events.
// Exports ServingScreen. Entry points: Today + Community.
const { useState: useSv, useEffect: useSvE } = React;

const SV_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SV_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function svParts(iso) { try { const d = new Date(iso + 'T00:00'); return { dow: SV_DOW[d.getDay()], day: d.getDate(), mon: SV_MON[d.getMonth()] }; } catch { return { dow: '', day: '', mon: '' }; } }
function svInitials(name) { return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
function svNextSundays(n) { const out = []; const d = new Date(); d.setHours(0, 0, 0, 0); let guard = 0; while (out.length < n && guard < 60) { if (d.getDay() === 0) { const iso = d.toISOString().slice(0, 10); out.push({ iso, ...svParts(iso) }); } d.setDate(d.getDate() + 1); guard++; } return out; }
function svDownloadICS(it) {
  const dt = (it.date || '').replace(/-/g, ''); const [hh, mm] = (it.time || '10:00').split(':');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'SUMMARY:Serving — ' + (it.teamName || '') + ' (' + (it.role || '') + ')', 'DTSTART:' + dt + 'T' + (hh || '10') + (mm || '00') + '00', 'DESCRIPTION:' + (it.service || ''), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  try { const u = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); window.open(u, '_blank'); } catch (e) {}
}

function ServAvatar({ name, size = 34, accent = 'var(--clay)' }) {
  return <div style={{ width: size, height: size, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size * 0.36, background: `linear-gradient(150deg, ${accent}, color-mix(in oklab, ${accent} 62%, #16120c))` }}>{svInitials(name)}</div>;
}
function ServDateBlock({ iso, accent = 'var(--clay)', tint = true }) {
  const p = svParts(iso);
  return (
    <div style={{ width: 52, flexShrink: 0, textAlign: 'center', borderRadius: 13, padding: '7px 0', background: tint ? `color-mix(in oklab, ${accent} 13%, var(--surface))` : 'transparent', border: tint ? `1px solid color-mix(in oklab, ${accent} 26%, transparent)` : 'none' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: accent }}>{p.dow}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, lineHeight: 1, color: 'var(--ink)' }}>{p.day}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase' }}>{p.mon}</div>
    </div>
  );
}
function svPrimary() { return { width: '100%', padding: 16, borderRadius: 15, border: 'none', cursor: 'pointer', background: 'var(--clay)', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }; }
function svGhost() { return { flex: 1, padding: 14, borderRadius: 14, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }; }

// ── respond to a "can you serve?" request ──
function RespondSheet({ open, req, onClose, ctx }) {
  if (!req) return null;
  const acc = req.accent || 'var(--clay)';
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="80%" z={70}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>Can you serve?</div><IconBtn name="x" onClick={onClose} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 15, borderRadius: 18, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 14 }}>
        <ServDateBlock iso={req.date} accent={acc} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: `color-mix(in oklab, ${acc} 15%, var(--surface))`, color: acc, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={req.icon || 'hand'} size={15} /></div>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{req.teamName} · {req.role}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{req.time} · {req.service}</div>
        </div>
      </div>
      {req.note ? <div style={{ display: 'flex', gap: 10, padding: 13, borderRadius: 14, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, transparent)', marginBottom: 18 }}>
        <ServAvatar name={req.from || 'Church'} size={32} accent="var(--gold)" />
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}><b style={{ color: 'var(--ink)' }}>{req.from || 'Your church'}</b> asked: “{req.note}”</div>
      </div> : null}
      <button onClick={() => { ctx.respondServing(req, 'accept'); ctx.toast(`You’re serving ${svParts(req.date).dow} ${svParts(req.date).day}`); onClose(); }} style={svPrimary()}><Icon name="check" size={19} stroke={2.4} color="#fff" /> Yes, I’ll serve</button>
      <div style={{ display: 'flex', gap: 10, marginTop: 11 }}>
        <button onClick={() => { ctx.respondServing(req, 'swap'); ctx.toast('Asked your leader for a swap'); onClose(); }} style={svGhost()}><Icon name="swap" size={17} color="var(--ink)" /> Find a swap</button>
        <button onClick={() => { ctx.respondServing(req, 'decline'); ctx.toast('Declined — your leader has been told'); onClose(); }} style={svGhost()}><Icon name="x" size={17} color="var(--ink)" /> Can’t this time</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center', marginTop: 16, color: 'var(--ink-3)', fontSize: 12 }}><Icon name="shield" size={14} color="var(--ink-3)" /> Only your team leader sees your reply</div>
    </BottomSheet>
  );
}

// ── manage a confirmed serving slot ──
function ManageSheet({ open, item, onClose, ctx }) {
  if (!item) return null;
  const rows = [
    { ic: 'calPlus', t: 'Add to my calendar', s: 'Download an event for your phone', go: () => { svDownloadICS(item); ctx.toast('Added — you’ll be reminded the day before'); onClose(); } },
    { ic: 'swap', t: 'Ask for a swap', s: 'Tell your leader you need cover', go: () => { ctx.respondServing(item, 'swap'); ctx.toast('Asked your leader for a swap'); onClose(); } },
    { ic: 'calendar', t: 'I’m away — take me off', s: 'Let your leader know you can’t make it', go: () => { ctx.respondServing(item, 'decline'); ctx.toast('Taken off — thanks for letting us know'); onClose(); } },
  ];
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="68%" z={70}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '4px 2px 16px' }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: `color-mix(in oklab, ${item.accent || 'var(--clay)'} 15%, var(--surface))`, color: item.accent || 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={item.icon || 'hand'} size={23} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{item.teamName} · {item.role}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{svParts(item.date).dow} {svParts(item.date).day} {svParts(item.date).mon} · {item.time}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {rows.map(r => (
          <button key={r.t} onClick={r.go} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 15, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--line)', background: 'var(--surface)', boxShadow: 'var(--shadow)', fontFamily: 'var(--font-ui)' }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface-2)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={r.ic} size={19} /></div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.t}</div><div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{r.s}</div></div>
            <Icon name="chevR" size={17} color="var(--ink-3)" />
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

// ── set unavailable Sundays ──
function UnavailSheet({ open, onClose, ctx }) {
  const [sel, setSel] = useSv([]);
  useSvE(() => { if (open) setSel([]); }, [open]);
  const sundays = svNextSundays(6);
  const toggle = (iso) => setSel(s => s.includes(iso) ? s.filter(x => x !== iso) : [...s, iso]);
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="84%" z={70}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>When are you away?</div><IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', margin: '0 0 16px', lineHeight: 1.5 }}>Tap the Sundays you can’t serve. Your leader won’t put you on the rota for these — no need to explain.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
        {sundays.map(d => {
          const on = sel.includes(d.iso);
          return (
            <button key={d.iso} onClick={() => toggle(d.iso)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 12, borderRadius: 14, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', border: on ? '2px solid var(--clay)' : '1px solid var(--line)', background: on ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface)', boxShadow: 'var(--shadow)' }}>
              <ServDateBlock iso={d.iso} accent={on ? 'var(--clay)' : 'var(--ink-3)'} tint={false} />
              <div style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{d.dow} {d.day} {d.mon}</div>
              <div style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--clay)' : 'transparent', border: on ? 'none' : '2px solid var(--line)' }}>{on ? <Icon name="check" size={16} stroke={2.8} color="#fff" /> : null}</div>
            </button>
          );
        })}
      </div>
      <button onClick={() => { ctx.setUnavailableDates(sel); ctx.toast(`Marked ${sel.length} ${sel.length === 1 ? 'Sunday' : 'Sundays'} away`); onClose(); }} disabled={!sel.length} style={{ ...svPrimary(), background: sel.length ? 'var(--clay)' : 'var(--line)' }}>
        <Icon name="calCheck" size={18} color="#fff" /> {sel.length ? `Mark ${sel.length} away` : 'Choose dates'}</button>
    </BottomSheet>
  );
}

// ════════════════════════ MAIN OVERLAY ════════════════════════
function ServingScreen({ open, onClose, ctx }) {
  const [tab, setTab] = useSv('serving');
  const [sheet, setSheet] = useSv(null);   // { kind, item }
  useSvE(() => { if (open) { setTab('serving'); setSheet(null); } }, [open]);
  const pending = ctx.servPending || [];
  const upcoming = ctx.servConfirmed || [];
  const next = ctx.servNext;
  const events = ctx.churchEvents || [];
  const rsvps = ctx.myRsvps || {};
  const close = () => setSheet(null);

  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, background: 'color-mix(in oklab, var(--surface) 92%, transparent)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px 12px' }}>
          <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="chevL" size={22} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, lineHeight: 1.05 }}>Serving</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{ctx.church ? ctx.church.name : 'Your church'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '0 14px 12px' }}>
          {[['serving', 'My serving', 'hand'], ['events', 'Events', 'calendar']].map(([k, lbl, ic]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 10, borderRadius: 12, border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, background: on ? 'var(--clay)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>
                <Icon name={ic} size={17} color={on ? '#fff' : 'var(--ink-3)'} /> {lbl}{k === 'serving' && pending.length ? <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: on ? 'rgba(255,255,255,.25)' : 'var(--clay)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{pending.length}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 28px' }}>
        {tab === 'serving' ? (
          <React.Fragment>
            {pending.map(req => (
              <div key={req.id} style={{ borderRadius: 20, padding: 16, marginBottom: 16, background: 'var(--surface)', border: '1.5px solid color-mix(in oklab, var(--gold) 50%, var(--line))', boxShadow: 'var(--shadow)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 800, letterSpacing: '.6px', color: '#8a6717', marginBottom: 12 }}><Icon name="sparkle" size={14} color="var(--gold)" /> CAN YOU SERVE?</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 13 }}>
                  <ServDateBlock iso={req.date} accent={req.accent || 'var(--clay)'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name={req.icon || 'hand'} size={17} color={req.accent || 'var(--clay)'} /><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{req.teamName} · {req.role}</span></div>
                    <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>{req.time} · {req.service}</div>
                  </div>
                </div>
                <button onClick={() => setSheet({ kind: 'respond', item: req })} style={{ ...svPrimary(), padding: 14, fontSize: 15 }}>Respond</button>
              </div>
            ))}

            {next ? (
              <div style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', marginBottom: 22, color: '#fff', background: 'linear-gradient(155deg, #6BA17C, #3C6E57)', boxShadow: 'var(--shadow-lg)' }}>
                <div style={{ position: 'absolute', right: -28, bottom: -34, opacity: .16 }}><Icon name={next.icon || 'hand'} size={180} stroke={1.3} color="#fff" /></div>
                <div style={{ position: 'relative', padding: '18px 20px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', opacity: .92 }}><Icon name="calCheck" size={15} color="#fff" /> You’re next serving</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, margin: '14px 0 4px' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 40, lineHeight: .9, letterSpacing: '-1px' }}>{svParts(next.date).dow} {svParts(next.date).day}</div>
                    <div style={{ paddingBottom: 4 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{svParts(next.date).mon} · {next.time}</div><div style={{ fontSize: 12.5, opacity: .9 }}>{next.service}</div></div>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.18)', backdropFilter: 'blur(4px)', padding: '7px 13px', borderRadius: 999, fontSize: 13.5, fontWeight: 700, marginTop: 8 }}><Icon name={next.icon || 'hand'} size={16} color="#fff" /> {next.teamName} · {next.role}</div>
                  <button onClick={() => { svDownloadICS(next); ctx.toast('Added — you’ll be reminded the day before'); }} style={{ width: '100%', marginTop: 16, padding: 13, borderRadius: 14, border: 'none', cursor: 'pointer', background: '#fff', color: '#3C6E57', fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name="calPlus" size={18} color="#3C6E57" /> Add to my calendar</button>
                </div>
              </div>
            ) : (pending.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--ink-3)' }}>
                <div style={{ width: 54, height: 54, borderRadius: 16, background: 'color-mix(in oklab, var(--sage) 14%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}><Icon name="hand" size={26} /></div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink)', marginBottom: 5 }}>You’re not on the rota yet</div>
                <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 260, margin: '0 auto' }}>When your church puts you on to serve, it’ll show up here — and we’ll remind you the day before.</p>
              </div>
            ) : null)}

            {upcoming.length > (next ? 1 : 0) ? <SectionLabel>Your upcoming</SectionLabel> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
              {upcoming.filter(it => !next || it.id !== next.id).map(it => (
                <button key={it.id} onClick={() => setSheet({ kind: 'manage', item: it })} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 13, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                  <ServDateBlock iso={it.date} accent={it.accent || 'var(--clay)'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name={it.icon || 'hand'} size={16} color={it.accent || 'var(--clay)'} /><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{it.teamName}</span></div>
                    <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>{it.role} · {it.time}</div>
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#345c41', background: 'var(--sage-soft)', borderRadius: 999, padding: '4px 10px' }}>Confirmed</span>
                </button>
              ))}
            </div>

            <button onClick={() => setSheet({ kind: 'unavail' })} style={{ width: '100%', padding: '15px 12px', borderRadius: 16, border: '1px solid var(--line)', background: 'var(--surface)', boxShadow: 'var(--shadow)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, fontFamily: 'var(--font-ui)' }}>
              <Icon name="calendar" size={20} color="var(--clay)" /><span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Set when I’m unavailable</span></button>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <SectionLabel>What’s on</SectionLabel>
            {events.length === 0 ? <div style={{ fontSize: 14, color: 'var(--ink-3)', padding: '8px 2px', lineHeight: 1.5 }}>No events yet — your church will post gatherings and socials here.</div> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {events.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => (
                <div key={e.id} style={{ borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: 13, padding: 16 }}>
                    <ServDateBlock iso={e.date} accent={e.accent || 'var(--clay)'} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, lineHeight: 1.1 }}>{e.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600, marginTop: 3 }}><Icon name="clock" size={13} color="var(--ink-3)" /> {e.time}{e.where ? <React.Fragment><span style={{ opacity: .5 }}>·</span><Icon name="pin" size={13} color="var(--ink-3)" /> {e.where}</React.Fragment> : null}</div>
                      {e.blurb ? <p style={{ fontFamily: 'var(--font-read)', fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink-2)', margin: '9px 0 0', textWrap: 'pretty' }}>{e.blurb}</p> : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 14px' }}>
                    <div style={{ flex: 1 }} />
                    {[['going', 'Going'], ['maybe', 'Maybe'], ['no', 'Can’t']].map(([v, lbl]) => {
                      const on = rsvps[e.id] === v; const c = v === 'going' ? 'var(--sage)' : v === 'maybe' ? 'var(--gold)' : 'var(--ink-3)';
                      return <button key={v} onClick={() => ctx.setRsvp(e.id, v)} style={{ padding: '8px 13px', borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, border: on ? 'none' : '1px solid var(--line)', background: on ? c : 'var(--surface)', color: on ? (v === 'maybe' ? 'var(--midnight)' : '#fff') : 'var(--ink-2)' }}>{lbl}</button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </React.Fragment>
        )}
      </div>

      <RespondSheet open={sheet && sheet.kind === 'respond'} req={sheet && sheet.kind === 'respond' ? sheet.item : null} onClose={close} ctx={ctx} />
      <ManageSheet open={sheet && sheet.kind === 'manage'} item={sheet && sheet.kind === 'manage' ? sheet.item : null} onClose={close} ctx={ctx} />
      <UnavailSheet open={sheet && sheet.kind === 'unavail'} onClose={close} ctx={ctx} />
    </Overlay>
  );
}
Object.assign(window, { ServingScreen });
