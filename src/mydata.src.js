// mydata.src.js -- user-owned data (bundled -> vendor/mydata.js).
//
// SPINE: the user's key is their portable database. THIS SLICE is LOCAL ONLY: one storage
// INTERFACE with an on-device implementation. No crypto, no relay I/O, no key handling.
//
// The future encrypted-Nostr backend (NIP-78/84/51 events + NIP-44) is a drop-in SWAP: it
// implements the same Backend interface (getDoc/putDoc) and MyData is constructed over it
// instead of LocalBackend -- nothing above the backend line changes. Every item already
// carries a `visibility` flag ('public' | 'private') so that future layer knows what to
// seal. Journal, notes and the prayer list default to 'private'; highlights/bookmarks public.

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
      // 2) if still empty, seed from the app's sample data so the UI matches the design
      if (D && !migrated) {
        var C = D.COLLECTION_ITEMS || {};
        (C.highlights || []).forEach(function (h) { api.put('highlights', { id: h.ref, ref: h.ref, color: h.color }); });
        (C.bookmarks || []).forEach(function (b) { api.put('bookmarks', { id: b.ref, ref: b.ref }); });
        (C.notes || []).forEach(function (n) { api.put('notes', { id: n.ref, ref: n.ref, text: n.text, date: n.date }); });
        (D.JOURNAL || []).forEach(function (e) { api.put('journal', e); });
        (D.PRAYER_SEED || []).forEach(function (p) { api.put('prayer', p); });
      }
      backend.putDoc('seeded', true);
      emit(null);
      return true;
    },
  };
  return api;
}

window.MyData = MyDataStore(LocalBackend('trinityone.mydata'));
