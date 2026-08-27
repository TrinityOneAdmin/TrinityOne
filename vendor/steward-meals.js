(() => {
  // src/church-doc-store.src.js
  function _pickWinner(vers, trusted) {
    let best = null;
    for (const rec of vers.values()) {
      if (trusted && !trusted(rec)) continue;
      if (!best) {
        best = rec;
        continue;
      }
      const a = best.ts || 0, b = rec.ts || 0;
      if (b > a || b === a && String(rec._by || "") < String(best._by || "")) best = rec;
    }
    return best;
  }
  function _reduceVersions(vers, byId, id, trusted) {
    const win = _pickWinner(vers, trusted);
    if (!win) {
      byId.delete(id);
      return null;
    }
    const winKey = String(win._by || "");
    const others = [...vers.keys()].filter((k) => k !== winKey);
    byId.set(id, others.length ? { ...win, _alt: others.slice() } : win);
    return win;
  }
  function _absorbById(versions, byId, id, rec, trusted) {
    let vers = versions.get(id);
    if (!vers) {
      vers = /* @__PURE__ */ new Map();
      versions.set(id, vers);
    }
    const by = String(rec._by || "");
    const had = vers.get(by);
    if (had && (had.ts || 0) > (rec.ts || 0)) return false;
    vers.set(by, rec);
    const win = _reduceVersions(vers, byId, id, trusted);
    return !!win && win._by === by;
  }

  // src/steward-meals.src.js
  (function() {
    const S = () => window.Steward;
    const NET = "trinityone";
    const PFX = NET + "/meals-";
    const SETTINGS_D = PFX + "settings";
    const NEED_D = NET + "/care:";
    const SLOT_D = NET + "/careslot:";
    const SKIP_D = NET + "/careskip:";
    const CARETEAM_D = NET + "/careteam:";
    const CAREREQ_D = NET + "/carereq:";
    const CARESTATUS_D = NET + "/carereqstatus:";
    const CARECHAT_D = NET + "/carechat:";
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
      const MEALS_OK = ["breakfast", "lunch", "dinner"];
      const normMeals = (a) => (Array.isArray(a) ? a : []).filter((m) => MEALS_OK.includes(m));
      const type = ["meals", "rides", "moving", "errands", "diy", "visits", "childcare", "other"].includes(n.type) ? n.type : "meals";
      const days = [...new Set((Array.isArray(n.dates) ? n.dates : []).map(isoDate).filter(Boolean))].sort().slice(0, 90);
      const isMeals = type === "meals";
      const meals = isMeals ? normMeals(n.meals).length ? normMeals(n.meals) : ["dinner"] : [];
      const dayMeals = isMeals ? Object.fromEntries(Object.entries(n.dayMeals || {}).filter(([k, v]) => isoDate(k) && days.includes(k) && normMeals(v).join() !== meals.join()).map(([k, v]) => [k, normMeals(v)])) : {};
      return {
        displayLabel: String(n.displayLabel || "").trim(),
        type,
        dates: days,
        meals,
        dayMeals,
        startDate: days[0] || isoDate(n.startDate),
        endDate: days[days.length - 1] || isoDate(n.endDate),
        recipient: typeof n.recipient === "string" && /^[0-9a-f]{64}$/i.test(n.recipient) ? n.recipient.toLowerCase() : "",
        notes: String(n.notes || "").trim(),
        // dietary tags (meals only) — capped + length-limited; the UI supplies the chip set
        dietary: (Array.isArray(n.dietary) ? n.dietary : []).map((d) => String(d).slice(0, 24)).filter(Boolean).slice(0, 12)
      };
    }
    const SEALED_FIELDS = ["displayLabel", "notes", "recipient", "dietary"];
    const _rand32 = () => {
      const b = new Uint8Array(32);
      crypto.getRandomValues(b);
      return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    };
    async function _sha256hex(str) {
      const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    async function publishNeed(need) {
      if (!S() || !S().publishSigned) return null;
      if (need._sealed) throw new Error("This need was saved by a device that holds the care key, and this device can\u2019t open it. Open Members so the key syncs, then edit it here.");
      const id = need.id || uid("care");
      const rec = _normNeed(need);
      const sealed = {};
      for (const f of SEALED_FIELDS) sealed[f] = rec[f];
      const ct = S().careSeal ? S().careSeal(sealed) : null;
      if (!ct) {
        const looking = S().careKeyChecked && !S().careKeyChecked();
        throw new Error(looking ? "Still connecting to your church \u2014 give it a moment and try again." : "Care needs are encrypted for the person\u2019s privacy, and this church\u2019s care key hasn\u2019t reached this device yet. Open Members once so it can sync, then try again.");
      }
      const tags = [["d", NEED_D + id], ["t", NET], ["enc", "care1"]];
      const body = { ...rec, enc: ct };
      for (const f of SEALED_FIELDS) delete body[f];
      if (rec.recipient && S().careSealTo) {
        const secret = _rand32();
        const to = S().careSealTo(rec.recipient, { s: secret });
        if (to) {
          body.skipEnc = to;
          for (const day of rec.dates) {
            const tokDay = await _sha256hex(secret + ":" + day);
            tags.push(["skiphash", day, await _sha256hex(tokDay)]);
          }
        }
      }
      const e = await S().publishSigned({ kind: 30078, created_at: now(), tags, content: JSON.stringify(body) });
      return { id, ...rec, ts: e && e.created_at };
    }
    function openNeed(rec) {
      if (!rec || !rec.enc) return rec;
      const opened = S() && S().careOpen ? S().careOpen(rec.enc) : null;
      const { enc, ...clear } = rec;
      return opened ? { ...clear, ...opened } : { ...clear, _sealed: true };
    }
    function removeNeed(id) {
      if (!S() || !S().publishSigned) return Promise.resolve(null);
      return S().publishSigned({ kind: 30078, created_at: now(), tags: [["d", NEED_D + id], ["t", NET], ["deleted", "1"]], content: "" });
    }
    function skipDay(careId, iso) {
      if (!S() || !S().publishSigned || !careId || !/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return Promise.resolve(null);
      return S().publishSigned({ kind: 30078, created_at: now(), tags: [["d", SKIP_D + careId + ":" + iso], ["t", NET]], content: "{}" });
    }
    function unskipDay(careId, iso) {
      if (!S() || !S().publishSigned || !careId || !/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return Promise.resolve(null);
      return S().publishSigned({ kind: 30078, created_at: now(), tags: [["d", SKIP_D + careId + ":" + iso], ["t", NET], ["deleted", "1"]], content: "" });
    }
    function subscribeNeeds(cb) {
      if (!S() || !S().subscribeMany || !S().churchPub) {
        cb([]);
        return () => {
        };
      }
      const byId = /* @__PURE__ */ new Map();
      const versions = /* @__PURE__ */ new Map();
      const tombs = /* @__PURE__ */ new Map();
      let openedByMember = false;
      const delOk = (by, need) => !openedByMember || by === S().churchPub || !!need && need._by === by;
      const retracted = (id, need) => {
        const s = tombs.get(id);
        if (!s) return false;
        for (const by of s) {
          if (delOk(by, need)) return true;
        }
        return false;
      };
      const emit = () => cb([...byId.entries()].filter(([id, n]) => !retracted(id, n)).map(([, n]) => n).sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "") || (a.ts || 0) - (b.ts || 0)));
      const sub = S().subscribeMany(
        [{ kinds: [30078], authors: [S().churchPub], "#t": [NET] }, { kinds: [30078], "#church": [S().churchPub], "#t": [NET] }],
        {
          onevent(e) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (d === SETTINGS_D) {
              if (e.pubkey === S().churchPub) {
                try {
                  openedByMember = JSON.parse(e.content || "{}").openedBy === "member";
                  emit();
                } catch (x) {
                }
              }
              return;
            }
            if (!d.startsWith(NEED_D)) return;
            const id = d.slice(NEED_D.length);
            const deleted = e.tags.some((t) => t[0] === "deleted") || !e.content;
            if (deleted) {
              const s = tombs.get(id) || /* @__PURE__ */ new Set();
              s.add(e.pubkey);
              tombs.set(id, s);
              emit();
              return;
            }
            try {
              const opened = openNeed(JSON.parse(e.content));
              _absorbById(versions, byId, id, { id, ..._normNeed(opened), _sealed: !!opened._sealed, _by: e.pubkey, ts: e.created_at });
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
    function publishCareTeam(memberPubs) {
      if (!S() || !S().publishSigned || !S().churchPub) return Promise.resolve(null);
      const cp = S().churchPub;
      const pubs = [.../* @__PURE__ */ new Set([cp, ...(memberPubs || []).map((p) => String(p || "").trim().toLowerCase()).filter(Boolean)])];
      return S().publishSigned({ kind: 30078, created_at: now(), tags: [["d", CARETEAM_D + cp], ["t", NET]], content: JSON.stringify({ pubs, updated: now() }) });
    }
    function subscribeCareRequests(cb) {
      if (!S() || !S().subscribeMany || !S().churchPub) {
        cb([]);
        return () => {
        };
      }
      const cp = S().churchPub;
      const byId = /* @__PURE__ */ new Map(), statusById = /* @__PURE__ */ new Map(), tomb = /* @__PURE__ */ new Map();
      const emit = () => {
        try {
          cb([...byId.values()].map((r) => {
            const s = statusById.get(r.id) || {};
            return { ...r, status: s.status || "open", needId: s.needId || "" };
          }).sort((a, b) => (b.at || 0) - (a.at || 0)));
        } catch (e) {
        }
      };
      const sub = S().subscribeMany([{ kinds: [30078], "#t": ["carereq", "carereqstatus"], "#church": [cp] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (d.startsWith(CARESTATUS_D)) {
            const id2 = d.slice(CARESTATUS_D.length);
            const p2 = statusById.get(id2);
            if (p2 && p2._ts >= e.created_at) return;
            try {
              const s = JSON.parse(e.content || "{}");
              statusById.set(id2, { status: String(s.status || "handled"), needId: String(s.needId || ""), _ts: e.created_at });
              emit();
            } catch (x) {
            }
            return;
          }
          if (!d.startsWith(CAREREQ_D)) return;
          const id = d.slice(CAREREQ_D.length);
          if (e.tags.some((t) => t[0] === "deleted")) {
            tomb.set(id, Math.max(tomb.get(id) || 0, e.created_at));
            byId.delete(id);
            emit();
            return;
          }
          if ((tomb.get(id) || 0) >= e.created_at) return;
          const p = byId.get(id);
          if (p && p._ts >= e.created_at) return;
          let body = null;
          try {
            body = S().openSealedFromPeer(JSON.parse(e.content), e.pubkey);
          } catch (x) {
          }
          byId.set(id, { id, from: e.pubkey, at: body && body.at || e.created_at, _ts: e.created_at, sealed: !body, ...body || {} });
          emit();
        },
        oneose() {
          emit();
        }
      });
      return () => {
        try {
          sub.close();
        } catch (e) {
        }
      };
    }
    function setCareRequestStatus(reqId, requesterPub, opts) {
      if (!S() || !S().publishSigned || !S().churchPub || !reqId) return Promise.resolve(null);
      const o = opts || {};
      const tags = [["d", CARESTATUS_D + reqId], ["t", NET], ["t", "carereqstatus"], ["church", S().churchPub]];
      if (requesterPub) tags.push(["p", requesterPub]);
      return S().publishSigned({ kind: 30078, created_at: now(), tags, content: JSON.stringify({ status: String(o.status || "handled"), needId: String(o.needId || ""), at: now() }) });
    }
    function declineCareRequest(req) {
      return req && req.id ? setCareRequestStatus(req.id, req.from, { status: "declined" }) : Promise.resolve(null);
    }
    async function approveCareRequest(req, fields) {
      if (!req) return null;
      const f = fields || {};
      const dates = [...new Set((Array.isArray(f.dates) ? f.dates : []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
      const saved = await publishNeed({ type: req.type || "other", displayLabel: req.forSelf ? f.who || "A member" : req.forName || "A member", recipient: req.forSelf ? req.from : "", notes: String(f.notes != null ? f.notes : req.note || "").trim(), dates, dietary: [], meals: [] });
      if (saved && saved.id) await setCareRequestStatus(req.id, req.from, { status: "approved", needId: saved.id });
      return saved;
    }
    function subscribeCareChat(reqId, cb) {
      if (!S() || !S().subscribeMany || !S().churchPub || !reqId) {
        cb([]);
        return () => {
        };
      }
      const cp = S().churchPub, prefix = CARECHAT_D + reqId + ":", byId = /* @__PURE__ */ new Map();
      const emit = () => {
        try {
          cb([...byId.values()].sort((a, b) => (a.at || 0) - (b.at || 0)));
        } catch (e) {
        }
      };
      const sub = S().subscribeMany([{ kinds: [30078], "#t": ["carechat"], "#church": [cp] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(prefix)) return;
          const id = d.slice(prefix.length);
          if (byId.has(id)) return;
          let b = null;
          try {
            b = S().openSealedFromPeer(JSON.parse(e.content), e.pubkey);
          } catch (x) {
          }
          if (!b || !b.text) return;
          byId.set(id, { id, from: e.pubkey, mine: e.pubkey === cp, at: b.at || e.created_at, text: String(b.text) });
          emit();
        },
        oneose() {
          emit();
        }
      });
      return () => {
        try {
          sub.close();
        } catch (e) {
        }
      };
    }
    async function sendCareChat(reqId, requesterPub, text) {
      if (!S() || !S().publishSigned || !S().churchPub || !reqId) return null;
      const body = String(text || "").trim();
      if (!body) return null;
      const cp = S().churchPub;
      let team = [];
      try {
        const ev = await new Promise((res) => {
          let best = null;
          const s = S().subscribeMany([{ kinds: [30078], "#d": [CARETEAM_D + cp] }], { onevent(e) {
            if (!best || e.created_at > best.created_at) best = e;
          }, oneose() {
            try {
              s.close();
            } catch (x) {
            }
            res(best);
          } });
          setTimeout(() => {
            try {
              s.close();
            } catch (x) {
            }
            res(best);
          }, 4e3);
        });
        if (ev) {
          const o = JSON.parse(ev.content);
          if (Array.isArray(o.pubs)) team = o.pubs.filter(Boolean);
        }
      } catch (e) {
      }
      const sealed = S().sealToPubs([cp, requesterPub, ...team], { text: body, by: cp, at: now() });
      if (!sealed) return null;
      const tags = [["d", CARECHAT_D + reqId + ":" + Math.random().toString(36).slice(2, 10)], ["t", NET], ["t", "carechat"], ["church", cp]];
      if (requesterPub) tags.push(["p", requesterPub]);
      return S().publishSigned({ kind: 30078, created_at: now(), tags, content: JSON.stringify(sealed) });
    }
    window.StewardMeals = {
      // settings
      subscribeSettings,
      setEnabled,
      cachedEnabled,
      // care-team recipient roster (for the "ask for help" seal)
      publishCareTeam,
      // "ask for help" requests (console side): triage / approve / decline / thread
      subscribeCareRequests,
      setCareRequestStatus,
      declineCareRequest,
      approveCareRequest,
      subscribeCareChat,
      sendCareChat,
      // needs
      publishNeed,
      removeNeed,
      subscribeNeeds,
      openNeed,
      // openNeed exported so it is testable against the SHIPPED bundle
      // slots + skips (read slots; the steward can now WRITE skips to block a day for the recipient)
      subscribeSlots,
      subscribeSkips,
      skipDay,
      unskipDay,
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
