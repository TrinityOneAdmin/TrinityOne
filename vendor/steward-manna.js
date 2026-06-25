(() => {
  // src/steward-manna.src.js
  (function() {
    const S = () => window.Steward;
    const PFX = "trinityone/manna-";
    const SETTINGS_D = PFX + "settings";
    const FUND_D = PFX + "fund:";
    const REQUEST_D = PFX + "request:";
    const VOUCH_D = PFX + "vouch:";
    const APPROVAL_D = PFX + "approval:";
    const RECORD_D = PFX + "record:";
    const TESTIMONY_D = PFX + "testimony:";
    const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const num = (v) => {
      const n = Number(v);
      return isFinite(n) ? n : 0;
    };
    const nowS = () => Math.floor(Date.now() / 1e3);
    const DEFAULTS = {
      mercyCapSats: 5e4,
      // largest single mercy/gleaning draw without escalating to covenant
      mercyAutoSats: 2e4,
      // at/under this, a mercy draw may be auto-approved (no steward click)
      witness1MaxSats: 2e5
      // covenant: at/under this, one witness suffices; above it, two or more
    };
    const enKey = () => "trinityone.manna.enabled." + (S() && S().churchPub || "");
    function cachedEnabled() {
      try {
        return localStorage.getItem(enKey()) === "1";
      } catch {
        return false;
      }
    }
    function subscribeSettings(cb) {
      if (!S() || !S().encSubscribe) {
        cb({ enabled: false, ...DEFAULTS });
        return () => {
        };
      }
      cb({ enabled: cachedEnabled(), ...DEFAULTS });
      return S().encSubscribe(SETTINGS_D, (items) => {
        const doc = items.find((x) => x.id === "") || items[0] || {};
        try {
          localStorage.setItem(enKey(), doc.enabled ? "1" : "0");
        } catch {
        }
        cb({
          enabled: !!doc.enabled,
          baseCurrency: doc.baseCurrency || "GBP",
          mercyCapSats: num(doc.mercyCapSats) || DEFAULTS.mercyCapSats,
          mercyAutoSats: num(doc.mercyAutoSats) || DEFAULTS.mercyAutoSats,
          witness1MaxSats: num(doc.witness1MaxSats) || DEFAULTS.witness1MaxSats
        });
      });
    }
    function setEnabled(on, opts) {
      if (!S() || !S().encPublish) return Promise.resolve(null);
      opts = opts || {};
      try {
        localStorage.setItem(enKey(), on ? "1" : "0");
      } catch {
      }
      return S().encPublish(SETTINGS_D, {
        enabled: !!on,
        baseCurrency: opts.baseCurrency || "GBP",
        mercyCapSats: num(opts.mercyCapSats) || DEFAULTS.mercyCapSats,
        mercyAutoSats: num(opts.mercyAutoSats) || DEFAULTS.mercyAutoSats,
        witness1MaxSats: num(opts.witness1MaxSats) || DEFAULTS.witness1MaxSats,
        updated: nowS()
      });
    }
    function subscribeFunds(cb) {
      if (!S() || !S().encSubscribe) {
        cb([]);
        return () => {
        };
      }
      return S().encSubscribe(FUND_D, (items) => cb(items.sort((a, b) => (a.name || "").localeCompare(b.name || ""))));
    }
    function saveFund(f) {
      if (!S() || !S().encPublish) return Promise.resolve(null);
      const id = f.id || uid("mf");
      const rec = {
        name: (f.name || "").trim() || "Benevolence",
        tier: f.tier === "covenant" ? "covenant" : "mercy",
        capSats: num(f.capSats),
        // 0 = no per-fund cap (falls back to settings.mercyCapSats for mercy)
        note: (f.note || "").trim()
      };
      return S().encPublish(FUND_D + id, rec).then(() => ({ id, ...rec }));
    }
    function removeFund(id) {
      return S() && S().encRemove ? S().encRemove(FUND_D + id) : Promise.resolve(null);
    }
    function subscribeRequests(cb) {
      if (!S() || !S().encSubscribe) {
        cb([]);
        return () => {
        };
      }
      return S().encSubscribe(REQUEST_D, (items) => cb(items.sort((a, b) => (b.ts || 0) - (a.ts || 0))));
    }
    function openRequest(r) {
      if (!S() || !S().encPublish) return Promise.resolve(null);
      const id = r.id || uid("mr");
      const rec = {
        fundId: r.fundId || "",
        tier: r.tier === "covenant" ? "covenant" : "mercy",
        recipient: {
          name: (r.recipient && r.recipient.name || "").trim(),
          ln: (r.recipient && r.recipient.ln || "").trim(),
          // recipient's own Lightning Address
          pub: (r.recipient && r.recipient.pub || "").trim()
        },
        amountSats: num(r.amountSats),
        currency: r.currency || "sats",
        reason: (r.reason || "").trim(),
        // for mercy this stays minimal/empty — no "perform your need"
        openedBy: r.openedBy || S() && S().pubkey || "",
        status: "open",
        ts: nowS()
      };
      return S().encPublish(REQUEST_D + id, rec).then(() => ({ id, ...rec }));
    }
    function setRequestStatus(id, status, patch) {
      if (!S() || !S().encSubscribe) return Promise.resolve(null);
      return new Promise((resolve) => {
        const unsub = S().encSubscribe(REQUEST_D, (items) => {
          const cur = items.find((x) => x.id === id);
          try {
            unsub();
          } catch {
          }
          if (!cur) return resolve(null);
          const { id: _id, ts: _ts, ...rest } = cur;
          S().encPublish(REQUEST_D + id, { ...rest, ...patch || {}, status, ts: nowS() }).then(resolve);
        });
      });
    }
    function closeRequest(id) {
      return setRequestStatus(id, "closed");
    }
    function removeRequest(id) {
      return S() && S().encRemove ? S().encRemove(REQUEST_D + id) : Promise.resolve(null);
    }
    function subscribeVouches(cb) {
      if (!S() || !S().encSubscribe) {
        cb([]);
        return () => {
        };
      }
      return S().encSubscribe(VOUCH_D, (items) => cb(items.sort((a, b) => (a.ts || 0) - (b.ts || 0))));
    }
    function addVouch(v) {
      if (!S() || !S().encPublish) return Promise.resolve(null);
      const id = v.id || uid("mv");
      const rec = {
        requestId: v.requestId || "",
        role: v.role === "witness" ? "witness" : "nominator",
        pub: (v.pub || S() && S().pubkey || "").trim(),
        name: (v.name || "").trim(),
        note: (v.note || "").trim(),
        // "I'll walk with this person" — an act of love, not a gate
        ts: nowS()
      };
      return S().encPublish(VOUCH_D + id, rec).then(() => ({ id, ...rec }));
    }
    function removeVouch(id) {
      return S() && S().encRemove ? S().encRemove(VOUCH_D + id) : Promise.resolve(null);
    }
    function requiredWitnesses(tier, amountSats, settings) {
      if (tier !== "covenant") return 0;
      const max1 = settings && num(settings.witness1MaxSats) || DEFAULTS.witness1MaxSats;
      return num(amountSats) <= max1 ? 1 : 2;
    }
    function canAutoApprove(req, fund, settings) {
      if (!req || req.tier !== "mercy") return false;
      const auto = settings && num(settings.mercyAutoSats) || DEFAULTS.mercyAutoSats;
      const cap = fund && num(fund.capSats) || settings && num(settings.mercyCapSats) || DEFAULTS.mercyCapSats;
      return num(req.amountSats) <= auto && num(req.amountSats) <= cap;
    }
    function vouchStatus(req, vouches, settings) {
      const mine = (vouches || []).filter((v) => v.requestId === (req && req.id));
      const nominators = mine.filter((v) => v.role === "nominator").length;
      const witnesses = mine.filter((v) => v.role === "witness").length;
      const need = requiredWitnesses(req && req.tier, req && req.amountSats, settings);
      const missingNominator = req && req.tier === "covenant" && nominators < 1;
      return { ok: !missingNominator && witnesses >= need, need, have: witnesses, missingNominator };
    }
    function subscribeApprovals(cb) {
      if (!S() || !S().encSubscribe) {
        cb([]);
        return () => {
        };
      }
      return S().encSubscribe(APPROVAL_D, (items) => cb(items));
    }
    function approve(req, opts) {
      if (!S() || !S().encPublish) return Promise.resolve({ ok: false, error: "no key" });
      opts = opts || {};
      const vs = opts.vouchStatus;
      if (req && req.tier === "covenant" && vs && !vs.ok) {
        return Promise.resolve({ ok: false, error: vs.missingNominator ? "covenant requires a nominator (relationship)" : `needs ${vs.need} witness(es), has ${vs.have}` });
      }
      const me = S() && S().pubkey || "";
      const rec = {
        requestId: req.id,
        approvedBy: opts.approvedBy && opts.approvedBy.length ? opts.approvedBy : [me],
        witnesses: opts.witnesses || [],
        method: opts.method || "church-key",
        note: (opts.note || "").trim(),
        ts: nowS()
      };
      return S().encPublish(APPROVAL_D + req.id, rec).then(() => setRequestStatus(req.id, "approved")).then(() => ({ ok: true, approval: rec }));
    }
    const defaultPayout = {
      wired: false,
      async pay() {
        throw new Error("Manna payout is not wired. Execution is intentionally disabled until NWC is configured against regtest/signet or a tiny wallet. Set window.MannaPayout.");
      }
    };
    function payout() {
      return window.MannaPayout && typeof window.MannaPayout.pay === "function" ? window.MannaPayout : defaultPayout;
    }
    function payoutReady() {
      return !!(window.MannaPayout && typeof window.MannaPayout.pay === "function");
    }
    async function pay(req, opts) {
      if (!req) throw new Error("no request");
      if (req.status !== "approved") throw new Error("request is not approved");
      const result = await payout().pay({
        ln: req.recipient && req.recipient.ln,
        amountSats: req.amountSats,
        memo: "Manna disbursement",
        ...opts || {}
      });
      await recordDisbursement(req, { payoutRef: result && (result.preimage || result.ref) || "", amountSats: req.amountSats });
      await setRequestStatus(req.id, "paid");
      return result;
    }
    function subscribeRecords(cb) {
      if (!S() || !S().encSubscribe) {
        cb([]);
        return () => {
        };
      }
      return S().encSubscribe(RECORD_D, (items) => cb(items.sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0))));
    }
    function recordDisbursement(req, info) {
      if (!S() || !S().encPublish) return Promise.resolve(null);
      info = info || {};
      const rec = {
        requestId: req.id,
        amountSats: num(info.amountSats || req.amountSats),
        payoutRef: (info.payoutRef || "").trim(),
        approvedBy: info.approvedBy || [],
        witnesses: info.witnesses || [],
        paidAt: nowS()
      };
      return S().encPublish(RECORD_D + req.id, rec).then(() => ({ ...rec }));
    }
    function subscribeTestimony(cb) {
      if (!S() || !S().encSubscribe) {
        cb([]);
        return () => {
        };
      }
      return S().encSubscribe(TESTIMONY_D, (items) => cb(items.sort((a, b) => (b.ts || 0) - (a.ts || 0))));
    }
    function addTestimony(t) {
      if (!S() || !S().encPublish) return Promise.resolve(null);
      if (!t || !t.consentedBy) return Promise.resolve(null);
      const id = t.id || uid("mt");
      const rec = {
        requestId: t.requestId || "",
        message: (t.message || "").trim(),
        consentedBy: (t.consentedBy || "").trim(),
        // the person (or their Barnabas, with permission)
        sharedToGather: !!t.sharedToGather,
        // later: relay this into TrinityOne Gather
        ts: nowS()
      };
      return S().encPublish(TESTIMONY_D + id, rec).then(() => ({ id, ...rec }));
    }
    function removeTestimony(id) {
      return S() && S().encRemove ? S().encRemove(TESTIMONY_D + id) : Promise.resolve(null);
    }
    window.StewardManna = {
      DEFAULTS,
      subscribeSettings,
      setEnabled,
      cachedEnabled,
      subscribeFunds,
      saveFund,
      removeFund,
      subscribeRequests,
      openRequest,
      setRequestStatus,
      closeRequest,
      removeRequest,
      subscribeVouches,
      addVouch,
      removeVouch,
      requiredWitnesses,
      canAutoApprove,
      vouchStatus,
      subscribeApprovals,
      approve,
      pay,
      payoutReady,
      subscribeRecords,
      recordDisbursement,
      subscribeTestimony,
      addTestimony,
      removeTestimony
    };
  })();
})();
