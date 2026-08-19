// mydata.src.js -- user-owned data (bundled -> vendor/mydata.js).
//
// SPINE: the user's key is their portable database. Two backends behind ONE interface
// (getDoc/putDoc): LocalBackend (synchronous on-device working copy) and NostrBackend, which
// WRAPS the local copy and adds encrypted publish + multi-device sync on top -- so the API
// above the backend line, and every screen, are unchanged. Per the approved proposal
// (reference/proposal-mydata-nostr-backend.md): uniform NIP-78 (kind 30078) docs, NIP-44
// encryption for private types (notes/journal/prayer), item-merge + tombstone reconciliation,
// key from window.TrinityIdentity, relays from window.Fellowship. Relays are sync; the local
// copy stays authoritative. Web ephemeral identity -> local-only (sync no-ops gracefully).
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { v2 as nip44 } from 'nostr-tools/nip44';

// ---------------------------------------------------------------------------
// Backend interface (the swap point). LOCAL implementation only this slice.
//   getDoc(key) -> value | null        putDoc(key, value) -> void
// A "doc" is a whole collection (an array) or the settings object. The future
// NostrBackend maps each doc key to a replaceable event (kind 30078, d=key),
// encrypting private docs -- same two methods, async-capable later.
// ---------------------------------------------------------------------------
function LocalBackend(ns) {
  var prefix = ns + ':';
  return {
    kind: 'local',
    getDoc: function (key) {
      try { var v = localStorage.getItem(prefix + key); return v == null ? null : JSON.parse(v); }
      catch (e) { return null; }
    },
    putDoc: function (key, value) {
      try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch (e) {}
    },
  };
}

// ---------------------------------------------------------------------------
// NostrBackend: wraps a LocalBackend `cache` and syncs it to relays.
//   - getDoc(key)        -> from the cache (synchronous, unchanged behavior)
//   - putDoc(key, value) -> write cache (sync) + track tombstones + queue an encrypted publish
//   - startSync(onChange)-> derive the key, pull + reconcile, then publish local up (migration)
// Each synced doc is a replaceable NIP-78 event (kind 30078, addressed by a `d` tag).
// ---------------------------------------------------------------------------
function NostrBackend(cache) {
  var KIND = 30078;
  // docKey -> { d: tag, priv: encrypt with NIP-44 }
  // SECURITY-AUDIT-2026-07-20 C1 (CRITICAL): highlights/bookmarks/settings used to publish priv:false —
  // signed, timestamped, PLAINTEXT, fanned out to every relay in the pool. accept() requires isMember to
  // write a kind-30078, so the AUTHORS of these docs are BY CONSTRUCTION the church's members: one
  // anonymous REQ for #d=trinityone/highlights returned a list of every member pubkey (plus which verses
  // each highlighted, and when). That is the same arrest list the 07-13 roster gate removed, re-exposed
  // through a d-tag nobody thought of as sensitive. settings compounded it by carrying plansFollowed —
  // church-published plan ids, which bind a pubkey to a SPECIFIC congregation.
  // Nothing is lost by encrypting: pull() only ever reads authors:[pub] — your own docs — and no other
  // code in the tree subscribes to these d-tags. The relay-side default-deny gate (ea203ec) is the other
  // half of this fix; encrypting here means a non-enforcing relay in the pool can't leak them either.
  var SYNC = {
    'data/highlights': { d: 'trinityone/highlights', priv: true  },
    'data/bookmarks':  { d: 'trinityone/bookmarks',  priv: true  },
    'data/notes':      { d: 'trinityone/notes',      priv: true  },
    'data/journal':    { d: 'trinityone/journal',    priv: true  },
    'data/prayer':     { d: 'trinityone/prayer',     priv: true  },
    'settings':        { d: 'trinityone/settings',   priv: true  },
    // F17 (AUDIT-2026-07-28), fixed 2026-07-30. Which messages you have already read — {groupId: unixSeconds},
    // about 20 bytes per group. It lived ONLY in localStorage under trinityone.chatSeen, and the locked-boot
    // wipe deletes it, so setting a PIN made every conversation read as unread again for ever, with nothing
    // able to restore it.
    //
    // Synced here so it can come BACK after an unlock. It is NOT made wipe-exempt like notes/journal: the map
    // is keyed by group SLUG ('prayer', 'youth', 'life'), and the wipe also clears the cached group documents
    // — so keeping this on the device would hand a seized locked phone the church's group names, which is
    // precisely what that wipe exists to prevent. Wiped locally, restored from the relay. See the explicit
    // carve-out in clearCommunityCache (src/fellowship.src.js).
    'data/chatseen':   { d: 'trinityone/chatseen',  priv: true  },
  };
  var D_TO_KEY = {};
  Object.keys(SYNC).forEach(function (k) { D_TO_KEY[SYNC[k].d] = k; });

  var pool = new SimplePool();
  var sk = null, pub = null, ck = null;
  // REVIEW-2026-07-20 B2 (data loss): this backend owns its OWN SimplePool, separate from Fellowship's, and
  // never set an auth handler — so it could not answer a NIP-42 challenge. That was harmless while these
  // docs were world-readable, but the relay's read gate is now default-deny and the only rule that serves
  // them is "you may read your own events", which REQUIRES auth. Without this the pull() below silently
  // returns zero events and startSync then republishes the local view over the relay's copy — so a second
  // device, or one that had been cleared, would overwrite the richer remote notes/journal/highlights.
  // Did the pool answer a NIP-42 challenge during the current pull()? If it did but we still received
  // nothing, the pull is INCONCLUSIVE (a default-deny replay may still be in flight), and pushing the local
  // view up would risk overwriting the richer remote — see pull()/startSync below.
  var _pullAuthed = false;
  var _onPullAuth = null;   // pull() installs a hook so a challenge landing after EOSE can extend its window
  pool.automaticallyAuth = function () {
    return async function (authEvent) {
      if (!sk) throw new Error('mydata: no key');
      _pullAuthed = true;
      if (_onPullAuth) { try { _onPullAuth(); } catch (e) {} }
      return finalizeEvent(authEvent, sk);
    };
  };
  var timers = {};
  var onChange = function () {};

  function relays() { return (window.Fellowship && window.Fellowship.relays) || ['ws://127.0.0.1:7447']; }
  function tombKey(key) { return 'tomb/' + key; }
  function idset(arr) { var s = new Set(); (arr || []).forEach(function (it) { if (it && it.id != null) s.add(it.id); }); return s; }
  function encode(key, payload) { var j = JSON.stringify(payload); return SYNC[key].priv ? nip44.encrypt(j, ck) : j; }
  // Read BOTH shapes, write only the encrypted one. Members already have plaintext highlights/bookmarks/
  // settings docs sitting on relays from before they were made private; a decrypt-only reader would throw
  // on those and silently drop the member's own data. A NIP-44 ciphertext is base64 and never starts with
  // '{', so the payload is self-identifying. The next publish() rewrites the doc encrypted, so this
  // tolerance ages out on its own — same read-old/write-new migration as the NIP-04→NIP-44 DM change.
  function decode(key, content) {
    var s = String(content || '');
    var plain = s.charAt(0) === '{';   // legacy cleartext payload
    var j = (SYNC[key].priv && !plain) ? nip44.decrypt(s, ck) : s;
    return JSON.parse(j);
  }

  function schedulePublish(key) {
    if (!sk || !SYNC[key]) return;
    clearTimeout(timers[key]);
    timers[key] = setTimeout(function () { publish(key); }, 800);
  }
  function publish(key) {
    if (!sk || !SYNC[key]) return;
    var doc = cache.getDoc(key);
    if (doc == null) return;
    var payload = Array.isArray(doc) ? { items: doc, deleted: cache.getDoc(tombKey(key)) || [] } : { settings: doc };
    var evt = finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['d', SYNC[key].d]], content: encode(key, payload) }, sk);
    try { Promise.any(pool.publish(relays(), evt)).catch(function () {}); } catch (e) { /* offline: local stays authoritative */ }
  }

  // merge a remote payload into the local cache; returns true if local changed
  function reconcile(key, payload) {
    if (payload && ('items' in payload)) {
      var local = cache.getDoc(key) || [];
      var tomb = new Set((cache.getDoc(tombKey(key)) || []).concat(payload.deleted || []));
      var byId = new Map();
      // local first, then remote: keep the newer-by-ts; skip tombstoned ids
      local.concat(payload.items || []).forEach(function (it) {
        if (!it || it.id == null || tomb.has(it.id)) return;
        var ex = byId.get(it.id);
        if (!ex || (it.ts || 0) >= (ex.ts || 0)) byId.set(it.id, it);
      });
      var merged = Array.from(byId.values());
      var before = JSON.stringify(cache.getDoc(key)) + '|' + JSON.stringify(cache.getDoc(tombKey(key)));
      cache.putDoc(key, merged);
      cache.putDoc(tombKey(key), Array.from(tomb));
      var localChanged = (JSON.stringify(merged) + '|' + JSON.stringify(Array.from(tomb))) !== before;
      // converge: if our merged view differs from what the relay had, republish
      var remoteSame = JSON.stringify(merged) === JSON.stringify(payload.items || []) &&
                       JSON.stringify(Array.from(tomb)) === JSON.stringify(payload.deleted || []);
      if (!remoteSame) schedulePublish(key);
      return localChanged;
    }
    // MAP-SHAPED payload (as opposed to the list shape above). The wire field stays named `settings` for
    // backwards compatibility — every already-published map doc on every relay uses it — but the CACHE KEY is
    // now the key we were actually passed.
    //
    // It used to be hardcoded to the literal 'settings' and ignored `key`, which was invisible while
    // `settings` was the only map-shaped doc. The moment a second one existed (chatseen, 2026-07-30) its
    // remote copy would have been merged into SETTINGS and the doc it belonged to would never have restored —
    // silently, because reconcile returns a boolean and nothing downstream compares keys. Found before
    // shipping the second one, by reading this branch rather than trusting it.
    if (payload && payload.settings) {
      var cur = cache.getDoc(key) || {};
      var next = Object.assign({}, payload.settings, cur); // local wins (never lose a local pref)
      cache.putDoc(key, next);
      if (JSON.stringify(next) !== JSON.stringify(payload.settings)) schedulePublish(key);
      return JSON.stringify(next) !== JSON.stringify(cur);
    }
    return false;
  }

  function pull() {
    return new Promise(function (resolve) {
      var touched = false, done = false, eosed = false, evCount = 0, closed = false, idleT = null;
      _pullAuthed = false;
      // Resolve a RESULT, not just `touched`: `inconclusive` = we answered a challenge but received nothing,
      // which under default-deny can mean the replay was still in flight rather than the remote being empty.
      var finish = function () { if (done) return; done = true; _onPullAuth = null; if (touched) onChange(); resolve({ touched: touched, inconclusive: _pullAuthed && evCount === 0 }); };
      var closeNow = function () { if (closed) return; closed = true; clearTimeout(idleT); try { sub.close(); } catch (e) {} finish(); };
      var scheduleClose = function (ms) { if (closed) return; clearTimeout(idleT); idleT = setTimeout(closeNow, ms); };
      // A challenge that lands AFTER the first (unauth) EOSE means the replay is coming — hold the sub open.
      _onPullAuth = function () { if (eosed) scheduleClose(4000); };
      var sub = pool.subscribeMany(relays(), [{ kinds: [KIND], authors: [pub], '#d': Object.keys(D_TO_KEY) }], {
        onevent: function (e) {
          evCount++;
          var dTag = (e.tags.find(function (t) { return t[0] === 'd'; }) || [])[1];
          var key = D_TO_KEY[dTag];
          if (key) try {
            if (reconcile(key, decode(key, e.content))) touched = true;
            // C1: a legacy CLEARTEXT copy is still sitting on the relay. reconcile() only republishes when
            // the merged view differs, so an unchanged doc would leave the plaintext (and the membership
            // signal it carries) there indefinitely. Force one encrypted rewrite over the top of it.
            if (SYNC[key].priv && String(e.content || '').charAt(0) === '{') schedulePublish(key);
          }
          catch (err) { console.warn('[mydata] reconcile failed', dTag, err); }
          if (eosed) scheduleClose(1500);   // replayed events are arriving post-EOSE — keep the window rolling
        },
        // REVIEW-2026-07-20 B2, second half: closing on EOSE races NIP-42. Under default-deny the relay
        // withholds our docs from the unauthenticated REQ, sends EOSE, THEN challenges — and its post-AUTH
        // replay only walks subscriptions that are still open. A fixed 1.5s hold gambled on that replay
        // (2+ RTTs + a signature) landing in time, which it doesn't on the 2G links this targets. Instead:
        // hold short if events already came, generously if none have (the auth replay is still in flight),
        // roll the window on every replayed event, and cap at 8s.
        oneose: function () { eosed = true; scheduleClose(evCount ? 1200 : 3500); },
      });
      setTimeout(closeNow, 8000); // hard cap — resolve even if a relay never sends EOSE or the replay never lands
    });
  }

  return {
    kind: 'nostr',
    getDoc: function (key) { return cache.getDoc(key); },
    putDoc: function (key, value) {
      if (SYNC[key] && Array.isArray(value)) {
        var prev = cache.getDoc(key) || [];
        var nextIds = idset(value);
        var removed = [];
        idset(prev).forEach(function (id) { if (!nextIds.has(id)) removed.push(id); });
        if (removed.length) {
          var tomb = cache.getDoc(tombKey(key)) || [];
          cache.putDoc(tombKey(key), Array.from(new Set(tomb.concat(removed))));
        }
      }
      cache.putDoc(key, value);
      schedulePublish(key);
    },
    // derive key, pull + reconcile, then publish local docs up (migration). false = local-only.
    startSync: function (notify) {
      onChange = notify || function () {};
      var ID = window.TrinityIdentity;
      var ready = (ID && ID.ready) ? Promise.resolve(ID.ready) : Promise.resolve();
      return ready.then(function () {
        return ID && ID.exportMnemonic ? ID.exportMnemonic() : null;
      }).then(function (mnemonic) {
        if (!mnemonic) return false; // no persistent identity (e.g. web ephemeral) -> local only
        sk = privateKeyFromSeedWords(mnemonic);
        pub = getPublicKey(sk);
        ck = nip44.utils.getConversationKey(sk, pub);
        return pull().then(function (r) {
          // The local→remote migration push (encrypt legacy cleartext / seed a fresh relay). Skip it when
          // the pull was INCONCLUSIVE — we authenticated but received nothing, which under default-deny can
          // mean the replay was still in flight, not that the remote is empty. Republishing the local view
          // then would overwrite the richer remote notes/journal/highlights (the B2 data-loss). A genuinely
          // empty remote (open relay, or an authed pull whose replay completed with nothing) still pushes,
          // and any later local edit publishes normally regardless.
          if (!(r && r.inconclusive)) { Object.keys(SYNC).forEach(function (k) { if (cache.getDoc(k) != null) schedulePublish(k); }); }
          return true;
        });
      }).catch(function (e) { console.warn('[mydata] startSync failed', e); return false; });
    },
  };
}

// ---------------------------------------------------------------------------
// Schema: each TYPE is a list of items { id, visibility, ts, ...payload }.
// ---------------------------------------------------------------------------
var SCHEMA = {
  highlights: { label: 'Highlights',       icon: 'marker',   visibility: 'public'  },
  bookmarks:  { label: 'Bookmarks',        icon: 'bookmark', visibility: 'public'  },
  notes:      { label: 'Notes',            icon: 'pen',      visibility: 'private' },
  journal:    { label: 'Journal',          icon: 'pen',      visibility: 'private' },
  prayer:     { label: 'Prayer list',      icon: 'pray',     visibility: 'private' },
};
var TYPES = Object.keys(SCHEMA);

function MyDataStore(backend) {
  var listeners = new Set();
  function emit(type) {
    listeners.forEach(function (fn) { try { fn(type); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent('trinity-mydata', { detail: { type: type } })); } catch (e) {}
  }
  function docKey(type) { return 'data/' + type; }
  function read(type) { var d = backend.getDoc(docKey(type)); return Array.isArray(d) ? d : []; }
  function write(type, items) { backend.putDoc(docKey(type), items); emit(type); }
  function defVis(type) { return (SCHEMA[type] && SCHEMA[type].visibility) || 'private'; }

  var api = {
    backend: backend,
    schema: SCHEMA,
    types: TYPES,

    // subscribe to any change; returns an unsubscribe fn
    on: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },

    // ---- collection items ----
    list: function (type) { return read(type); },
    get: function (type, id) { return read(type).filter(function (it) { return it.id === id; })[0] || null; },
    count: function (type) { return read(type).length; },
    has: function (type, id) { return read(type).some(function (it) { return it.id === id; }); },

    // upsert by id (id auto-assigned if absent)
    put: function (type, item) {
      var items = read(type);
      var id = item.id != null ? item.id : ('it' + Date.now() + Math.random().toString(36).slice(2, 6));
      var existing = items.filter(function (it) { return it.id === id; })[0];
      var next = Object.assign({ ts: Date.now() }, existing || {}, item, {
        id: id,
        visibility: item.visibility || (existing && existing.visibility) || defVis(type),
      });
      var out = existing
        ? items.map(function (it) { return it.id === id ? next : it; })
        : [next].concat(items);
      write(type, out);
      return next;
    },
    remove: function (type, id) {
      write(type, read(type).filter(function (it) { return it.id !== id; }));
    },
    setVisibility: function (type, id, visibility) {
      write(type, read(type).map(function (it) { return it.id === id ? Object.assign({}, it, { visibility: visibility }) : it; }));
    },
    clear: function (type) { write(type, []); },

    // ---- app settings (a single key/value doc) ----
    // Named-document access, for member data that is NOT one of the SCHEMA list types. Added for the chat
    // unread marks (F17, 2026-07-30): they need the backend's encrypted publish + restore, but they are a MAP
    // rather than a list of {id, ts} items, so none of put/remove/setVisibility above fits them.
    //
    // It MUST go through `backend`, not the local cache: backend.putDoc is what schedules the encrypted
    // publish. Writing to localStorage directly would keep working on the device and quietly sync nothing —
    // which is precisely the trap this passthrough exists to close (caught before shipping, by checking
    // whether the store actually exposed these rather than assuming it did).
    getDoc: function (key) { return backend.getDoc(key); },
    putDoc: function (key, value) { backend.putDoc(key, value); emit(key); },
    settings: {
      all: function () { return backend.getDoc('settings') || {}; },
      get: function (k, fb) { var s = backend.getDoc('settings') || {}; return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : fb; },
      set: function (k, v) { var s = backend.getDoc('settings') || {}; s[k] = v; backend.putDoc('settings', s); emit('settings'); },
    },

    // ---- one-time seed + migration (so collections look populated, then are real/owned) ----
    // Imports the app's sample collections + any pre-MyData localStorage the user already had.
    seedIfEmpty: function (D) {
      if (backend.getDoc('seeded')) return false;
      var migrated = false;
      // 1) migrate pre-existing on-device data (highlights/notes/bookmarks/journal/plans)
      try {
        var oldHi = JSON.parse(localStorage.getItem('trinityone.highlights') || 'null');
        if (oldHi) { Object.keys(oldHi).forEach(function (ref) { api.put('highlights', { id: ref, ref: ref, color: oldHi[ref] }); }); migrated = true; }
        var oldNo = JSON.parse(localStorage.getItem('trinityone.notes') || 'null');
        if (oldNo) { Object.keys(oldNo).forEach(function (ref) { api.put('notes', { id: ref, ref: ref, text: oldNo[ref] }); }); migrated = true; }
        var oldBm = JSON.parse(localStorage.getItem('trinityone.bookmarks') || 'null');
        if (Array.isArray(oldBm)) { oldBm.forEach(function (ref) { api.put('bookmarks', { id: ref, ref: ref }); }); migrated = true; }
        var oldJr = JSON.parse(localStorage.getItem('trinityone.journal') || 'null');
        if (Array.isArray(oldJr)) { oldJr.forEach(function (e) { api.put('journal', e); }); migrated = true; }
        var oldPl = JSON.parse(localStorage.getItem('trinityone.plans') || 'null');
        if (oldPl) api.settings.set('plans', oldPl);
      } catch (e) {}
      // 2) (removed) we no longer seed the design's SAMPLE collections. A real member must start empty —
      //    not with highlights/notes/bookmarks they never made. Only genuine pre-MyData on-device data
      //    (step 1) is migrated. `migrated`/`D` are retained for back-compat with callers.
      void migrated;
      backend.putDoc('seeded', true);
      emit(null);
      // publish freshly-seeded/migrated docs up if the backend syncs
      if (backend.startSync) Object.keys(SCHEMA).forEach(function (t) { backend.putDoc('data/' + t, read(t)); });
      return true;
    },
  };

  // start sync if the backend supports it (NostrBackend); re-pull on identity change
  if (backend.startSync) {
    var kick = function () { return backend.startSync(function () { emit(null); }); };
    api.ready = kick();
    window.addEventListener('trinity-identity', function () { kick(); });
    // A member's own documents are REFUSED by the relay until their church has admitted them (accept()
    // requires effective membership even for these church-untagged personal docs). Publishing here is
    // fire-and-forget, so those refusals were invisible, and the only retry was this kick at startup — which
    // meant anything written while waiting for approval stayed on the device alone until the app was next
    // restarted. Someone journalling while they wait is exactly someone with something on their mind, so the
    // window mattered. Admission is the moment the refusal stops being true; retry then, not at next boot.
    window.addEventListener('trinity-admitted', function () { kick(); });
  } else {
    api.ready = Promise.resolve(false);
  }
  return api;
}

window.MyData = MyDataStore(NostrBackend(LocalBackend('trinityone.mydata')));
