// screens-serving.jsx — member "Serving & Events". Driven by real serving requests the church
// p-tags to this member (Fellowship.subscribeMyServingRequests) + my replies + church events +
// the church's published rota/rosters/services (so I can see who else is on the team that day,
// ask a specific teammate to swap, and view a month of services + events). Exports ServingScreen.
// Entry points: Today + Community.
const { useState: useSv, useEffect: useSvE } = React;

const SV_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SV_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function svParts(iso) { try { const d = new Date(iso + 'T00:00'); return { dow: SV_DOW[d.getDay()], day: d.getDate(), mon: SV_MON[d.getMonth()] }; } catch { return { dow: '', day: '', mon: '' }; } }
function svInitials(name) { return (name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
function svIsoLocal(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function svTodayIso() { return svIsoLocal(new Date()); }
// next n Sundays as LOCAL dates (toISOString shifts to UTC and can land on Saturday in +TZ zones)
function svNextSundays(n) { const out = []; const d = new Date(); d.setHours(0, 0, 0, 0); let guard = 0; while (out.length < n && guard < 60) { if (d.getDay() === 0) { const iso = svIsoLocal(d); out.push({ iso, ...svParts(iso) }); } d.setDate(d.getDate() + 1); guard++; } return out; }
function svDownloadICS(it) {
  const dt = (it.date || '').replace(/-/g, ''); const [hh, mm] = (it.time || '10:00').split(':');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'SUMMARY:Serving — ' + (it.teamName || '') + ' (' + (it.role || '') + ')', 'DTSTART:' + dt + 'T' + (hh || '10') + (mm || '00') + '00', 'DESCRIPTION:' + (it.service || ''), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  try { const u = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); window.open(u, '_blank'); } catch (e) {}
}

// ── who else is on a service (from the church's published rota + rosters); marks "me" ──
function svServiceRoster(ctx, serviceId) {
  const rota = (ctx.churchRotas || []).find(r => r.service === serviceId);
  if (!rota || !rota.assign) return [];
  const rosters = ctx.churchRosters || []; const me = ctx.myPubkey;
  return Object.entries(rota.assign).map(([key, who]) => {
    if (!who || !who.name) return null;
    const [teamId, roleId] = key.split('::');
    const roster = rosters.find(r => r.team === teamId);
    const role = roster && (roster.roles || []).find(ro => ro.id === roleId);
    return { name: who.name, pub: who.pub, role: role ? role.name : '', me: !!(me && who.pub === me) };
  }).filter(Boolean);
}
// teammates I could ask to swap (the team's roster people, minus me)
function svTeamMates(ctx, teamId) {
  const roster = (ctx.churchRosters || []).find(r => r.team === teamId);
  const me = ctx.myPubkey;
  return ((roster && roster.people) || []).filter(p => p && p.name && (!me || p.pub !== me));
}
// the teams I'm on (derived from my requests/commitments)
function svMyTeams(ctx) {
  const seen = new Map();
  [...(ctx.servPending || []), ...(ctx.servConfirmed || [])].forEach(r => {
    if (r.teamId && !seen.has(r.teamId)) seen.set(r.teamId, { id: r.teamId, name: r.teamName || 'Team', icon: r.icon || 'hand', accent: r.accent || 'var(--clay)' });
  });
  return [...seen.values()];
}

function ServAvatar({ name, size = 34, accent = 'var(--clay)', me = false }) {
  return <div style={{ width: size, height: size, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: me ? size * 0.3 : size * 0.36, background: me ? 'var(--ink)' : `linear-gradient(150deg, ${accent}, color-mix(in oklab, ${accent} 62%, #16120c))` }}>{me ? 'You' : svInitials(name)}</div>;
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
function RespondSheet({ open, req, onClose, onSwap, ctx }) {
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
        <button onClick={() => onSwap(req)} style={svGhost()}><Icon name="swap" size={17} color="var(--ink)" /> Suggest someone</button>
        <button onClick={() => { ctx.respondServing(req, 'decline'); ctx.toast('Declined — your leader has been told'); onClose(); }} style={svGhost()}><Icon name="x" size={17} color="var(--ink)" /> Can’t this time</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center', marginTop: 16, color: 'var(--ink-3)', fontSize: 12 }}><Icon name="shield" size={14} color="var(--ink-3)" /> Only your team leader sees your reply</div>
    </BottomSheet>
  );
}

// ── ask a specific teammate to swap (falls back to a generic ask if no roster) ──
function SwapSheet({ open, item, onClose, ctx }) {
  const [pick, setPick] = useSv(null);
  useSvE(() => { if (open) setPick(null); }, [open]);
  if (!item) return null;
  const mates = svTeamMates(ctx, item.teamId);
  const doAsk = (pub, label) => { ctx.respondServing(item, 'swap', pub || ''); ctx.toast(label); onClose(); };
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="82%" z={75}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>Ask someone to swap</div><IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', margin: '0 0 16px', lineHeight: 1.5 }}>
        For <b style={{ color: 'var(--ink)' }}>{svParts(item.date).dow} {svParts(item.date).day} {svParts(item.date).mon}</b> · {item.teamName} · {item.role}. They’ll get a friendly ask — nothing changes until they say yes.</p>
      {mates.length ? (
        <React.Fragment>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', marginBottom: 10 }}>ON YOUR TEAM</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
            {mates.map(p => {
              const on = pick && pick.pub === p.pub;
              return (
                <button key={p.pub || p.name} onClick={() => setPick(p)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', border: on ? '2px solid var(--clay)' : '1px solid var(--line)', background: on ? 'color-mix(in oklab, var(--clay) 7%, var(--surface))' : 'var(--surface)', boxShadow: 'var(--shadow)' }}>
                  <ServAvatar name={p.name} size={40} accent={item.accent || 'var(--clay)'} />
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>On {item.teamName}</div></div>
                  {on ? <div style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={15} stroke={2.8} color="#fff" /></div>
                    : <div style={{ width: 24, height: 24, borderRadius: 999, border: '2px solid var(--line)' }} />}
                </button>
              );
            })}
          </div>
          <button onClick={() => pick && doAsk(pick.pub, `Asked ${pick.name.split(' ')[0]} to swap`)} disabled={!pick} style={{ ...svPrimary(), background: pick ? 'var(--clay)' : 'var(--line)' }}>
            <Icon name="swap" size={18} color="#fff" /> {pick ? `Ask ${pick.name.split(' ')[0]} to swap` : 'Choose someone'}</button>
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div style={{ textAlign: 'center', padding: '8px 8px 18px', color: 'var(--ink-3)', fontSize: 13.5, lineHeight: 1.5 }}>No teammates listed yet — your leader can still find cover.</div>
          <button onClick={() => doAsk('', 'Asked your leader for a swap')} style={svPrimary()}><Icon name="swap" size={18} color="#fff" /> Ask my leader for a swap</button>
        </React.Fragment>
      )}
    </BottomSheet>
  );
}

// ── manage a confirmed serving slot ──
function ManageSheet({ open, item, onClose, onSwap, ctx }) {
  if (!item) return null;
  const rows = [
    { ic: 'calPlus', t: 'Add to my calendar', s: 'Download an event for your phone', go: () => { svDownloadICS(item); ctx.toast('Added — you’ll be reminded the day before'); onClose(); } },
    { ic: 'swap', t: 'Ask someone to swap', s: 'Send a friendly ask to a teammate', go: () => onSwap(item) },
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

// ════════════════ member month calendar: my serving + church events ════════════════
// Focused detail sheet for one event (opened from anywhere an event is tapped) — full details + RSVP,
// instead of dumping the member at the top of the Serving screen.
function EventDetail({ event, open, onClose, ctx }) {
  const e = event || {};
  const rsvps = ctx.myRsvps || {};
  return (
    <BottomSheet open={open} onClose={onClose}>
      {event ? (
        <div style={{ paddingBottom: 8 }}>
          {e.image ? <img src={e.image} alt="" style={{ width: '100%', height: 170, objectFit: 'cover', borderRadius: 16, display: 'block', marginBottom: 14 }} /> : null}
          <div style={{ display: 'flex', gap: 13 }}>
            <ServDateBlock iso={e.date} accent={e.accent || 'var(--clay)'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, lineHeight: 1.12 }}>{e.title || 'Event'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--ink-3)', fontWeight: 600, marginTop: 6, flexWrap: 'wrap' }}>
                {e.time ? <React.Fragment><Icon name="clock" size={14} color="var(--ink-3)" /> {e.time}</React.Fragment> : null}
                {e.where ? <React.Fragment>{e.time ? <span style={{ opacity: .5 }}>·</span> : null}<Icon name="pin" size={14} color="var(--ink-3)" /> {e.where}</React.Fragment> : null}
              </div>
            </div>
          </div>
          {e.blurb ? <p style={{ fontFamily: 'var(--font-read)', fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)', margin: '14px 0 4px', textWrap: 'pretty' }}>{e.blurb}</p> : null}
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '18px 0 9px' }}>Will you be there?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['going', 'Going', 'var(--sage)'], ['maybe', 'Maybe', 'var(--gold)'], ['no', 'Can’t', 'var(--ink-3)']].map(([v, lbl, c]) => {
              const on = rsvps[e.id] === v;
              return <button key={v} onClick={() => ctx.setRsvp && ctx.setRsvp(e.id, v)} style={{ flex: 1, padding: '13px', borderRadius: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14.5, border: on ? 'none' : '1px solid var(--line)', background: on ? c : 'var(--surface)', color: on ? (v === 'maybe' ? 'var(--midnight)' : '#fff') : 'var(--ink-2)' }}>{lbl}</button>;
            })}
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}
window.EventDetail = EventDetail;

function svEventRsvpRow({ e, rsvps, ctx }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1 }} />
      {[['going', 'Going'], ['maybe', 'Maybe'], ['no', 'Can’t']].map(([v, lbl]) => {
        const on = rsvps[e.id] === v; const c = v === 'going' ? 'var(--sage)' : v === 'maybe' ? 'var(--gold)' : 'var(--ink-3)';
        return <button key={v} onClick={() => ctx.setRsvp(e.id, v)} style={{ padding: '7px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, border: on ? 'none' : '1px solid var(--line)', background: on ? c : 'var(--surface)', color: on ? (v === 'maybe' ? 'var(--midnight)' : '#fff') : 'var(--ink-2)' }}>{lbl}</button>;
      })}
    </div>
  );
}

// Order of service for a serving slot — opened from the "you're serving" card. Read-only for members.
function RunsheetSheet({ open, item, onClose, ctx }) {
  const sheet = item ? (ctx.churchRunsheets || []).find(r => r.service === item.serviceId) : null;
  const items = (sheet && sheet.items) || [];
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="82%" z={72}>
      {item ? (
        <div style={{ paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay)', marginBottom: 4 }}><Icon name="note" size={14} color="var(--clay)" /> ORDER OF SERVICE</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>{item.service || 'Service'}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14 }}>{svParts(item.date).dow} {svParts(item.date).day} {svParts(item.date).mon}{item.time ? ' · ' + item.time : ''}</div>
          {items.length === 0 ? <div style={{ fontSize: 14, color: 'var(--ink-3)' }}>No run sheet for this service yet.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {items.map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '11px 13px', borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ width: 52, flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--ink-3)' }}>{it.time || ''}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>{it.title}{it.ccli ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--clay)', marginLeft: 7 }}>CCLI {it.ccli}</span> : null}</div>
                    {it.who ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 1 }}>{it.who}</div> : null}
                    {it.note ? <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 3 }}>{it.note}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </BottomSheet>
  );
}

// compact "Order of service" link shown under a serving slot when its run sheet exists (upcoming list + calendar)
function RunsheetLink({ ctx, it, onOpen }) {
  const has = (ctx.churchRunsheets || []).some(r => r.service === it.serviceId && (r.items || []).length);
  if (!has) return null;
  return (
    <button onClick={() => onOpen(it)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', padding: '9px 12px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--clay)', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-ui)', cursor: 'pointer' }}>
      <Icon name="note" size={14} color="var(--clay)" /> Order of service
    </button>
  );
}

function MyMonth({ ctx, onManage, onRunsheet }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayIso = svIsoLocal(today);
  const [view, setView] = useSv(() => ({ y: today.getFullYear(), m: today.getMonth() }));
  const [sel, setSel] = useSv(todayIso);
  const serving = ctx.servConfirmed || [];
  const events = (ctx.churchEvents || []);
  const churchServices = (ctx.churchServices || []);   // the church's gatherings (everyone)
  const rsvps = ctx.myRsvps || {};

  // index by iso date
  const servBy = {}; serving.forEach(s => { (servBy[s.date] = servBy[s.date] || []).push(s); });
  const evBy = {}; events.forEach(e => { if (e.date) (evBy[e.date] = evBy[e.date] || []).push(e); });
  const svcBy = {}; churchServices.forEach(s => { if (s.date) (svcBy[s.date] = svcBy[s.date] || []).push(s); });

  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;                 // Monday-first offset
  const dim = new Date(view.y, view.m + 1, 0).getDate(); // days in month
  const cells = []; for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const step = (dir) => { let m = view.m + dir, y = view.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } setView({ y, m }); };

  const selServ = servBy[sel] || []; const selEv = evBy[sel] || []; const selSvc = svcBy[sel] || [];

  return (
    <React.Fragment>
      {/* month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={() => step(-1)} style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' }}><Icon name="chevL" size={18} /></button>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][view.m]} {view.y}</div>
        <button onClick={() => step(1)} style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' }}><Icon name="chevR" size={18} /></button>
      </div>
      {/* grid */}
      <div style={{ borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', padding: '14px 12px', marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 6 }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const cur = iso(view.y, view.m, d);
            const hasServ = !!servBy[cur]; const hasEv = !!evBy[cur]; const hasSvc = !!svcBy[cur];
            const isToday = cur === todayIso; const isSel = cur === sel;
            return (
              <button key={i} onClick={() => setSel(cur)} style={{ aspectRatio: '1', border: isSel ? '1.5px solid var(--clay)' : '1px solid transparent', borderRadius: 12, cursor: 'pointer', background: isSel ? 'color-mix(in oklab, var(--clay) 9%, var(--surface))' : isToday ? 'var(--surface-2)' : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'var(--font-ui)', position: 'relative' }}>
                <span style={{ fontSize: 13.5, fontWeight: isToday || isSel ? 800 : 600, color: isToday ? 'var(--clay)' : 'var(--ink)' }}>{d}</span>
                <span style={{ display: 'flex', gap: 3, height: 6 }}>
                  {hasServ ? <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--sage)' }} /> : null}
                  {hasSvc && !hasServ ? <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--clay)' }} /> : null}
                  {hasEv ? <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--gold)' }} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--sage)' }} /> You’re serving</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--clay)' }} /> Gathering</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--gold)' }} /> Event</span>
        </div>
      </div>
      {/* selected-day detail */}
      <SectionLabel>{svParts(sel).dow} {svParts(sel).day} {svParts(sel).mon}{sel === todayIso ? ' · Today' : ''}</SectionLabel>
      {(selServ.length === 0 && selEv.length === 0 && selSvc.length === 0) ? (
        <div style={{ fontSize: 14, color: 'var(--ink-3)', padding: '6px 2px 4px', lineHeight: 1.5 }}>Nothing on this day.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {selSvc.map((s, i) => (
            <div key={'svc' + i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 13, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="calCheck" size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{s.name || 'Gathering'}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1 }}>{s.time || ''}{selServ.some(x => x.date === s.date) ? ' · you’re serving' : ''}</div>
              </div>
            </div>
          ))}
          {selServ.map(it => (
            <div key={it.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => onManage(it)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 13, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', width: '100%' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `color-mix(in oklab, ${it.accent || 'var(--sage)'} 15%, var(--surface))`, color: it.accent || 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={it.icon || 'hand'} size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>Serving · {it.teamName}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1 }}>{it.role} · {it.time}</div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#345c41', background: 'var(--sage-soft)', borderRadius: 999, padding: '4px 10px' }}>Confirmed</span>
            </button>
            <RunsheetLink ctx={ctx} it={it} onOpen={onRunsheet} />
            </div>
          ))}
          {selEv.map(e => (
            <div key={(e._networkPub || '') + e.id} style={{ borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', padding: 14 }}>
              <button onClick={() => ctx.openEvent && ctx.openEvent(e)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, width: '100%', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)' }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'color-mix(in oklab, var(--gold) 15%, var(--surface))', color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="calendar" size={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5, lineHeight: 1.1 }}>{e.title}</span>
                    {e._network ? <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.4px', color: 'var(--clay-ink)', background: 'var(--clay-soft)', borderRadius: 999, padding: '1px 6px' }}>{e._network.toUpperCase()}</span> : null}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-3)', fontWeight: 600, marginTop: 2 }}><Icon name="clock" size={12} color="var(--ink-3)" /> {e.time}{e.where ? <React.Fragment><span style={{ opacity: .5 }}>·</span> {e.where}</React.Fragment> : null}</div>
                </div>
                <Icon name="chevR" size={16} color="var(--ink-3)" />
              </button>
              {e._network ? null : svEventRsvpRow({ e, rsvps, ctx })}
            </div>
          ))}
        </div>
      )}
    </React.Fragment>
  );
}

// ════════════════════════ MAIN OVERLAY ════════════════════════
function ServingScreen({ open, onClose, ctx, docked }) {
  const [tab, setTab] = useSv('serving');
  const [sheet, setSheet] = useSv(null);   // { kind, item }
  const [rosterOpen, setRosterOpen] = useSv(false);
  const [svcExpanded, setSvcExpanded] = useSv(false);   // show all upcoming services vs the first 3
  useSvE(() => { if (open) { setTab(ctx.servingTab || 'serving'); setSheet(null); setRosterOpen(false); } }, [open]);
  const pending = ctx.servPending || [];
  const upcoming = ctx.servConfirmed || [];
  const declined = ctx.servDeclined || [];
  const next = ctx.servNext;
  const events = ctx.churchEvents || [];
  const rsvps = ctx.myRsvps || {};
  const myTeams = svMyTeams(ctx);
  const nextRoster = next ? svServiceRoster(ctx, next.serviceId) : [];
  // practical-care commitments: the days I signed up to help, surfaced alongside my serving
  const careMine = (() => {
    const mp = ((ctx.care && ctx.care.myPub) || '').toLowerCase(); if (!mp) return [];
    const needs = (ctx.care && ctx.care.needs) || [];
    return ((ctx.care && ctx.care.slots) || []).filter(s => (s.pubkey || '').toLowerCase() === mp)
      .map(s => ({ iso: s.isoDate, note: s.note || '', need: needs.find(n => n.id === s.needId) })).filter(x => x.need && x.iso)
      .sort((a, b) => (a.iso || '').localeCompare(b.iso || ''));
  })();
  const careOn = !!(ctx.care && ctx.care.settings && ctx.care.settings.enabled);   // show the Care tab only when the church runs practical care
  const close = () => setSheet(null);

  return (
    <Overlay open={open} onClose={onClose} docked={docked}>
      <div style={{ paddingTop: 50, background: 'color-mix(in oklab, var(--surface) 92%, transparent)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px 12px' }}>
          <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="chevL" size={22} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, lineHeight: 1.05 }}>Serving</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{ctx.church ? ctx.church.name : 'Your church'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '0 14px 12px' }}>
          {[['serving', 'Serving', 'hand'], ['events', 'Events', 'calendar'], ['calendar', 'Calendar', 'calCheck'], ...(careOn ? [['care', 'Care', 'heart']] : [])].map(([k, lbl, ic]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 12, border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, background: on ? 'var(--clay)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink-2)' }}>
                <Icon name={ic} size={16} color={on ? '#fff' : 'var(--ink-3)'} /> {lbl}{k === 'serving' && pending.length ? <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: on ? 'rgba(255,255,255,.25)' : 'var(--clay)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{pending.length}</span> : null}
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
                <div style={{ display: 'flex', gap: 9 }}>
                  <button onClick={() => { ctx.respondServing(req, 'accept'); ctx.toast(`You’re serving ${svParts(req.date).dow} ${svParts(req.date).day}`); }} style={{ ...svPrimary(), flex: 1, padding: 14, fontSize: 15 }}><Icon name="check" size={19} stroke={2.4} color="#fff" /> Yes, I can serve</button>
                  <button onClick={() => setSheet({ kind: 'respond', item: req })} style={{ flexShrink: 0, padding: '0 16px', borderRadius: 15, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>Can’t make it</button>
                </div>
              </div>
            ))}

            {careMine.length ? (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.5px', color: 'var(--ink-3)', margin: '2px 0 10px' }}>PRACTICAL CARE — YOU’RE HELPING</div>
                {careMine.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 13px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', marginBottom: 9 }}>
                    <ServDateBlock iso={c.iso} accent="var(--sage)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="heart" size={16} color="var(--sage)" /><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{(c.need.type || 'care').replace(/^./, ch => ch.toUpperCase())}</span></div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1 }}>For {c.need.displayLabel || 'a member'}{c.note ? ' · bringing ' + c.note : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

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

                  {nextRoster.length ? (
                    <React.Fragment>
                      <button onClick={() => setRosterOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, border: 'none', background: 'none', cursor: 'pointer', padding: 0, width: '100%' }}>
                        <div style={{ display: 'flex' }}>
                          {nextRoster.slice(0, 5).map((p, i) => (
                            <div key={i} style={{ marginLeft: i ? -10 : 0, borderRadius: 999, boxShadow: '0 0 0 2px #4a7a5c' }}><ServAvatar name={p.name} size={30} me={p.me} accent={next.accent || 'var(--clay)'} /></div>
                          ))}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', opacity: .95 }}>{nextRoster.length} on the team today</span>
                        <Icon name={rosterOpen ? 'chevU' : 'chevD'} size={16} color="#fff" style={{ marginLeft: 'auto', opacity: .9 }} />
                      </button>
                      {rosterOpen ? (
                        <div style={{ marginTop: 12, borderRadius: 14, background: 'rgba(255,255,255,.14)', overflow: 'hidden' }}>
                          {nextRoster.map((p, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid rgba(255,255,255,.14)' : 'none' }}>
                              <ServAvatar name={p.name} size={28} me={p.me} accent={next.accent || 'var(--clay)'} />
                              <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>{p.me ? 'You' : p.name}</span>
                              <span style={{ fontSize: 12, opacity: .9 }}>{p.role}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </React.Fragment>
                  ) : null}

                  <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
                    <button onClick={() => { svDownloadICS(next); ctx.toast('Added — you’ll be reminded the day before'); }} style={{ flex: 1, padding: 13, borderRadius: 14, border: 'none', cursor: 'pointer', background: '#fff', color: '#3C6E57', fontWeight: 700, fontSize: 14.5, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><Icon name="calPlus" size={17} color="#3C6E57" /> Add to calendar</button>
                    <button onClick={() => setSheet({ kind: 'manage', item: next })} style={{ flexShrink: 0, padding: '13px 16px', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,.2)', color: '#fff', fontWeight: 700, fontSize: 14.5, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, backdropFilter: 'blur(4px)' }}><Icon name="swap" size={17} color="#fff" /> Change</button>
                  </div>
                  {(ctx.churchRunsheets || []).some(r => r.service === next.serviceId && (r.items || []).length) ? (
                    <button onClick={() => setSheet({ kind: 'runsheet', item: next })} style={{ width: '100%', marginTop: 9, padding: 12, borderRadius: 14, border: '1px solid rgba(255,255,255,.3)', cursor: 'pointer', background: 'rgba(255,255,255,.12)', color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, backdropFilter: 'blur(4px)' }}><Icon name="note" size={16} color="#fff" /> Order of service</button>
                  ) : null}
                </div>
              </div>
            ) : (pending.length === 0 ? (
              (ctx.myRosterTeams || []).length ? (
                <div style={{ padding: '8px 0 4px' }}>
                  <div style={{ borderRadius: 20, padding: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
                      {(ctx.myRosterTeams || []).slice(0, 4).map(t => (
                        <div key={t.id} style={{ width: 46, height: 46, borderRadius: 14, background: `color-mix(in oklab, ${t.accent || 'var(--clay)'} 15%, var(--surface))`, color: t.accent || 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={t.icon || 'hand'} size={24} /></div>
                      ))}
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink)', marginBottom: 5 }}>You’re on {(ctx.myRosterTeams || []).length === 1 ? 'the ' + ctx.myRosterTeams[0].name + ' team' : (ctx.myRosterTeams || []).length + ' teams'}</div>
                    <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 280, margin: '0 auto', color: 'var(--ink-2)' }}>No dates scheduled for you yet. When your church puts you on a service, it’ll show up here and we’ll remind you the day before.</p>
                    {(ctx.myRosterTeams || []).length > 1 ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 10 }}>{(ctx.myRosterTeams || []).map(t => t.name).join(' · ')}</div> : null}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--ink-3)' }}>
                  <div style={{ width: 54, height: 54, borderRadius: 16, background: 'color-mix(in oklab, var(--sage) 14%, var(--surface))', color: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}><Icon name="hand" size={26} /></div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink)', marginBottom: 5 }}>You’re not on a serving team yet</div>
                  <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 260, margin: '0 auto' }}>When your church adds you to a team, it’ll show up here — and we’ll remind you the day before you serve. Meanwhile, check <b>Events</b> for what’s on.</p>
                </div>
              )
            ) : null)}

            {upcoming.length > (next ? 1 : 0) ? <SectionLabel>Your upcoming</SectionLabel> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
              {upcoming.filter(it => !next || it.id !== next.id).map(it => (
                <div key={it.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => setSheet({ kind: 'manage', item: it })} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 13, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', width: '100%' }}>
                  <ServDateBlock iso={it.date} accent={it.accent || 'var(--clay)'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name={it.icon || 'hand'} size={16} color={it.accent || 'var(--clay)'} /><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15.5 }}>{it.teamName}</span></div>
                    <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>{it.role} · {it.time}</div>
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#345c41', background: 'var(--sage-soft)', borderRadius: 999, padding: '4px 10px' }}>Confirmed</span>
                </button>
                <RunsheetLink ctx={ctx} it={it} onOpen={(x) => setSheet({ kind: 'runsheet', item: x })} />
                </div>
              ))}
            </div>

            {/* quick actions: set unavailable + my teams */}
            <div style={{ display: 'flex', gap: 11 }}>
              <button onClick={() => setSheet({ kind: 'unavail' })} style={{ flex: 1, padding: '15px 12px', borderRadius: 16, border: '1px solid var(--line)', background: 'var(--surface)', boxShadow: 'var(--shadow)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, fontFamily: 'var(--font-ui)' }}>
                <Icon name="calendar" size={21} color="var(--clay)" /><span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>Set unavailable</span></button>
              {myTeams.length ? (
                <div style={{ flex: 1, padding: '13px 14px', borderRadius: 16, border: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex' }}>
                    {myTeams.slice(0, 3).map((t, i) => (
                      <div key={t.id} style={{ marginLeft: i ? -8 : 0, width: 32, height: 32, borderRadius: 10, background: `color-mix(in oklab, ${t.accent} 16%, var(--surface))`, color: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface-2)' }}><Icon name={t.icon} size={17} /></div>
                    ))}
                  </div>
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700 }}>My teams</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{myTeams.map(t => t.name).join(' · ')}</div></div>
                </div>
              ) : (
                <div style={{ flex: 1, padding: '13px 14px', borderRadius: 16, border: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-3)' }}>
                  <Icon name="hand" size={20} color="var(--ink-3)" /><div style={{ fontSize: 12, lineHeight: 1.4 }}>No teams yet — your leader adds you</div>
                </div>
              )}
            </div>

            {/* your replies (declined / swap-asked) — each with an undo, labelled to match the steward */}
            {declined.length ? (
              <React.Fragment>
                <div style={{ marginTop: 22 }}><SectionLabel>Your responses</SectionLabel></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {declined.map(it => {
                    const isSwap = it._verdict === 'swap';
                    const statusFg = isSwap ? '#8a6717' : 'var(--ink-3)';
                    const statusBg = isSwap ? 'var(--gold-tint)' : 'var(--surface-2)';
                    return (
                      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 13, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
                        <ServDateBlock iso={it.date} accent={isSwap ? 'var(--gold)' : 'var(--ink-3)'} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--ink-2)' }}>{it.teamName}</span>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: statusFg, background: statusBg, borderRadius: 999, padding: '2px 8px' }}>{isSwap ? 'Swap asked' : 'Can’t make it'}</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 1 }}>{it.role} · {svParts(it.date).dow} {svParts(it.date).day} {svParts(it.date).mon}</div>
                        </div>
                        <button onClick={() => { ctx.respondServing(it, 'accept'); ctx.toast('Great — you’re back on'); }} style={{ flexShrink: 0, padding: '9px 13px', borderRadius: 12, border: '1px solid var(--clay)', background: 'color-mix(in oklab, var(--clay) 8%, var(--surface))', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={15} color="var(--clay)" /> {isSwap ? 'I’ll serve' : 'I can serve'}</button>
                      </div>
                    );
                  })}
                </div>
              </React.Fragment>
            ) : null}
          </React.Fragment>
        ) : tab === 'events' ? (
          <React.Fragment>
            {/* regular gatherings (services) the church scheduled */}
            {(() => {
              const todayIso = svTodayIso();
              const upSvc = (ctx.churchServices || []).filter(s => (s.date || '') >= todayIso).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
              if (!upSvc.length) return null;
              const shownSvc = svcExpanded ? upSvc : upSvc.slice(0, 3);
              return (
                <React.Fragment>
                  <SectionLabel>Services</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: upSvc.length > 3 ? 12 : 22 }}>
                    {shownSvc.map((s, i) => (
                      <div key={'svc' + i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 14, borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
                        <ServDateBlock iso={s.date} accent="var(--clay)" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{s.name || 'Sunday Gathering'}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600, marginTop: 2 }}><Icon name="clock" size={13} color="var(--ink-3)" /> {s.time || ''}</div>
                        </div>
                        <button onClick={() => { svDownloadICS({ date: s.date, time: s.time, teamName: s.name || 'Gathering', role: '', service: s.name || '' }); ctx.toast('Added to your calendar'); }} title="Add to calendar" style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="calPlus" size={18} /></button>
                      </div>
                    ))}
                  </div>
                  {upSvc.length > 3 ? (
                    <button onClick={() => setSvcExpanded(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: '10px', marginBottom: 22, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--clay-ink)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>
                      {svcExpanded ? 'Show less' : `Show ${upSvc.length - 3} more`} <Icon name={svcExpanded ? 'chevU' : 'chevD'} size={16} color="var(--clay)" />
                    </button>
                  ) : null}
                </React.Fragment>
              );
            })()}
            <SectionLabel>What’s on</SectionLabel>
            {events.length === 0 ? <div style={{ fontSize: 14, color: 'var(--ink-3)', padding: '8px 2px', lineHeight: 1.5 }}>No socials or events yet — your church will post them here.</div> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {events.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => (
                <div key={(e._networkPub || '') + e.id} style={{ borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                  {e.image ? <img src={e.image} alt="" style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} /> : null}
                  <div onClick={() => ctx.openEvent && ctx.openEvent(e)} style={{ display: 'flex', gap: 13, padding: 16, cursor: 'pointer' }}>
                    <ServDateBlock iso={e.date} accent={e._network ? 'var(--clay)' : (e.accent || 'var(--clay)')} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, lineHeight: 1.1 }}>{e.title}</span>
                        {e._network ? <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--clay-ink)', background: 'var(--clay-soft)', borderRadius: 999, padding: '2px 7px' }}>{e._network.toUpperCase()}</span> : null}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600, marginTop: 3 }}><Icon name="clock" size={13} color="var(--ink-3)" /> {e.time}{e.where ? <React.Fragment><span style={{ opacity: .5 }}>·</span><Icon name="pin" size={13} color="var(--ink-3)" /> {e.where}</React.Fragment> : null}</div>
                      {e.blurb ? <p style={{ fontFamily: 'var(--font-read)', fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink-2)', margin: '9px 0 0', textWrap: 'pretty' }}>{e.blurb}</p> : null}
                    </div>
                  </div>
                  <div style={{ padding: '0 16px 14px' }}>{e._network
                    ? <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="globe" size={13} color="var(--ink-3)" /> A {e._network} event</div>
                    : svEventRsvpRow({ e, rsvps, ctx })}</div>
                </div>
              ))}
            </div>
          </React.Fragment>
        ) : tab === 'care' ? (
          <CareCard ctx={ctx} embedded />
        ) : (
          <MyMonth ctx={ctx} onManage={(it) => setSheet({ kind: 'manage', item: it })} onRunsheet={(it) => setSheet({ kind: 'runsheet', item: it })} />
        )}
      </div>

      <RespondSheet open={sheet && sheet.kind === 'respond'} req={sheet && sheet.kind === 'respond' ? sheet.item : null} onClose={close} onSwap={(req) => setSheet({ kind: 'swap', item: req })} ctx={ctx} />
      <ManageSheet open={sheet && sheet.kind === 'manage'} item={sheet && sheet.kind === 'manage' ? sheet.item : null} onClose={close} onSwap={(it) => setSheet({ kind: 'swap', item: it })} ctx={ctx} />
      <SwapSheet open={sheet && sheet.kind === 'swap'} item={sheet && sheet.kind === 'swap' ? sheet.item : null} onClose={close} ctx={ctx} />
      <UnavailSheet open={sheet && sheet.kind === 'unavail'} onClose={close} ctx={ctx} />
      <RunsheetSheet open={sheet && sheet.kind === 'runsheet'} item={sheet && sheet.kind === 'runsheet' ? sheet.item : null} onClose={close} ctx={ctx} />
    </Overlay>
  );
}
Object.assign(window, { ServingScreen });
