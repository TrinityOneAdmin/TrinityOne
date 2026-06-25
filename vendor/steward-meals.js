(() => {
  // src/steward-meals.src.js
  (function() {
    const S = () => window.Steward;
    const NET = "trinityone";
    const PFX = NET + "/meals-";
    const SETTINGS_D = PFX + "settings";
    const NEED_D = NET + "/care:";
    const SLOT_D = NET + "/careslot:";
    const SKIP_D = NET + "/careskip:";
    const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const now = () => Math.floor(Date.now() / 1e3);
    const enKey = () => "trinityone.meals.enabled." + (S() && S().churchPub || "");
    function cachedEnabled() {
      try {
        return localStorage.getItem(enKey()) === "1";
      } catch (e) {
        return false;
      }
    }
    const DEFAULTS = { enabled: false, visibility: "all", openedBy: "steward", adminGroupId: "" };
    function subscribeSettings(cb) {
      if (!S() || !S().subscribeMany || !S().churchPub) {
        cb({ ...DEFAULTS });
        return () => {
        };
      }
      cb({ ...DEFAULTS, enabled: cachedEnabled() });
      const seen = { ts: 0, doc: { ...DEFAULTS } };
      const emit = () => {
        try {
          localStorage.setItem(enKey(), seen.doc.enabled ? "1" : "0");
        } catch (e) {
        }
        cb({ ...seen.doc });
      };
      const sub = S().subscribeMany(
        [{ kinds: [30078], authors: [S().churchPub], "#t": [NET] }, { kinds: [30078], "#church": [S().churchPub], "#t": [NET] }],
        {
          onevent(e) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (d !== SETTINGS_D) return;
            if ((e.created_at || 0) <= seen.ts) return;
            try {
              const doc = JSON.parse(e.content || "{}");
              seen.ts = e.created_at || 0;
              seen.doc = {
                enabled: !!doc.enabled,
                visibility: doc.visibility === "team" ? "team" : "all",
                openedBy: doc.openedBy === "member" ? "member" : "steward",
                adminGroupId: String(doc.adminGroupId || "")
              };
              emit();
            } catch (err) {
            }
          },
          oneose() {
            emit();
          }
        }
      );
      return () => {
        try {
          sub.close();
        } catch (e) {
        }
      };
    }
    function setEnabled(on, opts) {
      if (!S() || !S().publishSigned) return Promise.resolve(null);
      opts = opts || {};
      try {
        localStorage.setItem(enKey(), on ? "1" : "0");
      } catch (e) {
      }
      const content = JSON.stringify({
        enabled: !!on,
        visibility: opts.visibility === "team" ? "team" : "all",
        openedBy: opts.openedBy === "member" ? "member" : "steward",
        adminGroupId: String(opts.adminGroupId || ""),
        updated: now()
      });
      return S().publishSigned({ kind: 30078, created_at: now(), tags: [["d", SETTINGS_D], ["t", NET]], content });
    }
    function _normNeed(n) {
      const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "";
      return {
        displayLabel: String(n.displayLabel || "").trim(),
        type: ["meals", "rides", "errands", "visits", "childcare"].includes(n.type) ? n.type : "meals",
        startDate: isoDate(n.startDate),
        endDate: isoDate(n.endDate),
        recipient: typeof n.recipient === "string" && /^[0-9a-f]{64}$/i.test(n.recipient) ? n.recipient.toLowerCase() : "",
        notes: String(n.notes || "").trim()
      };
    }
    function publishNeed(need) {
      if (!S() || !S().publishSigned) return Promise.resolve(null);
      const id = need.id || uid("care");
      const rec = _normNeed(need);
      const content = JSON.stringify(rec);
      return S().publishSigned({ kind: 30078, created_at: now(), tags: [["d", NEED_D + id], ["t", NET]], content }).then((e) => ({ id, ...rec, ts: e && e.created_at }));
    }
    function removeNeed(id) {
      if (!S() || !S().publishSigned) return Promise.resolve(null);
      return S().publishSigned({ kind: 30078, created_at: now(), tags: [["d", NEED_D + id], ["t", NET], ["deleted", "1"]], content: "" });
    }
    function subscribeNeeds(cb) {
      if (!S() || !S().subscribeMany || !S().churchPub) {
        cb([]);
        return () => {
        };
      }
      const byId = /* @__PURE__ */ new Map();
      const emit = () => cb([...byId.values()].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "") || (a.ts || 0) - (b.ts || 0)));
      const sub = S().subscribeMany(
        [{ kinds: [30078], authors: [S().churchPub], "#t": [NET] }, { kinds: [30078], "#church": [S().churchPub], "#t": [NET] }],
        {
          onevent(e) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (!d.startsWith(NEED_D)) return;
            const id = d.slice(NEED_D.length);
            const deleted = e.tags.some((t) => t[0] === "deleted") || !e.content;
            if (deleted) {
              byId.delete(id);
              emit();
              return;
            }
            try {
              byId.set(id, { id, ..._normNeed(JSON.parse(e.content)), ts: e.created_at });
              emit();
            } catch (err) {
            }
          },
          oneose() {
            emit();
          }
        }
      );
      return () => {
        try {
          sub.close();
        } catch (e) {
        }
      };
    }
    function _subscribeChurchTagged(prefix, normalise, cb) {
      if (!S() || !S().subscribeMany || !S().churchPub) {
        cb([]);
        return () => {
        };
      }
      const byKey = /* @__PURE__ */ new Map();
      const emit = () => cb([...byKey.values()]);
      const sub = S().subscribeMany(
        [{ kinds: [30078], "#church": [S().churchPub], "#t": [NET] }],
        {
          onevent(e) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (!d.startsWith(prefix)) return;
            const rest = d.slice(prefix.length).split(":");
            const needId = rest[0] || "";
            const isoDate = rest[1] || "";
            if (!needId || !isoDate) return;
            const key = needId + "|" + isoDate + "|" + e.pubkey;
            const deleted = e.tags.some((t) => t[0] === "deleted") || !e.content;
            if (deleted) {
              byKey.delete(key);
              emit();
              return;
            }
            try {
              const obj = JSON.parse(e.content || "{}");
              byKey.set(key, { needId, isoDate, pubkey: e.pubkey, ts: e.created_at, ...normalise(obj) });
              emit();
            } catch (err) {
            }
          },
          oneose() {
            emit();
          }
        }
      );
      return () => {
        try {
          sub.close();
        } catch (e) {
        }
      };
    }
    function subscribeSlots(cb) {
      return _subscribeChurchTagged(SLOT_D, (o) => ({ note: String(o.note || "").trim() }), cb);
    }
    function subscribeSkips(cb) {
      return _subscribeChurchTagged(SKIP_D, (o) => ({ reason: String(o.reason || "").trim() }), cb);
    }
    function isCareAdmin(memberPub, adminGroupId, groupRosters) {
      if (!memberPub || !adminGroupId) return false;
      const roster = (groupRosters || {})[adminGroupId];
      if (!roster || !Array.isArray(roster.people)) return false;
      return roster.people.some((p) => p && p.pub && p.pub.toLowerCase() === memberPub.toLowerCase());
    }
    window.StewardMeals = {
      // settings
      subscribeSettings,
      setEnabled,
      cachedEnabled,
      // needs
      publishNeed,
      removeNeed,
      subscribeNeeds,
      // slots + skips (read-only from the steward; member-side publishes)
      subscribeSlots,
      subscribeSkips,
      // care-team admin helper (client-side check)
      isCareAdmin,
      // d-tag prefixes — exposed so the relay accept() and member-side modules use the same constants
      SETTINGS_D,
      NEED_D,
      SLOT_D,
      SKIP_D
    };
  })();
})();
