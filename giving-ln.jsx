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

  // ── currency: members display giving amounts in their chosen currency. Sats are the real unit;
  // fiat is just a friendly label converted at a (mock) spot rate. Stored in localStorage. ──
  const CUR_LS = 'trinityone.currency';
  const satsPerUsd = () => (window.TrinityData && window.TrinityData.SATS_PER_USD) || 1075;
  const list = () => (window.TrinityData && window.TrinityData.CURRENCIES) || [{ code: 'USD', symbol: '$', label: 'US dollar', usd: 1 }];
  const find = (code) => list().find(c => c.code === code);
  // sensible default from the device locale (e.g. en-GB → GBP), falling back to USD
  function defaultCode() {
    try {
      const loc = (navigator.language || 'en-US');
      const map = { GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', CA: 'CAD', AU: 'AUD', NG: 'NGN', ZA: 'ZAR', IN: 'INR' };
      const region = (loc.split('-')[1] || '').toUpperCase();
      return (map[region] && find(map[region])) ? map[region] : 'USD';
    } catch { return 'USD'; }
  }
  function curCode() { try { return localStorage.getItem(CUR_LS) || defaultCode(); } catch { return 'USD'; } }
  function currency() { return find(curCode()) || find('USD') || list()[0]; }
  const subs = new Set();
  function setCurrency(code) {
    if (!find(code)) return;
    try { localStorage.setItem(CUR_LS, code); } catch {}
    subs.forEach(fn => { try { fn(code); } catch {} });
    try { window.dispatchEvent(new CustomEvent('trinityone:currency', { detail: code })); } catch {}
  }
  function onCurrencyChange(fn) { subs.add(fn); return () => subs.delete(fn); }

  const satsPerUnit = () => satsPerUsd() * (currency().usd || 1);
  const symbol = () => currency().symbol;
  // amount (in the selected currency) → sats, and sats → amount/formatted string
  const toSats = (amt) => Math.round((Number(amt) || 0) * satsPerUnit());
  const toFiat = (sats) => (Number(sats) || 0) / satsPerUnit();
  const fmtAmount = (amt) => symbol() + (Number(amt) || 0).toFixed(2);
  const fmtFiat = (sats) => fmtAmount(toFiat(sats));
  // legacy aliases (callers pass amounts in the *selected* currency now, not necessarily USD)
  const usdToSats = toSats;
  const satsToUsd = toFiat;

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
    // currency
    currency, currencies: list, curCode, setCurrency, onCurrencyChange,
    symbol, toSats, toFiat, fmtAmount, fmtFiat,
  };
})();
