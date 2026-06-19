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
  var SYNC = {
    'data/highlights': { d: 'trinityone/highlights', priv: false },
    'data/bookmarks':  { d: 'trinityone/bookmarks',  priv: false },
    'data/notes':      { d: 'trinityone/notes',      priv: true  },
    'data/journal':    { d: 'trinityone/journal',    priv: true  },
    'data/prayer':     { d: 'trinityone/prayer',     priv: true  },
    'settings':        { d: 'trinityone/settings',   priv: false },
  };
  var D_TO_KEY = {};
  Object.keys(SYNC).forEach(function (k) { D_TO_KEY[SYNC[k].d] = k; });

  var pool = new SimplePool();
  var sk = null, pub = null, ck = null;
  var timers = {};
  var onChange = function () {};

  function relays() { return (window.Fellowship && window.Fellowship.relays) || ['ws://127.0.0.1:7447']; }
  function tombKey(key) { return 'tomb/' + key; }
  function idset(arr) { var s = new Set(); (arr || []).forEach(function (it) { if (it && it.id != null) s.add(it.id); }); return s; }
  function encode(key, payload) { var j = JSON.stringify(payload); return SYNC[key].priv ? nip44.encrypt(j, ck) : j; }
  function decode(key, content) { var j = SYNC[key].priv ? nip44.decrypt(content, ck) : content; return JSON.parse(j); }

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
    if (payload && payload.settings) {
      var cur = cache.getDoc('settings') || {};
      var next = Object.assign({}, payload.settings, cur); // local wins (never lose a local pref)
      cache.putDoc('settings', next);
      if (JSON.stringify(next) !== JSON.stringify(payload.settings)) schedulePublish('settings');
      return JSON.stringify(next) !== JSON.stringify(cur);
    }
    return false;
  }

  function pull() {
    return new Promise(function (resolve) {
      var touched = false, done = false;
      var finish = function () { if (done) return; done = true; if (touched) onChange(); resolve(touched); };
      var sub = pool.subscribeMany(relays(), [{ kinds: [KIND], authors: [pub], '#d': Object.keys(D_TO_KEY) }], {
        onevent: function (e) {
          var dTag = (e.tags.find(function (t) { return t[0] === 'd'; }) || [])[1];
          var key = D_TO_KEY[dTag];
          if (!key) return;
          try { if (reconcile(key, decode(key, e.content))) touched = true; }
          catch (err) { console.warn('[mydata] reconcile failed', dTag, err); }
        },
        oneose: function () { try { sub.close(); } catch (e) {} finish(); },
      });
      setTimeout(finish, 6000); // resolve even if a relay never sends EOSE
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
        return pull().then(function () {
          Object.keys(SYNC).forEach(function (k) { if (cache.getDoc(k) != null) schedulePublish(k); });
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
  } else {
    api.ready = Promise.resolve(false);
  }
  return api;
}

window.MyData = MyDataStore(NostrBackend(LocalBackend('trinityone.mydata')));
