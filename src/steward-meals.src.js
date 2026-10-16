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

import { _absorbById } from './church-doc-store.src.js';   // one rule for who wins, shared with the app and the console
import { careThreadAttention } from '../scripts/care-thread-attention.mjs';   // which requests' threads need a steward

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
  const CAREAVAIL_D = NET + '/careavail:';   // + churchpub — a member's sealed "I'm here to help" listing (member-authored; member app: setCareAvail)
  const CARECHAT_D = NET + '/carechat:';     // + reqId:msgId — a message in the shared thread

  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => Math.floor(Date.now() / 1000);
  const _lastStampM = new Map();
  function _monotonicM(dtag) { const n = now(), last = _lastStampM.get(dtag) || 0, at = n > last ? n : last + 1; _lastStampM.set(dtag, at); return at; }

  // ---- settings (enabled, visibility, openedBy, adminGroupId) ----
  // Single church-signed doc at SETTINGS_D. The `enabled` flag also gates the steward nav item —
  // reading from the relay takes a round-trip, so we mirror it in localStorage per-church for instant
  // first-paint (same trick Finance uses).
  // WHICH CHURCH THIS CONSOLE IS READING. `Steward.churchPub` is the DEVICE's own church key. A delegated steward
  // (the owner of church 1 running church 2, or a volunteer running somebody else's church) keeps their own key
  // there and runs the other church as `Steward.actingChurch` (setActiveIdentity: `pub = tp; actingChurch = tp`,
  // churchPub untouched) — so reading `churchPub` read the delegate's OWN, empty church: the care switch showed
  // Off while the church had it On, and the Care page listed nothing (sim round 2, finding 35). Owners, and a
  // console viewing a network, have no actingChurch and get exactly what they got before. makeSub in
  // app/steward-root.jsx already files its cache under `actingChurch || churchPub`; this is the same rule.
  // Used for the settings, needs, slots and skips READS. The request/chat/careteam paths further down still
  // use churchPub: they mix "the church" with "me" and need a per-site decision (see publishCareTeam).
  const activeChurch = () => { const s = S(); return (s && (s.actingChurch || s.churchPub)) || ''; };
  const enKey = () => 'trinityone.meals.enabled.' + activeChurch();
  function cachedEnabled() { try { return localStorage.getItem(enKey()) === '1'; } catch (e) { return false; } }

  const DEFAULTS = { enabled: false, visibility: 'all', openedBy: 'steward', adminGroupId: '' };
  // THE CARE TEAM AS LAST READ, for publishCareTeam's locked-roster refusal when a caller does not name it.
  let _careTeamSeen = '';

  function subscribeSettings(cb) {
    if (!S() || !S().subscribeMany || !activeChurch()) { cb({ ...DEFAULTS }); return () => {}; }
    const cp = activeChurch();
    cb({ ...DEFAULTS, enabled: cachedEnabled() });   // paint immediately so the nav item is correct on first render
    const seen = { ts: 0, doc: { ...DEFAULTS } };
    const emit = () => { try { localStorage.setItem(enKey(), seen.doc.enabled ? '1' : '0'); } catch (e) {} cb({ ...seen.doc }); };
    const sub = S().subscribeMany(
      [{ kinds: [30078], authors: [cp], '#t': [NET] }, { kinds: [30078], '#church': [cp], '#t': [NET] }],
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
            _careTeamSeen = seen.doc.adminGroupId;
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
    // optional per-slot drop-off TIMES (owner 2026-10-16): key "<iso>" (day-level, e.g. a ride) or "<iso>:<meal>"
    // for a meals need; value "HH:MM". CLEAR like dates/meals (not PII), so an unkeyed member still sees when to
    // turn up. Bounded by `days` (<=90) x 3 meals.
    const timeOf = (s) => /^\d{2}:\d{2}$/.test(String(s || '')) ? String(s) : '';
    const slotTimes = Object.fromEntries(Object.entries((n.slotTimes && typeof n.slotTimes === 'object') ? n.slotTimes : {})
      .filter(([k, v]) => { const parts = String(k).split(':'); return isoDate(parts[0]) && days.includes(parts[0]) && (parts.length === 1 || (parts.length === 2 && MEALS_OK.includes(parts[1]))) && timeOf(v); })
      .map(([k, v]) => [k, timeOf(v)]));
    return {
      displayLabel: String(n.displayLabel || '').trim(),
      type,
      // One situation is one need, and a member may name several kinds of help for it. `type` stays FIRST
      // and stays the key every existing reader uses; `types` is added beside it, never in place of it.
      types: (Array.isArray(n.types) && n.types.length ? n.types : [type]).map(t => String(t || '').trim()).filter(Boolean).slice(0, 8),
      dates: days,
      meals,
      dayMeals,
      slotTimes,
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
    let ct = S().careSeal ? S().careSeal(sealed) : null;
    // A CONSOLE STILL SIGNING IN WAITS FOR ITS CARE KEY rather than refusing on the spot (a new church's first
    // minutes: the key follows the sign-in by a second or so). Only while the console is genuinely still setting up
    // (Steward.keysSettingUp) and only for a bounded time (waitForKey); a console that has signed in and read and
    // holds no key is refused at once, as before.
    if (!ct && S().keysSettingUp && S().keysSettingUp('care') && S().waitForKey) {
      try { await S().waitForKey('care', 12000); } catch (e) {}
      ct = S().careSeal ? S().careSeal(sealed) : null;
    }
    if (!ct) {
      // No care key on this device. Publishing the PII in the clear would silently reintroduce the finding,
      // so refuse and say why. careKeyChecked() distinguishes "still loading" from "genuinely absent", so the
      // steward gets an accurate reason rather than being sent somewhere that won't help.
      const looking = S().careKeyChecked && !S().careKeyChecked();
      // …and when a relay is what is holding the care key back, say which (Steward.keyWaitNote, audit of 3bc8905)
      let why = ''; try { why = S().keyWaitNote ? S().keyWaitNote('care') : ''; } catch (e) { why = ''; }
      // …and while the console is still signing in at all (a new church's first minutes) say THAT, not "connecting"
      // or "hasn't reached this device": nothing is wrong, and a retry in a moment will do (Steward.keysSettingUp).
      let settingUp = false; try { settingUp = !!(S().keysSettingUp && S().keysSettingUp('care')); } catch (e) { settingUp = false; }
      throw new Error(settingUp ? 'Setting up your church’s keys… try again in a moment.' : looking
        ? (why ? 'Still connecting to your church — ' + why + '.' : 'Still connecting to your church — give it a moment and try again.')
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
    // A REFUSED PUBLISH IS NOT A SAVED NEED, and this is where the 2026-09-04 fix to approveCareRequest was
    // built on sand. `publish()` in steward.src.js returns **false** at BOTH failure exits (no proven relay;
    // every relay rejected) — but this wrapped it as `{ id, ...rec, ts: false }`, which is truthy AND carries
    // an id. So `if (!saved || !saved.id)` never fired, the console said help was set up, and the asker's
    // request was marked approved pointing at a need that exists nowhere.
    //
    // Three different failure contracts live in this codebase and the wrapper is the trap: `publish()`
    // returns false, `_publishAny` in fellowship THROWS, and this used to return a truthy object around
    // either. Callers below: approveCareRequest here, and MealsNeedModal.save in app/stew-meals.jsx (both
    // handle null).
    if (!e) return null;
    return { id, ...rec, ts: e.created_at };
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
    if (!S() || !S().subscribeMany || !activeChurch()) { cb([]); return () => {}; }
    const cp = activeChurch();
    const byId = new Map();
    const versions = new Map();   // needId -> Map(author -> their copy); see src/church-doc-store.src.js
    // Deletion authority (mirrors the member client): when the church opens needs to ANY member, the relay lets
    // any member author a care: doc — so a member could publish a tombstone for SOMEONE ELSE's need and, since
    // the client keyed only on the d-tag, hide it from everyone. Only the church key, or the need's own author,
    // may retract it. When needs are steward/care-team-only the relay already gates every care: write, so any
    // tombstone that reaches us is authorised. Tracked per id so event order doesn't matter.
    const tombs = new Map();          // careId -> Set(pubkeys that published a deletion)
    let openedByMember = false;       // from the church-signed meals-settings (same sub — it's church-authored + NET-tagged)
    const delOk = (by, need) => !openedByMember || by === cp || by === S().churchPub || (!!need && need._by === by);
    const retracted = (id, need) => { const s = tombs.get(id); if (!s) return false; for (const by of s) { if (delOk(by, need)) return true; } return false; };
    const emit = () => cb([...byId.entries()].filter(([id, n]) => !retracted(id, n)).map(([, n]) => n).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || (a.ts || 0) - (b.ts || 0)));
    const sub = S().subscribeMany(
      [{ kinds: [30078], authors: [cp], '#t': [NET] }, { kinds: [30078], '#church': [cp], '#t': [NET] }],
      {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          // capture the church's openedBy so deletion authority can be judged (church-signed doc, same filters)
          if (d === SETTINGS_D) { if (e.pubkey === cp) { try { openedByMember = JSON.parse(e.content || '{}').openedBy === 'member'; emit(); } catch (x) {} } return; }
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
            // THE SURFACE THE CARE TEAM ACTUALLY WORKS FROM. This decided by arrival order while every phone
            // decided by the shared rule — so a steward could open a stale view of a meal train, edit it, and
            // republish stale dates and dietary notes as the newest write, pushing them to the whole church.
            // The nut-allergy mix-up, driven from the office. An audit found it after the commit that claimed
            // "care needs now follow the same rule as rotas": true on phones, untrue here.
            _absorbById(versions, byId, id, { id, ..._normNeed(opened), _sealed: !!opened._sealed, _by: e.pubkey, ts: e.created_at });
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
    if (!S() || !S().subscribeMany || !activeChurch()) { cb([]); return () => {}; }
    const byKey = new Map();   // key = needId|isoDate|pubkey   (one entry per member-per-(need,date))
    const emit = () => cb([...byKey.values()]);
    const sub = S().subscribeMany(
      [{ kinds: [30078], '#church': [activeChurch()], '#t': [NET] }],
      {
        onevent(e) {
          const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
          if (!d.startsWith(prefix)) return;
          const rest = d.slice(prefix.length).split(':');
          const needId  = rest[0] || '';
          const isoDate = rest[1] || '';
          const meal    = rest[2] || '';   // per-meal slot identity; '' = legacy whole-day slot and every skip
          if (!needId || !isoDate) return;
          const key = needId + '|' + isoDate + '|' + meal + '|' + e.pubkey;
          const deleted = e.tags.some(t => t[0] === 'deleted') || !e.content;
          if (deleted) { byKey.delete(key); emit(); return; }
          try {
            const obj = JSON.parse(e.content || '{}');
            byKey.set(key, { needId, isoDate, meal, pubkey: e.pubkey, ts: e.created_at, ...normalise(obj) });
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
  // WHILE THE CHILDREN LIST CANNOT BE READ, the newest list asked for waits here and is retried (see below).
  // CARRIES THE CHURCH IT WAS ASKED FOR (re-audit of 0eb3cf9): a key restore or identity switch changes churchPub
  // without a reload, and a retry holding only the people list published church A's carers as church B's care
  // list. A retry for a church we are no longer on is dropped, and the console's church reset drops it at once.
  const _careTeamWait = { pubs: null, cp: '', tries: 0, timer: 0 };
  function dropPendingCareTeam() { try { if (_careTeamWait.timer) clearTimeout(_careTeamWait.timer); } catch (e) {} _careTeamWait.timer = 0; _careTeamWait.pubs = null; _careTeamWait.cp = ''; _careTeamWait.tries = 0; }
  // `opts.team` — the care team the list was built from (callers that know it pass it); `opts.fromList` — the list
  // came from careteam: itself, not from a roster (refreshCareTeam), so a locked roster has no bearing on it.
  async function publishCareTeam(memberPubs, opts) {
    if (!S() || !S().publishSigned || !S().churchPub) return null;
    // NEVER FROM A ROSTER THIS CONSOLE CANNOT READ (the roster wipe, 2026-10-12). A locked roster reaches the screens
    // as an EMPTY team, so the list handed in here would name nobody and seal every member's ask for help to the
    // church alone. `false` is "not published", which Block reports and the care panel retries on its next change.
    const team = (opts && opts.team) || _careTeamSeen;
    if (!(opts && opts.fromList) && team && S().rosterLocked && S().rosterLocked(team)) return false;
    // A DELEGATED CONSOLE DOES NOT PUBLISH THIS. `cp` below is `churchPub` — the delegate's own key, not the church
    // they are running — so the document would be d-tagged to a key that is nobody's church. It was never reached
    // while a delegate's care switch read Off (the panel's effect is gated on it); now that the switch tells the
    // truth the effect runs, and this keeps it a no-op exactly as it was.
    if (S().actingChurch) return null;
    const cp = S().churchPub;
    // NEVER A CHILD (owner, 2026-10-10: a child is never on the care team, whatever the roster says). The relay
    // refuses a child every care-team read; this keeps members' phones from SEALING a new ask for help to them.
    // The roster picker is the generic one and rightly offers children for other teams, so the filter lives here,
    // at the one door this document is written through, and it READS THE CHILDREN LIST FROM THE RELAY ITSELF
    // (Steward.readMinors) — not a copy some screen may or may not have loaded (audit of 8fb38d9).
    //
    // IF THE LIST CANNOT BE READ, NOTHING IS PUBLISHED, and this says so with `false` (Block reports a false as
    // "the care team's list" not updating). Publishing anyway could seal asks to a child; publishing nobody would
    // silently empty the care team. The list the relay already holds stays in force. "Cannot be read" means no
    // relay answered while we were logged in — when the publish itself would almost certainly fail too — so the
    // newest list asked for is kept and retried every 20 s for five minutes, latest ask wins, and the next roster
    // save, Block, or child marking tries again after that. Adults are never held back by a church that has no
    // children: a relay that answers "no such document" while we are logged in is a known, empty list.
    const m = S().readMinors ? await S().readMinors() : null;
    if (!S() || S().churchPub !== cp || S().actingChurch) return null;   // the church changed while we read: not ours to publish
    if (!m || !m.known) {
      _careTeamWait.pubs = memberPubs || []; _careTeamWait.cp = cp; _careTeamWait.tries = 0; _careTeamWait.opts = opts;
      if (!_careTeamWait.timer) {
        const again = () => {
          _careTeamWait.timer = 0;
          const pending = _careTeamWait.pubs; if (!pending || ++_careTeamWait.tries > 15) return;
          if (!S() || S().actingChurch || S().churchPub !== _careTeamWait.cp) { dropPendingCareTeam(); return; }   // asked for another church
          const tries = _careTeamWait.tries;
          publishCareTeam(pending, _careTeamWait.opts).then((r) => {
            _careTeamWait.tries = tries;   // a failed retry must not reset the count it is counting
            if (r === false && _careTeamWait.pubs === pending && !_careTeamWait.timer) _careTeamWait.timer = setTimeout(again, 20000);
          }, () => {});
        };
        _careTeamWait.timer = setTimeout(again, 20000);
      }
      return false;
    }
    _careTeamWait.pubs = null; _careTeamWait.cp = '';
    const minors = new Set(m.list.map(p => String(p || '').toLowerCase()));
    // NEVER SOMEONE THIS CONSOLE HOLDS AS BLOCKED (owner, 2026-10-02: blocking removes someone from the care list).
    // The one door this document is written through — Block, the roster editor (publishCareTeamFor) and the Care
    // settings panel's effect, which republishes from whatever roster it last saw — so a stale roster cannot put
    // them back. Members' phones seal every new ask for help to this list.
    const blocked = new Set(((S().blockedHere && S().blockedHere()) || []).map(p => String(p || '').toLowerCase()));
    const pubs = [...new Set([cp, ...((memberPubs || []).map(p => String(p || '').trim().toLowerCase()).filter(p => p && !blocked.has(p) && !minors.has(p)))])];
    return S().publishSigned({ kind: 30078, created_at: now(), tags: [['d', CARETEAM_D + cp], ['t', NET]], content: JSON.stringify({ pubs, updated: now() }) });
  }

  // TAKE ANY CHILD OFF THE CARE LIST THE RELAY HOLDS NOW. Called by Steward.setMinors after a children list lands,
  // because the care list is otherwise republished only when the roster changes — a person marked as a child
  // AFTER being put on the care team stayed on it (audit of 8fb38d9). Reads both documents from the relay and
  // republishes only when the stored list actually names a child; the republish goes through publishCareTeam,
  // so the same children read and the same "cannot read -> do not publish" rule apply.
  async function refreshCareTeam() {
    if (!S() || !S().subscribeMany || !S().churchPub || S().actingChurch) return null;
    const cp = S().churchPub;
    const cur = await new Promise((res) => {
      let best = null, done = false, sub = null;
      const fin = () => { if (done) return; done = true; try { sub && sub.close(); } catch (x) {} res(best); };
      try {
        sub = S().subscribeMany([{ kinds: [30078], authors: [cp], '#d': [CARETEAM_D + cp] }], {
          onevent(e) { if (e.pubkey !== cp) return; if (!best || e.created_at > best.created_at) best = e; },
          oneose: fin,
        });
      } catch (x) { fin(); return; }
      setTimeout(fin, 5000);
    });
    if (!cur) return null;
    let pubs = []; try { pubs = (JSON.parse(cur.content || '{}').pubs || []).map(p => String(p || '').toLowerCase()); } catch (x) { return null; }
    const m = S().readMinors ? await S().readMinors() : null;
    if (!m || !m.known) return false;
    const minors = new Set(m.list);
    if (!pubs.some(p => minors.has(p))) return null;   // nothing to take off
    return publishCareTeam(pubs.filter(p => p !== cp), { fromList: true });
  }

  // ---- "Ask for help" requests (console/owner side): triage, approve into a need, chat ----
  // The owner console holds the church key and is on the care-team roster, so requests sealed to the church
  // unwrap via S().openSealedFromPeer. (A delegated steward who isn't in the roster can't decrypt — they use
  // the members app as a care-admin, or are added to the care team.)
  function subscribeCareRequests(cb) {
    if (!S() || !S().subscribeMany || !S().churchPub) { cb([]); return () => {}; }
    const cp = S().churchPub; const byId = new Map(), statusById = new Map(), tomb = new Map();
    // THE THREAD, AS FAR AS ATTENTION GOES: reqId -> msgId -> { from, at } for every message this console can OPEN.
    // Sim item 24: a request left the console's list the moment "Set up help" (or Close) wrote its status, and
    // took its only Message button with it, so a member who kept writing was heard by nobody. Each request is now
    // emitted with `newMessage` — true when it was set up or closed and the ASKER has written since, with no
    // team reply after that — decided by careThreadAttention, the one place that rule lives. Only a message the
    // console can decrypt counts, exactly as subscribeCareChat shows only those: a stranger's event at somebody's
    // d-tag cannot make a request look unanswered or answered.
    const chat = new Map();
    const emit = () => { try { cb([...byId.values()].map(r => {
      const s = statusById.get(r.id) || {}; const status = s.status || 'open';
      let askerAt = 0, teamAt = 0;
      for (const m of (chat.get(r.id) || new Map()).values()) { if (m.from === r.from) askerAt = Math.max(askerAt, m.at); else teamAt = Math.max(teamAt, m.at); }
      const att = careThreadAttention({ status, statusTs: s._ts || 0, askerAt, teamAt });
      return { ...r, status, needId: s.needId || '', newMessage: att.returned };
    }).sort((a, b) => (b.at || 0) - (a.at || 0))); } catch (e) {} };
    const sub = S().subscribeMany([{ kinds: [30078], '#t': ['carereq', 'carereqstatus'], '#church': [cp] }, { kinds: [30078], '#t': ['carechat'], '#church': [cp] }], {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d.startsWith(CARECHAT_D)) {
          const rest = d.slice(CARECHAT_D.length), at = rest.lastIndexOf(':'); if (at < 1) return;
          const rid = rest.slice(0, at), mid = rest.slice(at + 1);
          let b = null; try { b = S().openSealedFromPeer(JSON.parse(e.content), e.pubkey); } catch (x) {}
          if (!b || !b.text) return;
          let m = chat.get(rid); if (!m) { m = new Map(); chat.set(rid, m); }
          if (m.has(mid)) return;
          m.set(mid, { from: e.pubkey, at: e.created_at || 0 }); emit(); return;
        }
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
  // ---- "I'm here to help" availability (console side): who has offered to help ----
  // The member app writes one doc per member (setCareAvail, src/fellowship.src.js): d=careavail:<churchPub>,
  // tagged ['church', cp], member-signed, SEALED under the church name key. Before this reader NO console
  // surface showed it. Opening goes through Steward.openChurchDoc (the name-key ring); null = sealed and the
  // key has not arrived — LEAVE the person as they are (never delete on null) and retry when the ring changes,
  // exactly as the member-side subscribeCareAvail does. Emits [{ pubkey, tags, note, dates, ts }] (dates = {from,to} or null). Minors are NOT
  // filtered here — the surface does it (it holds the children list); this is a plain reader.
  function careAvailDates(d) {
    if (!d || typeof d !== 'object') return null;
    const f = String(d.from || ''), t = String(d.to || ''), re = /^\d{4}-\d{2}-\d{2}$/;
    return re.test(f) && re.test(t) && f <= t ? { from: f, to: t } : null;
  }
  function subscribeCareAvail(cb) {
    const cp = activeChurch();
    if (!S() || !S().subscribeMany || !cp || !S().openChurchDoc) { cb([]); return () => {}; }
    const dtag = CAREAVAIL_D + cp;
    const byPub = new Map(), seenTs = new Map(), locked = new Map();
    let eosed = false;   // sticky: do not blank on a transient empty before EOSE
    const emit = () => { const v = [...byPub.values()]; if (!eosed && !v.length) return; try { cb(v); } catch (e) {} };
    const handlers = {
      onevent(e) {
        const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (d !== dtag) return;
        const at = e.created_at || 0;
        if ((seenTs.get(e.pubkey) || 0) > at) return;   // a lagging older copy must not resurrect/replace
        if (e.tags.some(t => t[0] === 'deleted') || !e.content) { seenTs.set(e.pubkey, at); locked.delete(e.pubkey); byPub.delete(e.pubkey); emit(); return; }
        let o = null; try { o = S().openChurchDoc(e.content); } catch (x) { return; }
        if (o === null) { locked.set(e.pubkey, e); return; }   // key not here yet — leave as-is, retried on key arrival
        seenTs.set(e.pubkey, at); locked.delete(e.pubkey);
        if (!o.available) { byPub.delete(e.pubkey); emit(); return; }
        byPub.set(e.pubkey, { pubkey: e.pubkey, tags: Array.isArray(o.tags) ? o.tags : [], note: String(o.note || '').trim(), dates: careAvailDates(o.dates), ts: at });
        emit();
      },
      oneose() { eosed = true; if (byPub.size) emit(); },
    };
    const sub = S().subscribeMany([{ kinds: [30078], '#church': [cp], '#d': [dtag] }], handlers);
    const stopKey = S().onNameKeyRing ? S().onNameKeyRing(() => { for (const e of [...locked.values()]) handlers.onevent(e); }) : () => {};
    return () => { try { sub.close(); } catch (e) {} try { stopKey(); } catch (e) {} };
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
    // TWO PUBLISHES, AND THE SECOND CAN FAIL ON ITS OWN. The need goes up, then the request is marked
    // approved. If only the first lands, help IS set up but the request still reads "open" — the team works
    // it twice and the asker is never told. Report which half, rather than reporting the need alone.
    if (!saved || !saved.id) return saved;
    const st = await setCareRequestStatus(req.id, req.from, { status: 'approved', needId: saved.id });
    return { ...saved, stillOpen: !st };
  }
  function subscribeCareChat(reqId, cb) {
    if (!S() || !S().subscribeMany || !S().churchPub || !reqId) { cb([]); return () => {}; }
    const cp = S().churchPub, prefix = CARECHAT_D + reqId + ':', byId = new Map();
    const emit = () => { try { cb([...byId.values()].sort((a, b) => (a.at || 0) - (b.at || 0))); } catch (e) {} };
    const sub = S().subscribeMany([{ kinds: [30078], '#t': ['carechat'], '#church': [cp] }], {
      onevent(e) { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (!d.startsWith(prefix)) return; const id = d.slice(prefix.length); if (byId.has(id)) return; let b = null; try { b = S().openSealedFromPeer(JSON.parse(e.content), e.pubkey); } catch (x) {} if (!b || (!b.text && !b.reaction)) return; const entry = { id, from: e.pubkey, mine: e.pubkey === cp, at: b.at || e.created_at }; if (b.text) entry.text = String(b.text); if (b.reaction) entry.reaction = String(b.reaction); if (b.replyTo) entry.replyTo = String(b.replyTo); byId.set(id, entry); emit(); },
      oneose() { emit(); },
    });
    return () => { try { sub.close(); } catch (e) {} };
  }
  async function sendCareChat(reqId, requesterPub, text, opts) {
    if (!S() || !S().publishSigned || !S().churchPub || !reqId || !requesterPub) return null;
    const body = String(text || '').trim();
    const reaction = opts && opts.reaction ? String(opts.reaction) : '';
    const replyTo = opts && opts.replyTo ? String(opts.replyTo) : '';
    if (!body && !reaction) return null;
    const cp = S().churchPub;
    // WHO A REPLY REACHES IS DECIDED BY THE REQUEST, NOT BY WHO IS TYPING — and the console is a sender too.
    // This used to seal to the care-team roster, so a steward answering a young person's request produced a
    // message the cleared youth worker handling it could not open, and wrapped the exchange for the whole care
    // rota. The member app had the identical defect; both are fixed the same way and must stay in step.
    // The request's envelope is { keys: { pubkey: wrapped }, enc } — its recipient list is in the event in
    // clear, so reuse it and the thread reaches exactly whoever the request reached.
    // NO FALLBACK to the roster: falling back is the bug, and a silent wide seal on a child's thread is worse
    // than a send that visibly fails.
    let audience = null, teamThread = false;
    try {
      const ev = await new Promise(res => {
        let best = null;
        const s = S().subscribeMany([{ kinds: [30078], '#d': [CAREREQ_D + reqId] }], {
          // ONLY THE ASKER'S OWN COPY. The relay lets an ordinary member publish a carereq: at somebody else's
          // d-tag, and this console reads EVERY request — so without an author check it is the surface most
          // reliably fed a forgery. See the member-side note in src/fellowship.src.js.
          onevent(e) { if (requesterPub && e.pubkey !== requesterPub) return; if (!best || e.created_at > best.created_at) best = e; },
          oneose() { try { s.close(); } catch (x) {} res(best); },
        });
        setTimeout(() => { try { s.close(); } catch (x) {} res(best); }, 4000);
      });
      if (ev) {
        const o = JSON.parse(ev.content || '{}');
        if (o && o.keys && typeof o.keys === 'object') { const l = Object.keys(o.keys).filter(Boolean); if (l.length) audience = l; }
        // The asker records WHICH rule chose the audience. 'team' means an ordinary adult request, and those
        // also reach whoever is on the care rota now — otherwise a care member who joined after the request
        // was opened silently cannot read new replies. A young person's thread is never widened. A request
        // written before this tag existed has no tag and stays narrow, which is the safe direction.
        teamThread = (((ev.tags || []).find(t => t[0] === 'aud') || [])[1] || '') === 'team';
      }
    } catch (e) {}
    if (!audience) return null;
    let extra = [];
    if (teamThread) {
      try {
        const ev2 = await new Promise(res => {
          let best = null;
          const s2 = S().subscribeMany([{ kinds: [30078], '#d': [CARETEAM_D + cp] }], {
            onevent(e) { if (e.pubkey !== cp) return; if (!best || e.created_at > best.created_at) best = e; },
            oneose() { try { s2.close(); } catch (x) {} res(best); },
          });
          setTimeout(() => { try { s2.close(); } catch (x) {} res(best); }, 4000);
        });
        if (ev2) { const o2 = JSON.parse(ev2.content || '{}'); if (Array.isArray(o2.pubs)) extra = o2.pubs.filter(Boolean); }
      } catch (e) {}
    }
    // …minus anyone this console holds as blocked: the request may have been sealed to them before the block.
    const blockedNow = new Set(((S().blockedHere && S().blockedHere()) || []).map(p => String(p || '').toLowerCase()));
    // …and minus any CHILD of this church (owner 2026-10-10: a child is never on the care team) — the request
    // may have been sealed to one who was on the care list then, and the current care list may still name one.
    // The ASKER is kept even if they are a child: it is their own thread. Read from the relay, as publishCareTeam
    // does. If the children list cannot be read the reply still goes — the relay refuses a child every care
    // thread read (careAdmin), and a care reply silently not sending is its own harm — but only to the request's
    // original audience, never widened to the current care list.
    const mk = S().readMinors ? await S().readMinors().catch(() => null) : null;
    const kids = new Set(((mk && mk.known && mk.list) || []).map(p => String(p || '').toLowerCase()));
    const askerHex = String(requesterPub || '').toLowerCase();
    if (!(mk && mk.known)) extra = [];
    const toPubs = [...audience, ...extra].filter(p => { const h = String(p || '').toLowerCase(); return !blockedNow.has(h) && (h === askerHex || !kids.has(h)); });
    const msgId = Math.random().toString(36).slice(2, 10);
    const dtag = CARECHAT_D + reqId + ':' + msgId;
    const at = _monotonicM(dtag);
    const payload = { by: cp, at };
    if (body) payload.text = body;
    if (reaction) payload.reaction = reaction;
    if (replyTo) payload.replyTo = replyTo;
    const sealed = S().sealToPubs([...toPubs, cp], payload);
    if (!sealed) return null;
    const tags = [['d', dtag], ['t', NET], ['t', 'carechat'], ['church', cp]];
    if (requesterPub) tags.push(['p', requesterPub]);
    return S().publishSigned({ kind: 30078, created_at: at, tags, content: JSON.stringify(sealed) });
  }

  window.StewardMeals = {
    // settings
    subscribeSettings, setEnabled, cachedEnabled,
    // WHICH TEAM IS THE CARE TEAM, as last read from the settings document. Steward.removeTeam asks this
    // so its refusal to delete the care team does not depend on a caller passing the id in (owner,
    // 2026-10-13, "CARE TEAM CANNOT BE DELETED"). '' until subscribeSettings has had an answer.
    careTeamId: () => _careTeamSeen,
    // care-team recipient roster (for the "ask for help" seal)
    publishCareTeam, refreshCareTeam, dropPendingCareTeam,
    // "ask for help" requests (console side): triage / approve / decline / thread
    subscribeCareRequests, subscribeCareAvail, setCareRequestStatus, declineCareRequest, approveCareRequest, subscribeCareChat, sendCareChat,
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
