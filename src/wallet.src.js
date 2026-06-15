// src/wallet.src.js — in-app self-custodial Cashu (ecash) wallet, keyed to the member's Nostr identity.
// The balance is bearer ecash held on-device (localStorage) and mirrored, encrypted to the member's OWN
// key, onto the relays via Fellowship (NIP-60-aligned) — so the wallet IS the identity and a reinstall
// restores it. Lightning top-up mints ecash from a paid invoice; giving melts ecash to pay the church's
// Lightning-address invoice. Built to vendor/wallet.js via esbuild. Exposes window.TrinityWallet.
import { Mint, Wallet, sumProofs, CheckStateEnum } from '@cashu/cashu-ts';

// DEV mint: testnut issues FAKE sats with no real payment — safe for branch development.
// TODO before the pilot: swap for a production mint (ideally app/steward-configurable).
const DEFAULT_MINT = 'https://testnut.cashu.space';

// cashu-ts v4 amounts are { value: bigint }; never do arithmetic on proof.amount directly.
const num = (a) => (a && typeof a === 'object' && 'value' in a) ? Number(a.value) : Number(a || 0);
const sum = (ps) => num(sumProofs(ps || []));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retry = async (fn, n = 3) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (err) { e = err; await sleep(900 * (i + 1)); } } throw e; };

let mintUrl = DEFAULT_MINT;
let mint = null, wallet = null;
let proofs = [];
let owner = '';        // npub this wallet belongs to
let loaded = false;    // mint keys loaded?
let loadingP = null;
let initP = null;      // shared init promise (idempotent boot)

const subs = new Set();
const emit = () => { const b = sum(proofs); subs.forEach((fn) => { try { fn(b); } catch {} }); };

function npub() { try { return (window.TrinityIdentity && window.TrinityIdentity.current && window.TrinityIdentity.current.npub) || ''; } catch { return ''; } }
function lsKey() { return 'trinityone.wallet.' + (owner || 'anon'); }
// Proofs are bearer ecash — whoever reads them can spend them. So encrypt the on-device copy at rest
// with the member's own key (NIP-44 self-encryption, same key as the relay backup). It raises the bar
// against trivial localStorage scraping; the real fix (keys out of page scope) is the planned signer.
// Legacy plaintext blobs still load, and re-save as encrypted on the next write.
function saveLocal() {
  try {
    const plain = JSON.stringify({ mint: mintUrl, proofs });
    const F = window.Fellowship;
    const ct = (F && F.encryptSelf) ? F.encryptSelf(plain) : null;
    localStorage.setItem(lsKey(), ct ? JSON.stringify({ v: 2, enc: ct }) : plain);
  } catch {}
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(lsKey()); if (!raw) return;
    let d = JSON.parse(raw);
    if (d && d.enc) {                                  // encrypted at rest → decrypt with our own key
      const F = window.Fellowship;
      const pt = (F && F.decryptSelf) ? F.decryptSelf(d.enc) : null;
      if (!pt) return;                                 // key not ready / not ours — leave as-is, retry later
      d = JSON.parse(pt);
    }
    if (d && Array.isArray(d.proofs)) { proofs = d.proofs; if (d.mint) mintUrl = d.mint; }
  } catch {}
}
async function backup() { saveLocal(); try { if (window.Fellowship && window.Fellowship.publishWalletBackup) await window.Fellowship.publishWalletBackup('proofs', { mint: mintUrl, proofs }); } catch {} }

async function ensureMint() {
  if (loaded) return;
  if (!loadingP) loadingP = (async () => {
    mint = new Mint(mintUrl);
    wallet = new Wallet(mint, { unit: 'sat' });
    await retry(() => wallet.loadMint());
    loaded = true;
  })().catch((e) => { loadingP = null; throw e; });
  await loadingP;
}

// adopt a relay backup on a fresh device, then drop any already-spent proofs
function restoreFromRelay() {
  return new Promise((resolve) => {
    if (!(window.Fellowship && window.Fellowship.subscribeWalletBackup)) return resolve();
    let done = false, close = null;
    const finish = () => { if (done) return; done = true; try { close && close(); } catch {} resolve(); };
    close = window.Fellowship.subscribeWalletBackup('proofs', async (doc) => {
      if (done || !doc || !Array.isArray(doc.proofs)) return;
      if (doc.mint) mintUrl = doc.mint;
      proofs = doc.proofs; saveLocal(); finish();
      try { await pruneSpent(); emit(); } catch {}
    });
    setTimeout(finish, 6000); // don't block boot if no backup exists
  });
}

async function pruneSpent() {
  if (!proofs.length) return;
  await ensureMint();
  const states = await wallet.checkProofsStates(proofs);
  const keep = proofs.filter((_, i) => states[i] && states[i].state === CheckStateEnum.UNSPENT);
  if (keep.length !== proofs.length) { proofs = keep; saveLocal(); }
}

window.TrinityWallet = {
  get mintUrl() { return mintUrl; },
  balance() { return sum(proofs); },
  onChange(fn) { subs.add(fn); try { fn(sum(proofs)); } catch {} return () => subs.delete(fn); },

  // boot: paint local balance instantly, restore from relay if this device is empty, warm the mint.
  // Idempotent — many surfaces (Giving tab, wallet hub, profile) may call it; they share one init.
  init() {
    if (initP) return initP;
    initP = (async () => {
      owner = npub();
      try { if (window.Fellowship && window.Fellowship.ready) await window.Fellowship.ready; } catch {}   // need our key to decrypt at-rest proofs
      loadLocal();
      if (!proofs.length) await restoreFromRelay();
      emit();
      ensureMint().catch(() => {});
      return this.balance();
    })();
    return initP;
  },

  // re-check on-chain that our proofs are still unspent (e.g. after restoring on a new device)
  async refresh() { try { await pruneSpent(); emit(); } catch {} return this.balance(); },

  // ── Top up: occasional load from the member's EXTERNAL wallet (Strike etc.) into the in-app balance ──
  async requestTopUp(sats) {
    await ensureMint();
    const q = await retry(() => wallet.createMintQuoteBolt11(sats));
    return { quote: q.quote, invoice: q.request, _q: q, sats };
  },
  // poll until the top-up invoice is paid, then mint the ecash into the balance
  async awaitTopUp(req, { onState, timeoutMs = 600000 } = {}) {
    await ensureMint();
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      let s = null; try { s = await mint.checkMintQuoteBolt11(req.quote); } catch {}
      if (s && onState) onState(s.state);
      if (s && s.state === 'PAID') {
        const fresh = await retry(() => wallet.mintProofs('bolt11', req.sats, req._q || { quote: req.quote }));
        proofs = [...proofs, ...fresh]; await backup(); emit();
        return this.balance();
      }
      if (s && s.state === 'ISSUED') return this.balance(); // already claimed
      await sleep(2500);
    }
    throw new Error('Top-up timed out — if you paid, it’ll appear shortly.');
  },

  // ── Give: pay a Lightning invoice (the church's) from the in-app balance ──
  // What it'll cost from the balance, incl. mint fee, before committing.
  async quoteInvoice(bolt11) {
    await ensureMint();
    const mq = await retry(() => wallet.createMeltQuoteBolt11(bolt11));
    return { _mq: mq, amount: num(mq.amount), fee: num(mq.fee_reserve), total: num(mq.amount) + num(mq.fee_reserve) };
  },
  async payInvoice(bolt11, pre) {
    await ensureMint();
    const q = pre && pre._mq ? pre : await this.quoteInvoice(bolt11);
    const need = q.total;
    if (sum(proofs) < need) throw new Error('Not enough balance — top up first.');
    const { keep, send } = await retry(() => wallet.send(need, proofs, { includeFees: true }));
    const res = await retry(() => wallet.meltProofs('bolt11', q._mq, send));
    proofs = [...keep, ...(res.change || [])];
    await backup(); emit();
    return { paid: res.quote ? res.quote.state === 'PAID' : true, fee: q.fee, balance: this.balance() };
  },

  // ── Withdraw / cash out: send the balance back out to the member's OWN wallet. ──
  // destination = a Lightning address (name@domain — we resolve + request an invoice for `sats`)
  // or a bolt11 invoice (amount is embedded, `sats` ignored). Always available, church-independent.
  async withdraw(destination, sats) {
    const dest = String(destination || '').trim().replace(/^lightning:/i, '');
    let bolt11;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
      if (!(window.TrinityLN && window.TrinityLN.invoiceFor)) throw new Error('Lightning-address support unavailable');
      const r = await window.TrinityLN.invoiceFor(dest, sats);
      bolt11 = r.bolt11;
    } else if (/^ln(bc|tb|bcrt)/i.test(dest)) {
      bolt11 = dest;
    } else {
      throw new Error('Enter a Lightning address or invoice');
    }
    return this.payInvoice(bolt11);
  },
};
