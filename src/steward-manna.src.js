// steward-manna.src.js — TrinityOne's optional Manna module (bundled → vendor/steward-manna.js).
//
// Manna is the money-OUT counterpart to Finance (which is money-in). Finance already records giving
// and TrinityOne already has the payout primitive (NIP-47 NWC pay_invoice); what Manna adds is the
// *policy* governing money-out: who may receive, gated by what, vouched by whom, approved how, and
// recorded for the trustee. It models the disbursement flow as encrypted church docs:
//
//   grant-request → nomination/vouch (the "Barnabas chain") → approval (Keykeeper) →
//   payout (NWC pay_invoice — NOT wired here; see MannaPayout) → disbursement-record → consented testimony
//
// Two tiers, which are theology encoded, not a preference:
//   • mercy/gleaning  — unconditional, open draw, small cap, no nominator, single (or auto) approval.
//   • covenant/family — nomination-gated; witnesses scale with the amount; a sponsor relationship is required.
//
// NON-NEGOTIABLE: the disbursement ledger NAMES vulnerable people — more sensitive than donor records.
// So every recipient-naming doc (request, vouch, approval, record, testimony) is stored NIP-44-ENCRYPTED
// to the church's own key via window.Steward.encPublish/encSubscribe — the relay only ever sees ciphertext.
// This module never touches the raw key; it talks only to those primitives. Off by default.
//
// Real money is deliberately NOT wired here (build order: model the events first, on regtest/a tiny
// wallet later). pay() routes through a pluggable window.MannaPayout adapter whose default REFUSES.
//
// Exposes window.StewardManna.

(function () {
  const S = () => window.Steward;
  const PFX = 'trinityone/manna-';
  const SETTINGS_D  = PFX + 'settings';     // single doc: { enabled, baseCurrency, mercyCapSats, mercyAutoSats, witness1MaxSats }
  const FUND_D      = PFX + 'fund:';        // + fundId   — a benevolence purse with its own tier + policy
  const REQUEST_D   = PFX + 'request:';     // + reqId    — a grant request (names a person → encrypted)
  const VOUCH_D     = PFX + 'vouch:';       // + vouchId  — a nomination/witness in the Barnabas chain
  const APPROVAL_D  = PFX + 'approval:';    // + reqId    — who approved + witnesses + method (1:1 with request)
  const RECORD_D    = PFX + 'record:';      // + reqId    — the money-out ledger entry a trustee needs (1:1)
  const TESTIMONY_D = PFX + 'testimony:';   // + id       — consented fruit; carries NO purchase data, ever

  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const nowS = () => Math.floor(Date.now() / 1000);

  // ---- policy: defaults a church can override in settings. Amounts in sats. ----
  // These encode the two-tier theology: mercy is fast and gateless under a cap; covenant scales
  // witnesses with the sum ("by the mouth of two or three witnesses", Deut 19:15).
  const DEFAULTS = {
    mercyCapSats: 50000,      // largest single mercy/gleaning draw without escalating to covenant
    mercyAutoSats: 20000,     // at/under this, a mercy draw may be auto-approved (no steward click)
    witness1MaxSats: 200000,  // covenant: at/under this, one witness suffices; above it, two or more
  };

  // ---- settings (mirrors Finance: encrypted doc + a localStorage cache for instant nav paint) ----
  const enKey = () => 'trinityone.manna.enabled.' + ((S() && S().churchPub) || '');
  function cachedEnabled() { try { return localStorage.getItem(enKey()) === '1'; } catch { return false; } }
  function subscribeSettings(cb) {
    if (!S() || !S().encSubscribe) { cb({ enabled: false, ...DEFAULTS }); return () => {}; }
    cb({ enabled: cachedEnabled(), ...DEFAULTS });   // instant paint from cache — no relay wait for the nav item
    return S().encSubscribe(SETTINGS_D, (items) => {
      const doc = items.find(x => x.id === '') || items[0] || {};
      try { localStorage.setItem(enKey(), doc.enabled ? '1' : '0'); } catch {}
      cb({
        enabled: !!doc.enabled,
        baseCurrency: doc.baseCurrency || 'GBP',
        mercyCapSats: num(doc.mercyCapSats) || DEFAULTS.mercyCapSats,
        mercyAutoSats: num(doc.mercyAutoSats) || DEFAULTS.mercyAutoSats,
        witness1MaxSats: num(doc.witness1MaxSats) || DEFAULTS.witness1MaxSats,
      });
    });
  }
  function setEnabled(on, opts) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    opts = opts || {};
    try { localStorage.setItem(enKey(), on ? '1' : '0'); } catch {}
    return S().encPublish(SETTINGS_D, {
      enabled: !!on,
      baseCurrency: opts.baseCurrency || 'GBP',
      mercyCapSats: num(opts.mercyCapSats) || DEFAULTS.mercyCapSats,
      mercyAutoSats: num(opts.mercyAutoSats) || DEFAULTS.mercyAutoSats,
      witness1MaxSats: num(opts.witness1MaxSats) || DEFAULTS.witness1MaxSats,
      updated: nowS(),
    });
  }

  // ---- funds (benevolence purses). Each carries its own tier + cap, so a church can run a gateless
  // mercy purse and a nomination-gated covenant purse side by side on the same rails. ----
  // shape: { id, name, tier:'mercy'|'covenant', capSats, note }
  function subscribeFunds(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(FUND_D, (items) => cb(items.sort((a, b) => (a.name || '').localeCompare(b.name || ''))));
  }
  function saveFund(f) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    const id = f.id || uid('mf');
    const rec = {
      name: (f.name || '').trim() || 'Benevolence',
      tier: f.tier === 'covenant' ? 'covenant' : 'mercy',
      capSats: num(f.capSats),     // 0 = no per-fund cap (falls back to settings.mercyCapSats for mercy)
      note: (f.note || '').trim(),
    };
    return S().encPublish(FUND_D + id, rec).then(() => ({ id, ...rec }));
  }
  function removeFund(id) { return (S() && S().encRemove) ? S().encRemove(FUND_D + id) : Promise.resolve(null); }

  // ---- grant requests (the ledger of need). Plain-language fields; never a "case file". ----
  // status: 'open' → 'approved' → 'paid' → 'closed'  (covenant also passes through vouching first)
  // shape: { id, fundId, tier, recipient:{ name, ln, pub }, amountSats, currency, reason, openedBy, status, ts }
  // recipient.ln = a Lightning Address the recipient brings (self-custodial); recipient.pub = optional npub/hex.
  function subscribeRequests(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(REQUEST_D, (items) => cb(items.sort((a, b) => (b.ts || 0) - (a.ts || 0))));
  }
  function openRequest(r) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    const id = r.id || uid('mr');
    const rec = {
      fundId: r.fundId || '',
      tier: r.tier === 'covenant' ? 'covenant' : 'mercy',
      recipient: {
        name: (r.recipient && r.recipient.name || '').trim(),
        ln: (r.recipient && r.recipient.ln || '').trim(),   // recipient's own Lightning Address
        pub: (r.recipient && r.recipient.pub || '').trim(),
      },
      amountSats: num(r.amountSats),
      currency: r.currency || 'sats',
      reason: (r.reason || '').trim(),   // for mercy this stays minimal/empty — no "perform your need"
      openedBy: r.openedBy || (S() && S().pubkey) || '',
      status: 'open',
      ts: nowS(),
    };
    return S().encPublish(REQUEST_D + id, rec).then(() => ({ id, ...rec }));
  }
  function setRequestStatus(id, status, patch) {
    // re-publish the addressable request doc with a new status (addressable: same d-tag replaces)
    if (!S() || !S().encSubscribe) return Promise.resolve(null);
    return new Promise((resolve) => {
      const unsub = S().encSubscribe(REQUEST_D, (items) => {
        const cur = items.find(x => x.id === id);
        try { unsub(); } catch {}
        if (!cur) return resolve(null);
        const { id: _id, ts: _ts, ...rest } = cur;
        S().encPublish(REQUEST_D + id, { ...rest, ...(patch || {}), status, ts: nowS() }).then(resolve);
      });
    });
  }
  function closeRequest(id) { return setRequestStatus(id, 'closed'); }
  function removeRequest(id) { return (S() && S().encRemove) ? S().encRemove(REQUEST_D + id) : Promise.resolve(null); }

  // ---- vouches (the Barnabas chain). A nominator stands behind a person; witnesses co-sign for covenant.
  // For now these RECORD who vouched (by pubkey), church-key-signed — true independent multi-sig (NIP-46)
  // comes later as amounts rise (see Welfare_Protocol_Architecture_2026.md "Honest cautions"). ----
  // role: 'nominator' (the relationship — required for covenant) | 'witness' (Deut 19:15 co-sign)
  // shape: { id, requestId, role, pub, name, note, ts }
  function subscribeVouches(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(VOUCH_D, (items) => cb(items.sort((a, b) => (a.ts || 0) - (b.ts || 0))));
  }
  function addVouch(v) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    const id = v.id || uid('mv');
    const rec = {
      requestId: v.requestId || '',
      role: v.role === 'witness' ? 'witness' : 'nominator',
      pub: (v.pub || (S() && S().pubkey) || '').trim(),
      name: (v.name || '').trim(),
      note: (v.note || '').trim(),   // "I'll walk with this person" — an act of love, not a gate
      ts: nowS(),
    };
    return S().encPublish(VOUCH_D + id, rec).then(() => ({ id, ...rec }));
  }
  function removeVouch(id) { return (S() && S().encRemove) ? S().encRemove(VOUCH_D + id) : Promise.resolve(null); }

  // ---- policy helpers (pure; the UI shows these and the engine guards on them) ----
  function requiredWitnesses(tier, amountSats, settings) {
    if (tier !== 'covenant') return 0;                         // mercy needs no nominator/witness
    const max1 = (settings && num(settings.witness1MaxSats)) || DEFAULTS.witness1MaxSats;
    return num(amountSats) <= max1 ? 1 : 2;                    // larger transformative sums: two or more
  }
  function canAutoApprove(req, fund, settings) {
    if (!req || req.tier !== 'mercy') return false;
    const auto = (settings && num(settings.mercyAutoSats)) || DEFAULTS.mercyAutoSats;
    const cap  = (fund && num(fund.capSats)) || (settings && num(settings.mercyCapSats)) || DEFAULTS.mercyCapSats;
    return num(req.amountSats) <= auto && num(req.amountSats) <= cap;
  }
  // Does this request have the vouches its tier+amount demand? → { ok, need, have, missingNominator }
  function vouchStatus(req, vouches, settings) {
    const mine = (vouches || []).filter(v => v.requestId === (req && req.id));
    const nominators = mine.filter(v => v.role === 'nominator').length;
    const witnesses = mine.filter(v => v.role === 'witness').length;
    const need = requiredWitnesses(req && req.tier, req && req.amountSats, settings);
    const missingNominator = (req && req.tier === 'covenant') && nominators < 1;  // relationship is required
    return { ok: !missingNominator && witnesses >= need, need, have: witnesses, missingNominator };
  }

  // ---- approval (the Keykeeper moment). Records who approved, the witnesses present, and the method.
  // method: 'church-key' (single church key today) | 'nip46' | 'multisig' (graduate to these as stakes rise). ----
  // shape (RECORD_D-adjacent, keyed by requestId): { requestId, approvedBy:[pub], witnesses:[pub], method, note, ts }
  function subscribeApprovals(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(APPROVAL_D, (items) => cb(items));
  }
  // Guarded: refuses to approve a covenant request that lacks its required relationship/witnesses.
  function approve(req, opts) {
    if (!S() || !S().encPublish) return Promise.resolve({ ok: false, error: 'no key' });
    opts = opts || {};
    const vs = opts.vouchStatus;   // pass the result of vouchStatus() so the engine enforces policy
    if (req && req.tier === 'covenant' && vs && !vs.ok) {
      return Promise.resolve({ ok: false, error: vs.missingNominator ? 'covenant requires a nominator (relationship)' : `needs ${vs.need} witness(es), has ${vs.have}` });
    }
    const me = (S() && S().pubkey) || '';
    const rec = {
      requestId: req.id,
      approvedBy: opts.approvedBy && opts.approvedBy.length ? opts.approvedBy : [me],
      witnesses: opts.witnesses || [],
      method: opts.method || 'church-key',
      note: (opts.note || '').trim(),
      ts: nowS(),
    };
    return S().encPublish(APPROVAL_D + req.id, rec)
      .then(() => setRequestStatus(req.id, 'approved'))
      .then(() => ({ ok: true, approval: rec }));
  }

  // ---- payout (deliberately NOT wired). The architecture says: model the events first, then wire NWC
  // against regtest/signet or a tiny low-value wallet. So pay() routes to a pluggable adapter and the
  // default REFUSES. A church wires window.MannaPayout = { payInvoice }/{ payToLnAddress } when ready. ----
  const defaultPayout = {
    wired: false,
    async pay() { throw new Error('Manna payout is not wired. Execution is intentionally disabled until NWC is configured against regtest/signet or a tiny wallet. Set window.MannaPayout.'); },
  };
  function payout() { return (window.MannaPayout && typeof window.MannaPayout.pay === 'function') ? window.MannaPayout : defaultPayout; }
  function payoutReady() { return !!(window.MannaPayout && typeof window.MannaPayout.pay === 'function'); }

  // Execute an approved request: pay the recipient's own Lightning Address via the adapter, then record it.
  // Throws (rejects) if not approved or if no payout adapter is wired — by design.
  async function pay(req, opts) {
    if (!req) throw new Error('no request');
    if (req.status !== 'approved') throw new Error('request is not approved');
    const result = await payout().pay({
      ln: req.recipient && req.recipient.ln,
      amountSats: req.amountSats,
      memo: 'Manna disbursement',
      ...(opts || {}),
    });
    await recordDisbursement(req, { payoutRef: (result && (result.preimage || result.ref)) || '', amountSats: req.amountSats });
    await setRequestStatus(req.id, 'paid');
    return result;
  }

  // ---- disbursement record (the money-out ledger entry a charity trustee needs). Encrypted, minimal. ----
  // shape (keyed by requestId): { requestId, amountSats, payoutRef, approvedBy, witnesses, paidAt }
  function subscribeRecords(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(RECORD_D, (items) => cb(items.sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0))));
  }
  function recordDisbursement(req, info) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    info = info || {};
    const rec = {
      requestId: req.id,
      amountSats: num(info.amountSats || req.amountSats),
      payoutRef: (info.payoutRef || '').trim(),
      approvedBy: info.approvedBy || [],
      witnesses: info.witnesses || [],
      paidAt: nowS(),
    };
    return S().encPublish(RECORD_D + req.id, rec).then(() => ({ ...rec }));
  }

  // ---- consented testimony (the fruit that flows back to givers). NEVER derived from payout/purchase
  // data — only what the recipient consents to share. "A father is back in work," not a list of buys. ----
  // shape: { id, requestId, message, consentedBy, sharedToGather, ts }
  function subscribeTestimony(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(TESTIMONY_D, (items) => cb(items.sort((a, b) => (b.ts || 0) - (a.ts || 0))));
  }
  function addTestimony(t) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    if (!t || !t.consentedBy) return Promise.resolve(null);   // no consent → no testimony, full stop
    const id = t.id || uid('mt');
    const rec = {
      requestId: t.requestId || '',
      message: (t.message || '').trim(),
      consentedBy: (t.consentedBy || '').trim(),   // the person (or their Barnabas, with permission)
      sharedToGather: !!t.sharedToGather,           // later: relay this into TrinityOne Gather
      ts: nowS(),
    };
    return S().encPublish(TESTIMONY_D + id, rec).then(() => ({ id, ...rec }));
  }
  function removeTestimony(id) { return (S() && S().encRemove) ? S().encRemove(TESTIMONY_D + id) : Promise.resolve(null); }

  window.StewardManna = {
    DEFAULTS,
    subscribeSettings, setEnabled, cachedEnabled,
    subscribeFunds, saveFund, removeFund,
    subscribeRequests, openRequest, setRequestStatus, closeRequest, removeRequest,
    subscribeVouches, addVouch, removeVouch,
    requiredWitnesses, canAutoApprove, vouchStatus,
    subscribeApprovals, approve,
    pay, payoutReady,
    subscribeRecords, recordDisbursement,
    subscribeTestimony, addTestimony, removeTestimony,
  };
})();
