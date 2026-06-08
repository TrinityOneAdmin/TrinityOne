(() => {
  // src/mydata.src.js
  function LocalBackend(ns) {
    var prefix = ns + ":";
    return {
      kind: "local",
      getDoc: function(key) {
        try {
          var v = localStorage.getItem(prefix + key);
          return v == null ? null : JSON.parse(v);
        } catch (e) {
          return null;
        }
      },
      putDoc: function(key, value) {
        try {
          localStorage.setItem(prefix + key, JSON.stringify(value));
        } catch (e) {
        }
      }
    };
  }
  var SCHEMA = {
    highlights: { label: "Highlights", icon: "marker", visibility: "public" },
    bookmarks: { label: "Bookmarks", icon: "bookmark", visibility: "public" },
    notes: { label: "Notes", icon: "pen", visibility: "private" },
    journal: { label: "Journal", icon: "pen", visibility: "private" },
    prayer: { label: "Prayer list", icon: "pray", visibility: "private" }
  };
  var TYPES = Object.keys(SCHEMA);
  function MyDataStore(backend) {
    var listeners = /* @__PURE__ */ new Set();
    function emit(type) {
      listeners.forEach(function(fn) {
        try {
          fn(type);
        } catch (e) {
        }
      });
      try {
        window.dispatchEvent(new CustomEvent("trinity-mydata", { detail: { type } }));
      } catch (e) {
      }
    }
    function docKey(type) {
      return "data/" + type;
    }
    function read(type) {
      var d = backend.getDoc(docKey(type));
      return Array.isArray(d) ? d : [];
    }
    function write(type, items) {
      backend.putDoc(docKey(type), items);
      emit(type);
    }
    function defVis(type) {
      return SCHEMA[type] && SCHEMA[type].visibility || "private";
    }
    var api = {
      backend,
      schema: SCHEMA,
      types: TYPES,
      // subscribe to any change; returns an unsubscribe fn
      on: function(fn) {
        listeners.add(fn);
        return function() {
          listeners.delete(fn);
        };
      },
      // ---- collection items ----
      list: function(type) {
        return read(type);
      },
      get: function(type, id) {
        return read(type).filter(function(it) {
          return it.id === id;
        })[0] || null;
      },
      count: function(type) {
        return read(type).length;
      },
      has: function(type, id) {
        return read(type).some(function(it) {
          return it.id === id;
        });
      },
      // upsert by id (id auto-assigned if absent)
      put: function(type, item) {
        var items = read(type);
        var id = item.id != null ? item.id : "it" + Date.now() + Math.random().toString(36).slice(2, 6);
        var existing = items.filter(function(it) {
          return it.id === id;
        })[0];
        var next = Object.assign({ ts: Date.now() }, existing || {}, item, {
          id,
          visibility: item.visibility || existing && existing.visibility || defVis(type)
        });
        var out = existing ? items.map(function(it) {
          return it.id === id ? next : it;
        }) : [next].concat(items);
        write(type, out);
        return next;
      },
      remove: function(type, id) {
        write(type, read(type).filter(function(it) {
          return it.id !== id;
        }));
      },
      setVisibility: function(type, id, visibility) {
        write(type, read(type).map(function(it) {
          return it.id === id ? Object.assign({}, it, { visibility }) : it;
        }));
      },
      clear: function(type) {
        write(type, []);
      },
      // ---- app settings (a single key/value doc) ----
      settings: {
        all: function() {
          return backend.getDoc("settings") || {};
        },
        get: function(k, fb) {
          var s = backend.getDoc("settings") || {};
          return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : fb;
        },
        set: function(k, v) {
          var s = backend.getDoc("settings") || {};
          s[k] = v;
          backend.putDoc("settings", s);
          emit("settings");
        }
      },
      // ---- one-time seed + migration (so collections look populated, then are real/owned) ----
      // Imports the app's sample collections + any pre-MyData localStorage the user already had.
      seedIfEmpty: function(D) {
        if (backend.getDoc("seeded")) return false;
        var migrated = false;
        try {
          var oldHi = JSON.parse(localStorage.getItem("trinityone.highlights") || "null");
          if (oldHi) {
            Object.keys(oldHi).forEach(function(ref) {
              api.put("highlights", { id: ref, ref, color: oldHi[ref] });
            });
            migrated = true;
          }
          var oldNo = JSON.parse(localStorage.getItem("trinityone.notes") || "null");
          if (oldNo) {
            Object.keys(oldNo).forEach(function(ref) {
              api.put("notes", { id: ref, ref, text: oldNo[ref] });
            });
            migrated = true;
          }
          var oldBm = JSON.parse(localStorage.getItem("trinityone.bookmarks") || "null");
          if (Array.isArray(oldBm)) {
            oldBm.forEach(function(ref) {
              api.put("bookmarks", { id: ref, ref });
            });
            migrated = true;
          }
          var oldJr = JSON.parse(localStorage.getItem("trinityone.journal") || "null");
          if (Array.isArray(oldJr)) {
            oldJr.forEach(function(e) {
              api.put("journal", e);
            });
            migrated = true;
          }
          var oldPl = JSON.parse(localStorage.getItem("trinityone.plans") || "null");
          if (oldPl) api.settings.set("plans", oldPl);
        } catch (e) {
        }
        if (D && !migrated) {
          var C = D.COLLECTION_ITEMS || {};
          (C.highlights || []).forEach(function(h) {
            api.put("highlights", { id: h.ref, ref: h.ref, color: h.color });
          });
          (C.bookmarks || []).forEach(function(b) {
            api.put("bookmarks", { id: b.ref, ref: b.ref });
          });
          (C.notes || []).forEach(function(n) {
            api.put("notes", { id: n.ref, ref: n.ref, text: n.text, date: n.date });
          });
          (D.JOURNAL || []).forEach(function(e) {
            api.put("journal", e);
          });
          (D.PRAYER_SEED || []).forEach(function(p) {
            api.put("prayer", p);
          });
        }
        backend.putDoc("seeded", true);
        emit(null);
        return true;
      }
    };
    return api;
  }
  window.MyData = MyDataStore(LocalBackend("trinityone.mydata"));
})();
