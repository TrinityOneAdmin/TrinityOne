// giving-ln.jsx — non-custodial Lightning client for the Giving tab.
// No balance, no custody: we resolve the church's Lightning Address (LNURL-pay),
// fetch a real BOLT11 invoice for the chosen amount, and hand it to the member's
// own wallet (WebLN, the `lightning:` deep link, or a scannable QR). The app never
// holds funds — the gift settles peer-to-peer from the giver's wallet to the church.
(function () {
  'use strict';

  // ── LNURL-pay: name@domain → metadata params ──
  async function resolveLnAddress(addr) {
    const [name, domain] = String(addr || '').trim().split('@');
    if (!name || !domain) throw new Error('Not a Lightning address');
    const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
    let r;
    try { r = await fetch(url, { headers: { Accept: 'application/json' } }); }
    catch { throw new Error('Could not reach ' + domain); }
    if (!r.ok) throw new Error('Lightning address not found (' + r.status + ')');
    const p = await r.json();
    if (p.status === 'ERROR') throw new Error(p.reason || 'Lightning address error');
    if (p.tag !== 'payRequest') throw new Error('Not a pay address');
    return p; // { callback, minSendable, maxSendable, commentAllowed, metadata, ... }
  }

  // ── params + sats → BOLT11 invoice ──
  async function requestInvoice(params, sats, comment) {
    const msat = Math.round(sats) * 1000;
    if (msat < (params.minSendable || 1)) throw new Error('Below this fund’s minimum');
    if (msat > (params.maxSendable || Infinity)) throw new Error('Above this fund’s maximum');
    const u = new URL(params.callback);
    u.searchParams.set('amount', String(msat));
    if (comment && params.commentAllowed) u.searchParams.set('comment', String(comment).slice(0, params.commentAllowed));
    let r;
    try { r = await fetch(u.toString(), { headers: { Accept: 'application/json' } }); }
    catch { throw new Error('Could not request an invoice'); }
    if (!r.ok) throw new Error('Invoice request failed (' + r.status + ')');
    const j = await r.json();
    if (j.status === 'ERROR') throw new Error(j.reason || 'Invoice declined');
    if (!j.pr) throw new Error('No invoice returned');
    return j.pr; // bolt11
  }

  // one-shot: address + sats → invoice (+ the params, for min/max display)
  async function invoiceFor(lnaddr, sats, comment) {
    const params = await resolveLnAddress(lnaddr);
    const bolt11 = await requestInvoice(params, sats, comment);
    return { bolt11, params };
  }

  // ── Hand the invoice to the giver's own wallet ──
  const walletURI = (bolt11) => 'lightning:' + String(bolt11 || '').toUpperCase();

  // WebLN (browser/extension wallet) — auto-pay if the member has one enabled.
  async function payViaWebLN(bolt11) {
    if (!window.webln) throw new Error('no webln');
    if (!window.webln.enabled) await window.webln.enable();
    const res = await window.webln.sendPayment(bolt11); // throws if the user cancels
    return res; // { preimage }
  }
  const hasWebLN = () => typeof window.webln !== 'undefined';

  // Real scannable QR of the invoice (reuses the bundled qrcode-generator).
  function qrSVG(bolt11) {
    try { return window.TrinityIdentity.qrSVG(walletURI(bolt11)); }
    catch { return ''; }
  }

  // sat ⇄ usd display helpers (mock spot rate until we wire a live price feed)
  const satsPerUsd = () => (window.TrinityData && window.TrinityData.SATS_PER_USD) || 1075;
  const usdToSats = (usd) => Math.round(usd * satsPerUsd());
  const satsToUsd = (sats) => sats / satsPerUsd();

  // Where does a gift to this fund go? per-fund address, else the church's, else none.
  function payAddress(fund, ctx) {
    if (fund && fund.lnaddr) return fund.lnaddr;
    const D = window.TrinityData || {};
    const church = (ctx && (ctx.churches || []).find(c => c.id === (fund && fund.church || ctx.activeChurch)))
      || (D.CHURCHES || []).find(c => c.id === (ctx && ctx.activeChurch));
    return (church && (church.lnaddr || church.lud16)) || '';
  }

  window.TrinityLN = {
    resolveLnAddress, requestInvoice, invoiceFor,
    walletURI, payViaWebLN, hasWebLN, qrSVG,
    usdToSats, satsToUsd, payAddress,
  };
})();
