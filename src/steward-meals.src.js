// steward-meals.src.js — TrinityOne's optional Meal trains / practical-care module.
// Bundled → vendor/steward-meals.js, loaded by steward.html. Exposes window.StewardMeals.
//
// The community-glue of practical showing-up: when someone in the church is ill / grieving / has
// a new baby, the steward (or a designated care-team member) opens a NEED — and the church fills
// date-keyed slots: meals Tuesday, rides Thursday, errands Saturday. Encrypted-to-church is NOT
// used here (unlike Finance) — care needs and slot signups must be visible to fellow members so
// the church can see what's open and who's covered. The recipient's privacy is handled by the
// steward's choice of `displayLabel` (e.g. "Sarah Jones" vs "a family in our church").
//
// Data shape (kind 30078 addressable events on the church's relay):
//
//   trinityone/meals-settings           church-signed, single doc
//     { enabled, visibility:'all'|'team', openedBy:'steward'|'member', adminGroupId }
//
//   trinityone/care:<id>                church-signed (or care-team-admin-signed via ['church',cp])
//     { displayLabel, type, startDate, endDate, recipient?, notes? }
//     type ∈ 'meals' | 'rides' | 'errands' | 'visits' | 'childcare'
//
//   trinityone/careslot:<careId>:<iso>  member-signed; ['church',<cp>] ['t','trinityone']
//     { careId, isoDate, note? }
//     (per-member addressable — each member can fill ONE slot per care+date; tombstoned to release)
//
//   trinityone/careskip:<careId>:<iso>  RECIPIENT-signed only; ['church',<cp>] ['t','trinityone']
//     { careId, isoDate, reason? }
//     (the recipient marks "I don't need food that day" — slot disappears from the grid for everyone)
//
// All four decisions from SPINE 2026-06-24 are honored:
//   - visibility + openedBy: steward settings per church
//   - careskip: recipient-only (client filters; relay enforcement is a v2 tightening pass)
//   - displayLabel: steward-typed free text per need
// And the care-team-admin pattern (capability scoped to THIS addon, not a global tier):
//   - `meals-settings.adminGroupId` references a regular church group; the steward console treats
//     any member of that group as authorised to publish care: docs locally. The relay accepts care:
//     events tagged with ['church', cp] from those members (same delegated-content path used by
//     stewards) — see scripts/gateway.mjs accept() carve-out.

(function () {
  const S = () => window.Steward;
  const NET = 'trinityone';
  const PFX = NET + '/meals-';
  const SETTINGS_D = PFX + 'settings';       // single doc (no suffix)
  const NEED_D    = NET + '/care:';          // + needId
  const SLOT_D    = NET + '/careslot:';      // + needId:isoDate
  const SKIP_D    = NET + '/careskip:';      // + needId:isoDate
  const CARETEAM_D = NET + '/careteam:';     // + churchpub — the care-team recipient roster (pubkeys a member seals an "ask for help" request to)
  const CAREREQ_D  = NET + '/carereq:';      // + id — a member's sealed "ask for help" request
  const CARESTATUS_D = NET + '/carereqstatus:'; // + id — the care team's resolution
  const CARECHAT_D = NET + '/carechat:';     // + reqId:msgId — a message in the shared thread

  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => Math.floor(Date.now() / 1000);

  // ---- settings (enabled, visibility, openedBy, adminGroupId) ----
  // Single church-signed doc at SETTINGS_D. The `enabled` flag also gates the steward nav item —
  // reading from the relay takes a round-trip, so we mirror it in localStorage per-church for instant
  // first-paint (same trick Finance uses).
  const enKey = () => 'trinityone.meals.enabled.' + ((S() && S().churchPub) || '');
  function cachedEnabled() { try { return localStorage.getItem(enKey()) === '1'; } catch (e) { return false; } }

  const DEFAULTS = { enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' };

  function subscribeSettings(cb) {
    if (!S() || !S().subscribeMany || !S().churchPub) { cb({ ...DEFAULTS }); return () => {}; }
    cb({ ...DEFAULTS, enabled: cachedEnabled() });   // paint immediately so the nav item is correct on first render
    const seen = { ts: 0, doc: { ...DEFAULTS } };
    const emit = () => { try { localStorage.setItem(enKey(), seen.doc.enabled ? '1' : '0'); } catch (e) {} cb({ ...seen.doc }); };
    const sub = S().subscribeMany(
      [{ kinds: [30078], authors: [S().churchPub], '#t': [NET] }, { kinds: [30078], '#church': [S().churchPub], '#t': [NET] }],
      {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (d !== SETTINGS_D) return;
          if ((e.created_at || 0) <= seen.ts) return;
          try {
            const doc = JSON.parse(e.content || '{}');
            seen.ts = e.created_at || 0;
            seen.doc = {
              enabled: !!doc.enabled,
              visibility: (doc.visibility === 'team' ? 'team' : 'all'),
              openedBy: (doc.openedBy === 'member' ? 'member' : 'steward'),
              adminGroupId: String(doc.adminGroupId || ''),
            };
            emit();
          } catch (err) {}
        },
        oneose() { emit(); },
      }
    );
    return () => { try { sub.close(); } catch (e) {} };
  }

  function setEnabled(on, opts) {
    if (!S() || !S().publishSigned) return Promise.resolve(null);
    opts = opts || {};
    try { localStorage.setItem(enKey(), on ? '1' : '0'); } catch (e) {}
    const content = JSON.stringify({
      enabled: !!on,
      visibility: (opts.visibility === 'team' ? 'team' : 'all'),
      openedBy: (opts.openedBy === 'member' ? 'member' : 'steward'),
      adminGroupId: String(opts.adminGroupId || ''),
      updated: now(),
    });
    return S().publishSigned({ kind: 30078, created_at: now(), tags: [['d', SETTINGS_D], ['t', NET]], content });
  }

  // ---- needs (care: docs — church-signed) ----
  // Build a normalised care-need record from steward input + publish as a kind-30078 addressable
  // event. The care-team-admin delegation works the same way as steward delegation: the publish
  // helper stamps ['church', cp] when the active key isn't the church key itself, so the relay
  // accepts the event as authored-on-behalf-of the church.
  function _normNeed(n) {
    const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '';
    const MEALS_OK = ['breakfast', 'lunch', 'dinner'];
    const normMeals = (a) => (Array.isArray(a) ? a : []).filter(m => MEALS_OK.includes(m));
    const type = ['meals', 'rides', 'moving', 'errands', 'diy', 'visits', 'childcare', 'other'].includes(n.type) ? n.type : 'meals';
    // additive days are the source of truth; startDate/endDate are derived (min/max) for sorting + the live filter
    const days = [...new Set((Array.isArray(n.dates) ? n.dates : []).map(isoDate).filter(Boolean))].sort().slice(0, 90);
    const isMeals = type === 'meals';
    // per-need default meals (which of B/L/D the task needs) + optional per-day overrides. A day with no
    // override inherits need.meals; we only store overrides that actually differ. Meals-only.
    const meals = isMeals ? (normMeals(n.meals).length ? normMeals(n.meals) : ['dinner']) : [];
    const dayMeals = isMeals
      ? Object.fromEntries(Object.entries(n.dayMeals || {})
          .filter(([k, v]) => isoDate(k) && days.includes(k) && normMeals(v).join() !== meals.join())
          .map(([k, v]) => [k, normMeals(v)]))
      : {};
    return {
      displayLabel: String(n.displayLabel || '').trim(),
      type,
      dates: days,
      meals,
      dayMeals,
      startDate: days[0] || isoDate(n.startDate),
      endDate:   days[days.length - 1] || isoDate(n.endDate),
      recipient: (typeof n.recipient === 'string' && /^[0-9a-f]{64}$/i.test(n.recipient)) ? n.recipient.toLowerCase() : '',
      notes:     String(n.notes || '').trim(),
      // dietary tags (meals only) — capped + length-limited; the UI supplies the chip set
      dietary:   (Array.isArray(n.dietary) ? n.dietary : []).map(d => String(d).slice(0, 24)).filter(Boolean).slice(0, 12),
    };
  }

  // SECURITY-AUDIT-2026-07-20 H3. A need used to publish `displayLabel`, `notes`, `recipient` and `dietary`
  // as cleartext: who is struggling, free text the UI explicitly asks to contain "the address … who not to
  // ring after 9pm", the recipient's pubkey, and a health inference. Readable by the relay operator, by
  // every member forever, and by anyone holding a backup. Manna already treats recipient-naming docs as
  // must-encrypt; this brings Care into line.
  //
  // SPLIT, not blanket encryption: type/dates/meals/start/end stay CLEAR so the slot grid, the sort and the
  // live/past filter work without the key — and so a member who hasn't been keyed yet still sees that help
  // is needed on Tuesday, just not who for.
  const SEALED_FIELDS = ['displayLabel', 'notes', 'recipient', 'dietary'];
  const _rand32 = () => { const b = new Uint8Array(32); crypto.getRandomValues(b); return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); };
  async function _sha256hex(str) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function publishNeed(need) {
    if (!S() || !S().publishSigned) return null;
    // A need loaded on a device WITHOUT the care key comes back `_sealed` — its PII fields are blank because
    // we couldn't decrypt them. Re-publishing that would seal the blanks over the real, still-encrypted data
    // for the whole church (kind-30078 is replaceable). Refuse, rather than silently destroy it.
    if (need._sealed) throw new Error('This need was saved by a device that holds the care key, and this device can’t open it. Open Members so the key syncs, then edit it here.');
    const id = need.id || uid('care');
    const rec = _normNeed(need);
    const sealed = {}; for (const f of SEALED_FIELDS) sealed[f] = rec[f];
    const ct = S().careSeal ? S().careSeal(sealed) : null;
    if (!ct) {
      // No care key on this device. Publishing the PII in the clear would silently reintroduce the finding,
      // so refuse and say why. careKeyChecked() distinguishes "still loading" from "genuinely absent", so the
      // steward gets an accurate reason rather than being sent somewhere that won't help.
      const looking = S().careKeyChecked && !S().careKeyChecked();
      throw new Error(looking
        ? 'Still connecting to your church — give it a moment and try again.'
        : 'Care needs are encrypted for the person’s privacy, and this church’s care key hasn’t reached this device yet. Open Members once so it can sync, then try again.');
    }
    const tags = [['d', NEED_D + id], ['t', NET], ['enc', 'care1']];
    const body = { ...rec, enc: ct };
    for (const f of SEALED_FIELDS) delete body[f];   // never ship both halves
    // Skip token: lets the RECIPIENT alone mark "I don't need help that day" without the relay ever learning
    // who they are. Random (so it can't be brute-forced back to an identity) and encrypted to the recipient
    // specifically — NOT under the church-wide care key, which every member holds.
    if (rec.recipient && S().careSealTo) {
      // Per-DAY skip tokens, all derived from ONE master secret sealed to the recipient. careSealTo seals
      // against the acting key, i.e. the NEED'S AUTHOR — so a delegated steward's need still unseals for the
      // recipient (fellowship unseals against `_by`). Each day's token = sha256(secret + ':' + day); the need
      // carries only sha256(token) per day. So a member who reads one day's token off a stored skip event
      // learns nothing about the secret and cannot forge a skip for any OTHER day (was a single reusable
      // bearer token — Fable audit 2026-07-22 #12 / #13).
      const secret = _rand32();
      const to = S().careSealTo(rec.recipient, { s: secret });
      if (to) {
        body.skipEnc = to;
        for (const day of rec.dates) {
          const tokDay = await _sha256hex(secret + ':' + day);
          tags.push(['skiphash', day, await _sha256hex(tokDay)]);
        }
      }
    }
    const e = await S().publishSigned({ kind: 30078, created_at: now(), tags, content: JSON.stringify(body) });
    return { id, ...rec, ts: e && e.created_at };
  }
  // Open a need read off the relay. v1 docs (pre-2026-07-20) carry the fields in the clear and are read
  // as-is — a church mid-pilot must not lose its open needs. `_sealed` marks one we could not open, so the
  // UI can say "details hidden" rather than render a nameless, broken-looking card.
  function openNeed(rec) {
    if (!rec || !rec.enc) return rec;
    const opened = (S() && S().careOpen) ? S().careOpen(rec.enc) : null;
    const { enc, ...clear } = rec;
    return opened ? { ...clear, ...opened } : { ...clear, _sealed: true };
  }

  function removeNeed(id) {
    if (!S() || !S().publishSigned) return Promise.resolve(null);
    return S().publishSigned({ kind: 30078, created_at: now(), tags: [['d', NEED_D + id], ['t', NET], ['deleted', '1']], content: '' });
  }

  // steward / care-team marks a day "covered" (block-out) on behalf of a recipient who may not be on the
  // app. Same careskip: doc the member publishes; the relay now accepts it from a steward/care-admin too.
  function skipDay(careId, iso) {
    if (!S() || !S().publishSigned || !careId || !/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return Promise.resolve(null);
    return S().publishSigned({ kind: 30078, created_at: now(), tags: [['d', SKIP_D + careId + ':' + iso], ['t', NET]], content: '{}' });
  }
  function unskipDay(careId, iso) {
    if (!S() || !S().publishSigned || !careId || !/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return Promise.resolve(null);
    return S().publishSigned({ kind: 30078, created_at: now(), tags: [['d', SKIP_D + careId + ':' + iso], ['t', NET], ['deleted', '1']], content: '' });
  }

  function subscribeNeeds(cb) {
    if (!S() || !S().subscribeMany || !S().churchPub) { cb([]); return () => {}; }
    const byId = new Map();
    // Deletion authority (mirrors the member client): when the church opens needs to ANY member, the relay lets
    // any member author a care: doc — so a member could publish a tombstone for SOMEONE ELSE's need and, since
    // the client keyed only on the d-tag, hide it from everyone. Only the church key, or the need's own author,
    // may retract it. When needs are steward/care-team-only the relay already gates every care: write, so any
    // tombstone that reaches us is authorised. Tracked per id so event order doesn't matter.
    const tombs = new Map();          // careId -> Set(pubkeys that published a deletion)
    let openedByMember = false;       // from the church-signed meals-settings (same sub — it's church-authored + NET-tagged)
    const delOk = (by, need) => !openedByMember || by === S().churchPub || (!!need && need._by === by);
    const retracted = (id, need) => { const s = tombs.get(id); if (!s) return false; for (const by of s) { if (delOk(by, need)) return true; } return false; };
    const emit = () => cb([...byId.entries()].filter(([id, n]) => !retracted(id, n)).map(([, n]) => n).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || (a.ts || 0) - (b.ts || 0)));
    const sub = S().subscribeMany(
      [{ kinds: [30078], authors: [S().churchPub], '#t': [NET] }, { kinds: [30078], '#church': [S().churchPub], '#t': [NET] }],
      {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          // capture the church's openedBy so deletion authority can be judged (church-signed doc, same filters)
          if (d === SETTINGS_D) { if (e.pubkey === S().churchPub) { try { openedByMember = JSON.parse(e.content || '{}').openedBy === 'member'; emit(); } catch (x) {} } return; }
          if (!d.startsWith(NEED_D)) return;
          const id = d.slice(NEED_D.length);
          const deleted = e.tags.some(t => t[0] === 'deleted') || !e.content;
          if (deleted) { const s = tombs.get(id) || new Set(); s.add(e.pubkey); tombs.set(id, s); emit(); return; }
          try {
            // Decrypt the sealed half BEFORE normalising. A sealed need (H3) carries displayLabel / notes /
            // recipient / dietary inside `enc`, not as top-level keys — so _normNeed alone reads them as
            // empty and drops `enc`, and the console shows every sealed need blank. openNeed merges the
            // decrypted fields back, or marks `_sealed` when this device has no care key. Carry `_sealed`
            // through so the UI can say "details hidden" and refuse to edit-save a blank over the real data.
            const opened = openNeed(JSON.parse(e.content));
            byId.set(id, { id, ..._normNeed(opened), _sealed: !!opened._sealed, _by: e.pubkey, ts: e.created_at });
            emit();
          } catch (err) {}
        },
        oneose() { emit(); },
      }
    );
    return () => { try { sub.close(); } catch (e) {} };
  }

  // ---- slots + skips (member-signed; the steward console READS them; member-side publishes) ----
  // Both shapes are member-signed events tagged with ['church', cp]; the steward console listens
  // for the church-tag stream. Slots are filtered by the SLOT_D prefix; skips by SKIP_D. We expose
  // them as separate streams so the UI can apply skips as a mask over slots.
  function _subscribeChurchTagged(prefix, normalise, cb) {
    if (!S() || !S().subscribeMany || !S().churchPub) { cb([]); return () => {}; }
    const byKey = new Map();   // key = needId|isoDate|pubkey   (one entry per member-per-(need,date))
    const emit = () => cb([...byKey.values()]);
    const sub = S().subscribeMany(
      [{ kinds: [30078], '#church': [S().churchPub], '#t': [NET] }],
      {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (!d.startsWith(prefix)) return;
          const rest = d.slice(prefix.length).split(':');
          const needId  = rest[0] || '';
          const isoDate = rest[1] || '';
          if (!needId || !isoDate) return;
          const key = needId + '|' + isoDate + '|' + e.pubkey;
          const deleted = e.tags.some(t => t[0] === 'deleted') || !e.content;
          if (deleted) { byKey.delete(key); emit(); return; }
          try {
            const obj = JSON.parse(e.content || '{}');
            byKey.set(key, { needId, isoDate, pubkey: e.pubkey, ts: e.created_at, ...normalise(obj) });
            emit();
          } catch (err) {}
        },
        oneose() { emit(); },
      }
    );
    return () => { try { sub.close(); } catch (e) {} };
  }

  function subscribeSlots(cb) {
    return _subscribeChurchTagged(SLOT_D, (o) => ({ note: String(o.note || '').trim() }), cb);
  }
  function subscribeSkips(cb) {
    return _subscribeChurchTagged(SKIP_D, (o) => ({ reason: String(o.reason || '').trim() }), cb);
  }

  // ---- delegated-publish: care-team admins ----
  // The relay accepts care: events from any pubkey if the event is tagged ['church', <cp>] AND the
  // author is a member of the church's configured care-team admin group. The steward console handles
  // that decision client-side (it knows who's in the group); the relay carve-out lets those events
  // through. This helper just stamps the right tags — the actual sign+publish uses Steward.publishSigned.
  // (For the OWNER steward acting as themselves, publishNeed above already goes via the church key.)
  function isCareAdmin(memberPub, adminGroupId, groupRosters) {
    if (!memberPub || !adminGroupId) return false;
    const roster = (groupRosters || {})[adminGroupId];
    if (!roster || !Array.isArray(roster.people)) return false;
    // roster people are { id, name, pub } (see Steward.publishRoster) — the linked account is `pub`, not `pubkey`.
    return roster.people.some(p => p && p.pub && p.pub.toLowerCase() === memberPub.toLowerCase());
  }

  // Publish the care-team RECIPIENT roster (careteam:<cp>) — the pubkeys a member seals an "ask for help"
  // request to = the church key (always, so the owner can triage) + the care-team group's members (passed in
  // from the console, which holds the rosters). Just pubkeys, no secrets. Re-published when the team changes.
  function publishCareTeam(memberPubs) {
    if (!S() || !S().publishSigned || !S().churchPub) return Promise.resolve(null);
    const cp = S().churchPub;
    const pubs = [...new Set([cp, ...((memberPubs || []).map(p => String(p || '').trim().toLowerCase()).filter(Boolean))])];
    return S().publishSigned({ kind: 30078, created_at: now(), tags: [['d', CARETEAM_D + cp], ['t', NET]], content: JSON.stringify({ pubs, updated: now() }) });
  }

  // ---- "Ask for help" requests (console/owner side): triage, approve into a need, chat ----
  // The owner console holds the church key and is on the care-team roster, so requests sealed to the church
  // unwrap via S().openSealedFromPeer. (A delegated steward who isn't in the roster can't decrypt — they use
  // the members app as a care-admin, or are added to the care team.)
  function subscribeCareRequests(cb) {
    if (!S() || !S().subscribeMany || !S().churchPub) { cb([]); return () => {}; }
    const cp = S().churchPub; const byId = new Map(), statusById = new Map(), tomb = new Map();
    const emit = () => { try { cb([...byId.values()].map(r => { const s = statusById.get(r.id) || {}; return { ...r, status: s.status || 'open', needId: s.needId || '' }; }).sort((a, b) => (b.at || 0) - (a.at || 0))); } catch (e) {} };
    const sub = S().subscribeMany([{ kinds: [30078], '#t': ['carereq', 'carereqstatus'], '#church': [cp] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d.startsWith(CARESTATUS_D)) { const id = d.slice(CARESTATUS_D.length); const p = statusById.get(id); if (p && p._ts >= e.created_at) return; try { const s = JSON.parse(e.content || '{}'); statusById.set(id, { status: String(s.status || 'handled'), needId: String(s.needId || ''), _ts: e.created_at }); emit(); } catch (x) {} return; }
        if (!d.startsWith(CAREREQ_D)) return;
        const id = d.slice(CAREREQ_D.length);
        if (e.tags.some(t => t[0] === 'deleted')) { tomb.set(id, Math.max(tomb.get(id) || 0, e.created_at)); byId.delete(id); emit(); return; }
        if ((tomb.get(id) || 0) >= e.created_at) return;   // withdrawn — don't resurrect a lagging copy
        const p = byId.get(id); if (p && p._ts >= e.created_at) return;
        let body = null; try { body = S().openSealedFromPeer(JSON.parse(e.content), e.pubkey); } catch (x) {}
        byId.set(id, { id, from: e.pubkey, at: (body && body.at) || e.created_at, _ts: e.created_at, sealed: !body, ...(body || {}) });
        emit();
      },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch (e) {} };
  }
  function setCareRequestStatus(reqId, requesterPub, opts) {
    if (!S() || !S().publishSigned || !S().churchPub || !reqId) return Promise.resolve(null);
    const o = opts || {}; const tags = [['d', CARESTATUS_D + reqId], ['t', NET], ['t', 'carereqstatus'], ['church', S().churchPub]];
    if (requesterPub) tags.push(['p', requesterPub]);
    return S().publishSigned({ kind: 30078, created_at: now(), tags, content: JSON.stringify({ status: String(o.status || 'handled'), needId: String(o.needId || ''), at: now() }) });
  }
  function declineCareRequest(req) { return (req && req.id) ? setCareRequestStatus(req.id, req.from, { status: 'declined' }) : Promise.resolve(null); }
  async function approveCareRequest(req, fields) {
    if (!req) return null;
    const f = fields || {};
    const dates = [...new Set((Array.isArray(f.dates) ? f.dates : []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
    const saved = await publishNeed({ type: req.type || 'other', displayLabel: req.forSelf ? (f.who || 'A member') : (req.forName || 'A member'), recipient: req.forSelf ? req.from : '', notes: String(f.notes != null ? f.notes : (req.note || '')).trim(), dates, dietary: [], meals: [] });
    if (saved && saved.id) await setCareRequestStatus(req.id, req.from, { status: 'approved', needId: saved.id });
    return saved;
  }
  function subscribeCareChat(reqId, cb) {
    if (!S() || !S().subscribeMany || !S().churchPub || !reqId) { cb([]); return () => {}; }
    const cp = S().churchPub, prefix = CARECHAT_D + reqId + ':', byId = new Map();
    const emit = () => { try { cb([...byId.values()].sort((a, b) => (a.at || 0) - (b.at || 0))); } catch (e) {} };
    const sub = S().subscribeMany([{ kinds: [30078], '#t': ['carechat'], '#church': [cp] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(prefix)) return; const id = d.slice(prefix.length); if (byId.has(id)) return; let b = null; try { b = S().openSealedFromPeer(JSON.parse(e.content), e.pubkey); } catch (x) {} if (!b || !b.text) return; byId.set(id, { id, from: e.pubkey, mine: e.pubkey === cp, at: b.at || e.created_at, text: String(b.text) }); emit(); },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch (e) {} };
  }
  async function sendCareChat(reqId, requesterPub, text) {
    if (!S() || !S().publishSigned || !S().churchPub || !reqId) return null;
    const body = String(text || '').trim(); if (!body) return null;
    const cp = S().churchPub; let team = [];
    try { const ev = await new Promise(res => { let best = null; const s = S().subscribeMany([{ kinds: [30078], '#d': [CARETEAM_D + cp] }], { onevent(e) { if (!best || e.created_at > best.created_at) best = e; }, oneose() { try { s.close(); } catch (x) {} res(best); } }); setTimeout(() => { try { s.close(); } catch (x) {} res(best); }, 4000); }); if (ev) { const o = JSON.parse(ev.content); if (Array.isArray(o.pubs)) team = o.pubs.filter(Boolean); } } catch (e) {}
    const sealed = S().sealToPubs([cp, requesterPub, ...team], { text: body, by: cp, at: now() });
    if (!sealed) return null;
    const tags = [['d', CARECHAT_D + reqId + ':' + Math.random().toString(36).slice(2, 10)], ['t', NET], ['t', 'carechat'], ['church', cp]];
    if (requesterPub) tags.push(['p', requesterPub]);
    return S().publishSigned({ kind: 30078, created_at: now(), tags, content: JSON.stringify(sealed) });
  }

  window.StewardMeals = {
    // settings
    subscribeSettings, setEnabled, cachedEnabled,
    // care-team recipient roster (for the "ask for help" seal)
    publishCareTeam,
    // "ask for help" requests (console side): triage / approve / decline / thread
    subscribeCareRequests, setCareRequestStatus, declineCareRequest, approveCareRequest, subscribeCareChat, sendCareChat,
    // needs
    publishNeed, removeNeed, subscribeNeeds, openNeed,   // openNeed exported so it is testable against the SHIPPED bundle
    // slots + skips (read slots; the steward can now WRITE skips to block a day for the recipient)
    subscribeSlots, subscribeSkips, skipDay, unskipDay,
    // care-team admin helper (client-side check)
    isCareAdmin,
    // d-tag prefixes — exposed so the relay accept() and member-side modules use the same constants
    SETTINGS_D, NEED_D, SLOT_D, SKIP_D,
  };
})();
