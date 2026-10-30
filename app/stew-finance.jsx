// stew-finance.jsx — the rebuilt-fresh Finance module: a double-entry accounting screen on window.FinanceLedger
// (FINANCE-MODULE.md). Real fund accounting; the treasurer records money in/out in plain language and the
// engine keeps the balanced double-entry underneath. Amounts are INTEGER minor units under the hood.
//
// P0.4 scope: local-first persistence (localStorage) so it's usable now. The relay-backed journal (the
// finance/journal single-writer seq guard is already live) + the Lightning "Unlock Full" paywall land in P0.3.

const BOOKS_LS = 'trinityone.books.v1';
const CCY_SYM = { GBP: '£', USD: '$', EUR: '€', sats: '⚡' };

// Donation nudge — TrinityOne stays free & open (AGPL). When a church opens its books we gently ask for a
// gift toward the shared relays + development. Shown once per session until they give, then hidden ~3 months.
// No paywall, no lock: everything works whether or not they give.
// PARKED for the pilot: the "Keep TrinityOne going" panel asks a STEWARD to donate to TrinityOne itself. It
// is not the church's giving feature (that is `givingOn` in the member app, also off). Off because the
// addresses below are not ours yet — and an unclaimed handle in a donation prompt is money going to whoever
// registers it first. Restore: true, once DONATE.ln and DONATE.alt are real and owned.
const DONATE_ON = false;
const DONATE_LS = 'trinityone.books.donateHiddenUntil';
const DONATE = {
  ln: 'donate@trinityone.church',        // TODO(owner): real Lightning address / LNURL for donations
  alt: '',                               // TODO(owner): a real, OWNED donation link. Was 'https://strike.me/trinityone' — an unclaimed public handle anyone could register. '' hides the button.
  suggest: ['£5', '£10', '£25'],
  hideDays: 90,
};
let _booksDonateShown = false;           // once per app session
function booksDonateHiddenUntil() { try { return parseInt(localStorage.getItem(DONATE_LS) || '0', 10) || 0; } catch (e) { return 0; } }
function booksDonateGave() { try { localStorage.setItem(DONATE_LS, String(Date.now() + DONATE.hideDays * 864e5)); } catch (e) {} }

function booksFresh() {
  const F = window.FinanceLedger;
  const b = F.createBook({ baseCurrency: 'GBP', decimals: 2 });
  // NATION-NEUTRAL, silent-£ (DOMAIN 2026-10-29): a tight generic chart, NO tax/relief accounts (no Gift Aid,
  // no GASDS — those are off-by-default regional packs, never the core seed). A pilot church that already has
  // a book never re-seeds (the seed runs only on an authenticated EMPTY read), so this list reaches only a
  // brand-new book; a treasurer edits it from the Accounts & funds panel.
  [['bank', '1000', 'Bank / cash', 'asset'],
   ['giving', '4000', 'Giving & offerings', 'income'],
   ['facility-hire', '4100', 'Facility hire', 'income'],
   ['other-income', '4900', 'Other income', 'income'],
   ['utilities', '5000', 'Utilities', 'expense'],
   ['outreach', '5100', 'Outreach & mission', 'expense'],
   ['building', '5200', 'Building & upkeep', 'expense'],
   ['staff-costs', '5300', 'Staff & stipends', 'expense'],
   ['missions', '5400', 'Missions & giving out', 'expense'],
   ['other-expense', '5900', 'Other costs', 'expense']].forEach(([id, code, name, type]) => F.addAccount(b, { id, code, name, type }));
  return b;
}
function booksLoad() {
  const F = window.FinanceLedger; if (!F) return null;
  let docs = null; try { docs = JSON.parse(localStorage.getItem(BOOKS_LS) || 'null'); } catch (e) {}
  if (docs && docs.length) { const r = F.rebuildBook(docs); if (r.book) return r.book; }
  return booksFresh();
}
function booksSave(book) { try { localStorage.setItem(BOOKS_LS, JSON.stringify(window.FinanceLedger.bookToDocs(book))); } catch (e) {} }
// map an encSubscribe item ({ id: the d-suffix after 'finance/', ...decrypted }) back to a finance-store doc
function finItemToDoc(it) {
  const id = (it && it.id) || '';
  if (id === 'settings') return { t: 'settings', baseCurrency: it.baseCurrency, decimals: it.decimals, fiscalYearStart: it.fiscalYearStart };
  if (id.startsWith('account:')) return { t: 'account', id: id.slice(8), code: it.code, name: it.name, type: it.type, archived: !!it.archived };
  if (id.startsWith('fund:')) return { t: 'fund', id: id.slice(5), name: it.name, kind: it.kind };
  if (id.startsWith('journal:')) return { t: 'journal', seq: it.seq, date: it.date, memo: it.memo, postings: it.postings, by: it.by, ts: it.ts, reverses: it.reverses, importKey: it.importKey ?? null, attachmentRefs: it.attachmentRefs ?? [], invoice: it.invoice ?? null, bill: it.bill ?? null };
  // A receipt image (finance/attachment:<id>). Carried as a SIDE BLOB - rebuildBook ignores t:'attachment', so
  // it never enters the ledger; DashFinanceBook pulls the data: URI out of the live delivery into its own map.
  if (id.startsWith('attachment:')) return { t: 'attachment', id: id.slice(11), data: it.data || '' };
  // Phase 3 side docs - NOT part of the book. They map to their own `t`, which rebuildBook ignores (it replays
  // only settings/account/fund/journal), so they can never disturb the journal replay or its gap/fork guard.
  // DashFinanceBook's subscribe handler collects them into SEPARATE console state (templates, reconciliations).
  if (id.startsWith('template:')) return { t: 'template', id: id.slice(9), name: it.name, account: it.account, fund: it.fund, dir: it.dir, amount: it.amount, dayOfMonth: it.dayOfMonth };
  if (id.startsWith('reconcile:')) return { t: 'reconcile', id: id.slice(10), label: it.label, lines: it.lines || [], reconciled: it.reconciled || [], closing: it.closing, asOf: it.asOf };
  // DONOR RECORD (finance/donor:<id>, Phase 4b) — member-identifying giving data, NOT part of the double-entry
  // book. Like template/reconcile it maps to its own `t`, which rebuildBook ignores, and DashFinanceBook
  // collects it into SEPARATE console state (donors) for the giving-by-member + Gift Aid screens.
  if (id.startsWith('donor:')) return { t: 'donor', id: id.slice(6), name: it.name || '', eligible: it.eligible === true, address: it.address || '', postcode: it.postcode || '', giftAidDeclaredAt: it.giftAidDeclaredAt || '', title: it.title || '', firstName: it.firstName || '', lastName: it.lastName || '', house: it.house || '' };
  // INVOICE + CONTACT side docs (Phase 5) — metadata, NOT part of the double-entry book (the money rides the
  // journal). Like template/reconcile/donor they map to their own `t`, which rebuildBook ignores, and
  // DashFinanceBook collects them into SEPARATE console state. The invoice's `status` is a DISPLAY CACHE only:
  // the real status is DERIVED from the journal + the due date (F.invoiceStatus), never read from here.
  if (id.startsWith('invoice:')) return { t: 'invoice', id: id.slice(8), number: it.number || '', contact: it.contact || '', lines: Array.isArray(it.lines) ? it.lines : [], issued: it.issued || '', due: it.due || '', credit: it.credit === true, ref: it.ref || '', issueSeq: it.issueSeq ?? null };
  if (id.startsWith('contact:')) return { t: 'contact', id: id.slice(8), name: it.name || '', email: it.email || '', address: it.address || '' };
  // ANNUAL BUDGET (finance/budget:<id>, Phase 7) — a REPLACEABLE console-only READ OVERLAY, NOT part of the
  // double-entry book. Like template/reconcile/donor it maps to its OWN `t`, which rebuildBook ignores (it
  // replays only settings/account/fund/journal), so a budget can never post to the journal or disturb the
  // replay; DashFinanceBook collects it into SEPARATE console state (budgets) for the budget-vs-actual view.
  if (id.startsWith('budget:')) return { t: 'budget', id: id.slice(7), year: it.year || '', lines: Array.isArray(it.lines) ? it.lines : [] };
  // BILL + BILL-APPROVAL side docs (Phase 6 — Accounts Payable) — metadata, NOT part of the double-entry book
  // (the money rides the journal, accrued through the reserved AP account). Like invoice/contact they map to
  // their own `t`, which rebuildBook ignores, and DashFinanceBook collects them into SEPARATE console state. The
  // bill's `approved` is the LIGHT-mode flag; status is DERIVED (F.billStatus), never read from here.
  if (id.startsWith('bill:')) return { t: 'bill', id: id.slice(5), number: it.number || '', supplier: it.supplier || '', lines: Array.isArray(it.lines) ? it.lines : [], received: it.received || '', due: it.due || '', by: it.by || '', approved: it.approved || null, receiveSeq: it.receiveSeq ?? null };
  // A DUAL-CONTROL approval (finance/billapproval:<billId>:<approverhex>). The APPROVER is read from the d-tag,
  // which the relay BINDS to the event signer (it refuses a write whose signer != the hex in the address — the
  // check-in-arrival house pattern), so it cannot be forged by another writer. `id` here is the d-tag suffix
  // after 'finance/' = 'billapproval:<billId>:<approverhex>'; split off the trailing ':'+64hex to recover both.
  if (id.startsWith('billapproval:')) {
    const rest = id.slice('billapproval:'.length);
    const cut = rest.lastIndexOf(':');
    return { t: 'billapproval', id: rest, bill: cut > 0 ? rest.slice(0, cut) : rest, approver: cut > 0 ? rest.slice(cut + 1) : '', ts: it.ts ?? null };
  }
  return null;
}
// An opaque, random id for a REPLACEABLE finance doc (template / reconciliation). Human-facing names are a
// field, never the id — two authorised writers must not collide on a shared slug and silently overwrite each
// other (CONTEXT: "replaceable finance docs need OPAQUE ids").
function opaqueId() {
  try { const a = new Uint8Array(8); (window.crypto || crypto).getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); } catch (e) {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
// Both file exports on this screen (this CSV and fsDownloadDoc's HTML below) used to build an `<a download>`
// and click it, inside a try that swallowed everything. In the APK's WebView that writes no file and says
// nothing (console audit 2026-09-19, P7). They now go through saveConsoleFile (stew-dashboard.jsx), which
// writes to Documents on the phone and is the plain download in a browser. Both resolve to the sentence the
// screen shows and REJECT when nothing was saved — the caller shows that too; nothing is swallowed here.
function booksDownload(name, text) {
  return saveConsoleFile(name, text, { mime: 'text/csv;charset=utf-8', title: 'Finance export', blurb: 'Open it in a spreadsheet.' });
}
function booksTodayISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// Shrink a chosen receipt image to a small JPEG data: URI BEFORE it is published — the relay is not a blob
// store (the journal is a thin pipe), so a photo straight off a phone camera must not go up at full size. Same
// canvas → toDataURL('image/jpeg') path the church logo/avatar already use (identity-avatar.jsx,
// stew-schedule.jsx). Caps the longest edge and steps the quality down until the data: URI is under ~200KB;
// if it still will not fit, it REJECTS rather than publish something the relay's own cap would bounce. A hard
// client cap alone is bypassable — the gateway enforces its own ceiling on finance/attachment: content.
const ATTACH_MAX_BYTES = 200 * 1024;   // ~200KB client ceiling on the encoded data: URI
function booksShrinkImage(file, { maxDim = 1400, cap = ATTACH_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || '')) { reject(new Error('Choose an image file (a photo of the receipt).')); return; }
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image this device can read.'));
      img.onload = () => {
        try {
          let w = img.width || 1, h = img.height || 1;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          let q = 0.72, uri = c.toDataURL('image/jpeg', q);
          while (uri.length > cap && q > 0.3) { q -= 0.12; uri = c.toDataURL('image/jpeg', q); }
          if (!uri || uri.length < 30) { reject(new Error('Could not process that image on this device.')); return; }
          if (uri.length > cap) { reject(new Error('That image is too large even after shrinking — try a smaller or clearer photo.')); return; }
          resolve(uri);
        } catch (e) { reject(new Error('Could not process that image on this device.')); }
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
// An opaque, collision-resistant id for a replaceable finance doc (CONTEXT: replaceable docs need OPAQUE ids —
// two writers must never derive the same one and silently overwrite). Human-facing numbers are a FIELD, never
// the id.
function booksRandId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ''); } catch (e) {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
function booksFmt(minor, book) {
  const dec = book.decimals || 2, sym = CCY_SYM[book.baseCurrency] || '';
  const s = (minor / Math.pow(10, dec)).toLocaleString('en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return book.baseCurrency === 'sats' ? (s + ' ' + sym) : (sym + s);
}
function booksParse(str, book) {
  const dec = book.decimals || 2, raw = String(str);
  // A MINUS IS A REFUSAL, NOT A HINT. Direction comes from the explicit Money In / Money Out toggle, so a
  // typed sign is ambiguous — an expense? a correction? a typo? — and the sanitiser below cannot ask. It
  // strips everything that is not a digit or a dot, so `-500` silently became +£500.00: a £1,000 error from
  // one character, found by a treasurer reconciling against a bank statement (2026-08-18). An embedded minus
  // is not an amount either — `500-600` used to parse as £500,600.
  // Refusing returns 0, which is exactly how the field already treats empty input, so the caller needs no
  // new state: Save stays disabled and nothing is posted.
  if (/[-−]/.test(raw)) return 0;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  return (!isFinite(n) || n <= 0) ? 0 : Math.round(n * Math.pow(10, dec));
}
function booksEntryView(book, e) {
  // A FUND TRANSFER IS NOT AN OUTFLOW. Both legs post to the reserved 'fund-transfer' account; without this the
  // fallback below picks postings[0] (the dr leg) and renders a transfer as a plain £X payment OUT of fund A,
  // labelled with the reserved account's name — money shown as spent that never left the church. Detect the two
  // legs and present it as "Transfer: <from> → <to>", with no +/− inflow styling (inflow:null). dr reduces a
  // fund (the source), cr increases it (the destination).
  if (e.postings.length === 2 && e.postings.every(p => p.account === 'fund-transfer')) {
    const drLeg = e.postings.find(p => p.dir === 'dr') || e.postings[0];
    const crLeg = e.postings.find(p => p.dir === 'cr') || e.postings[1];
    const fundName = id => ((book.funds.get(id) || {}).name) || id;
    const isReversal = e.reverses != null;
    const wasReversed = !isReversal && book.journal.some(j => j.reverses === e.seq);
    return { date: e.date, memo: e.memo, isTransfer: true, fundFrom: drLeg.fund, fundTo: crLeg.fund,
      category: 'Transfer: ' + fundName(drLeg.fund) + ' → ' + fundName(crLeg.fund),
      fund: null, amount: crLeg.amount, inflow: null, isReversal, wasReversed };
  }
  const other = e.postings.find(p => { const a = book.accounts.get(p.account); return a && (a.type === 'income' || a.type === 'expense'); }) || e.postings[0];
  const a = book.accounts.get(other.account);
  const isReversal = e.reverses != null;
  const wasReversed = !isReversal && book.journal.some(j => j.reverses === e.seq);
  // INFLOW IS THE DIRECTION OF THE POSTING, NOT THE KIND OF ACCOUNT. It was `a.type === 'income'`, so the reversal of a
  // £100 gift (which DEBITS the income account to take it back out) still read "+£100" in green: a deduction shown as
  // a receipt (sim round 2 finding 61). A credit to income/expense is money in (a gift; an expense taken back); a
  // debit is money out (a payment; a gift reversed).
  const inflow = !!(a && (a.type === 'income' || a.type === 'expense') && other.dir === 'cr');
  return { date: e.date, memo: e.memo, category: a ? a.name : other.account, fund: other.fund, amount: other.amount, inflow, isReversal, wasReversed };
}

const bkFld = { width: '100%', boxSizing: 'border-box', height: 44, padding: '0 13px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
const bkLbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 6px', display: 'block', textTransform: 'uppercase' };
const bkCard = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 18 };
const ACCT_TYPE_LABEL = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
const ACCT_TYPES_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];
const FUND_KIND_LABEL = { general: 'General', designated: 'Designated', restricted: 'Restricted' };
// Phase 4a aggregate report presets for the Reports panel. Each maps to a set of buildStatement section keys
// (the new keys — givingFund/fundMovements/receipts — are rendered by statementText/Html/fsBuildStatementPdf).
// All are nation-neutral and name-free; there is NO giving-by-MEMBER preset here (held as Phase 4b).
const FIN_REPORT_PRESETS = [
  { key: 'pl',       label: 'Income & expenditure', sections: ['summary', 'income', 'spending'] },
  { key: 'balance',  label: 'Balance sheet',        sections: ['summary', 'balance'] },
  { key: 'funds',    label: 'Fund summary',         sections: ['funds'] },
  { key: 'giving',   label: 'Giving by fund',       sections: ['givingFund'] },
  { key: 'rp',       label: 'Receipts & payments',  sections: ['receipts', 'funds'] },
  { key: 'trustees', label: "Trustees' report",     sections: ['summary', 'fundMovements'] },
];
// Conventional code range per type (income 4xxx, expense 5xxx, asset 1xxx, liability 2xxx, equity 3xxx):
// used to auto-suggest a code when the treasurer leaves it blank. Advisory only — ids are what the ledger keys on.
const ACCT_CODE_BASE = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 5000 };
function booksSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
function suggestCode(book, type) {
  const base = ACCT_CODE_BASE[type] || 1000;
  let n = base;
  const used = new Set([...book.accounts.values()].map(a => a.code));
  while (used.has(String(n))) n += 10;
  return String(n);
}

// ---- record a transaction (guided double-entry — the treasurer never sees "debit/credit") ----
// `initial` (optional) pre-fills the form — the "Correct this entry" flow passes the reversed entry's values
// so the treasurer re-enters a fixed copy. SPLIT: one transaction can be divided across several categories/
// funds; the per-row amounts must add up EXACTLY to the total (integer minor units) or Save is disabled —
// the bank leg is the single balancing posting, so a mismatch is exactly what the engine's balance check
// refuses. ATTACHMENT: an optional receipt image, shrunk client-side and published as a side blob.
function BooksRecord({ book, onRecord, onClose, initial, donors }) {
  const init = initial || {};
  const [dir, setDir] = React.useState(init.dir === 'out' ? 'out' : 'in');
  // Donor records (Phase 4b) to offer on a MONEY-IN entry. The picker writes the OPAQUE id, never the name.
  const donorList = Array.isArray(donors) ? donors.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) : [];
  const [donor, setDonor] = React.useState(init.donor || '');   // '' = unattributed
  // Archived accounts are hidden from the category picker (kept in the ledger/reports). The reserved
  // 'fund-transfer' account is equity, so the income/expense filter already excludes it here.
  const cats = [...book.accounts.values()].filter(a => a.type === (dir === 'in' ? 'income' : 'expense') && !a.archived);
  const funds = [...book.funds.values()];
  const [account, setAccount] = React.useState(init.account || (cats[0] ? cats[0].id : ''));
  const [fund, setFund] = React.useState(init.fund || 'general');
  const [amount, setAmount] = React.useState(init.amount || '');
  const [date, setDate] = React.useState(init.date || booksTodayISO());
  const [memo, setMemo] = React.useState(init.memo || '');
  const [err, setErr] = React.useState('');
  const [split, setSplit] = React.useState(false);
  const [rows, setRows] = React.useState([]);   // split legs: [{ account, fund, amount(major string) }]
  const [attachment, setAttachment] = React.useState(null);   // { id, data:(data:URI), name } or null
  const [attBusy, setAttBusy] = React.useState(false);
  // Reset the category when the DIRECTION changes (income ⇄ expense lists are different), but NOT on mount —
  // doing it on mount would clobber a pre-filled `initial.account`.
  const firstDir = React.useRef(true);
  React.useEffect(() => {
    if (firstDir.current) { firstDir.current = false; return; }
    const c = [...book.accounts.values()].filter(a => a.type === (dir === 'in' ? 'income' : 'expense') && !a.archived);
    setAccount(c[0] ? c[0].id : '');
    setRows(rs => rs.map(r => ({ ...r, account: c[0] ? c[0].id : '' })));
  }, [dir]);
  const total = booksParse(amount, book);
  const splitSum = rows.reduce((s, r) => s + booksParse(r.amount, book), 0);
  const splitOk = rows.length >= 1 && rows.every(r => r.account && booksParse(r.amount, book) > 0) && total > 0 && splitSum === total;
  const canSave = !attBusy && (split ? splitOk : (total > 0 && !!account));
  const addRow = () => setRows(rs => [...rs, { account: cats[0] ? cats[0].id : '', fund: 'general', amount: '' }]);
  const setRowAt = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const removeRow = (i) => setRows(rs => rs.filter((_, j) => j !== i));
  const toggleSplit = () => {
    if (split) { setSplit(false); return; }
    // open split with two rows seeded from the current single-category selection, so the common "half here,
    // half there" case is one edit away and the sum already equals the total.
    setRows([{ account, fund, amount }, { account: cats[0] ? cats[0].id : account, fund: 'general', amount: '' }]);
    setSplit(true);
  };
  const onPickAttachment = async (ev) => {
    const file = ev.target.files && ev.target.files[0]; if (ev.target) ev.target.value = '';
    if (!file) return;
    setErr(''); setAttBusy(true);
    try { const data = await booksShrinkImage(file); setAttachment({ id: booksRandId(), data, name: file.name || 'receipt' }); }
    catch (e) { setAttachment(null); setErr((e && e.message) || 'Could not attach that image.'); }
    setAttBusy(false);
  };
  const submit = () => {
    const tot = booksParse(amount, book);
    if (!tot) return setErr('Enter an amount greater than zero.');
    let legs;
    if (split) {
      legs = rows.map(r => ({ account: r.account, fund: r.fund, amountMinor: booksParse(r.amount, book) }));
      if (legs.some(l => !l.account)) return setErr('Pick a category for every split row.');
      if (legs.some(l => !(l.amountMinor > 0))) return setErr('Enter an amount greater than zero for every split row.');
      if (legs.reduce((s, l) => s + l.amountMinor, 0) !== tot) return setErr('The split rows must add up to the total (' + booksFmt(tot, book) + ').');
    } else {
      if (!account) return setErr('Pick a category.');
      legs = [{ account, fund, amountMinor: tot }];
    }
    // Donor only on money-in; the OPAQUE id (BooksRecord never sends a name). record() applies it to the income legs.
    try { onRecord({ dir, legs, totalMinor: tot, date, memo: memo.trim(), attachment, donor: dir === 'in' ? donor : '' }); onClose(); }
    catch (e) { setErr(e.message || 'Could not record that.'); }
  };
  // WHICH WAY THE MONEY GOES, CARRIED BY MORE THAN COLOUR.
  //
  // This was two plain buttons whose only signal of which was chosen was their background colour. Three
  // separate people across rounds 7 and 8 pressed "Money out", did not notice it had not taken, and recorded
  // an EXPENSE AS INCOME. Verified in the ledger: "Hall hire — bank dr 9500 | other-income cr 9500". One
  // treasurer's arithmetic and the app's disagreed by exactly double her three outgoings, because none of
  // them was ever subtracted.
  //
  // For a church that is the worst kind of quiet wrong: the books balance internally, look perfectly
  // plausible, and say the parish earned money by hiring a hall out.
  //
  // So: aria-pressed (a screen reader can now say which is active, and so can anything automated), and a
  // + / − in the label so the state has a SHAPE, not just a hue — for bright sunlight, a cheap screen, and
  // anyone who does not distinguish sage from clay.
  const seg = (v, label) => (
    <button onClick={() => setDir(v)} title={v === 'in' ? 'Record money coming in, such as a gift' : 'Record money going out, such as a bill'} aria-pressed={dir === v} aria-label={label + (dir === v ? ' (selected)' : '')}
      style={{ flex: 1, height: 42, border: dir === v ? '2px solid transparent' : '2px dashed var(--line)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 14,
      background: dir === v ? (v === 'in' ? 'var(--sage, #6b9b7a)' : 'var(--clay)') : 'transparent', color: dir === v ? '#fff' : 'var(--ink-3)' }}>{(v === 'in' ? '+ ' : '− ') + label}</button>
  );
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Record a transaction" tabIndex={-1} style={{ ...bkCard, width: 420, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>{init.correctingSeq ? 'Correct a transaction' : 'Record a transaction'}</h3>
        {init.correctingSeq ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '-8px 0 12px', lineHeight: 1.45 }}>The original entry has been reversed. Enter the corrected version below — both stay in the ledger.</div> : null}
        <div style={{ display: 'flex', gap: 6, background: 'var(--surface-2, #f2efe9)', borderRadius: 12, padding: 4, marginBottom: 14 }}>{seg('in', 'Money in')}{seg('out', 'Money out')}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label style={{ ...bkLbl, margin: 0 }}>{split ? 'Categories' : 'Category'}</label>
          <button onClick={toggleSplit} title={split ? 'Put this transaction under a single category' : 'Divide this transaction across more than one category or fund'} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--clay)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, padding: 0 }}>{split ? 'Use a single category' : 'Split across categories'}</button>
        </div>
        {!split ? (<>
          <select value={account} onChange={e => setAccount(e.target.value)} aria-label="Category" style={{ ...bkFld, marginBottom: 12 }}>{cats.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <label style={bkLbl}>Fund</label>
          <select value={fund} onChange={e => setFund(e.target.value)} aria-label="Fund" style={{ ...bkFld, marginBottom: 12 }}>{funds.map(f => <option key={f.id} value={f.id}>{f.name}{f.kind === 'restricted' ? ' (restricted)' : ''}</option>)}</select>
        </>) : (<>
          <div style={{ border: '1px solid var(--line)', borderRadius: 11, padding: 8, marginBottom: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <select value={r.account} onChange={e => setRowAt(i, { account: e.target.value })} aria-label={'Split category ' + (i + 1)} style={{ ...bkFld, height: 36, fontSize: 13, padding: '0 8px', flex: 1 }}>{cats.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                <select value={r.fund} onChange={e => setRowAt(i, { fund: e.target.value })} aria-label={'Split fund ' + (i + 1)} style={{ ...bkFld, height: 36, fontSize: 13, padding: '0 8px', width: 112 }}>{funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                <input value={r.amount} onChange={e => setRowAt(i, { amount: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label={'Split amount ' + (i + 1)} style={{ ...bkFld, height: 36, fontSize: 13, padding: '0 8px', width: 84 }} />
                <button onClick={() => removeRow(i)} title="Remove this split row" aria-label={'Remove split row ' + (i + 1)} disabled={rows.length <= 1} style={{ border: 'none', background: 'transparent', cursor: rows.length <= 1 ? 'default' : 'pointer', color: 'var(--ink-3)', fontSize: 16, padding: 2, opacity: rows.length <= 1 ? 0.4 : 1 }}>×</button>
              </div>
            ))}
            <button onClick={addRow} style={{ border: '1px dashed var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>+ Add category</button>
          </div>
          <div style={{ fontSize: 12.5, marginBottom: 12, color: splitSum === total && total > 0 ? 'var(--sage, #4f7a5e)' : 'var(--clay-deep, #b4462f)', fontWeight: 600 }}>
            Split {booksFmt(splitSum, book)} of {booksFmt(total, book)}{total > 0 && splitSum !== total ? ' · ' + (splitSum < total ? booksFmt(total - splitSum, book) + ' left to assign' : booksFmt(splitSum - total, book) + ' over') : ''}
          </div>
        </>)}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={bkLbl}>{split ? 'Total' : 'Amount'} ({CCY_SYM[book.baseCurrency] || book.baseCurrency})</label><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Amount" style={bkFld} /></div>
          <div style={{ flex: 1 }}><label style={bkLbl}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={bkFld} /></div>
        </div>
        <label style={bkLbl}>Note (optional)</label>
        <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="e.g. Sunday offering" style={{ ...bkFld, marginBottom: 12 }} />
        {/* DONOR — money-in only (a gift has a giver; a bill does not). Writes the OPAQUE id, never the name.
            Feeds giving-by-member + the Gift Aid pack. "(unattributed)" leaves the gift off both, which is the
            right default for plate cash nobody is named against. */}
        {dir === 'in' ? (<>
          <label style={bkLbl}>Donor (optional)</label>
          <select value={donor} onChange={e => setDonor(e.target.value)} aria-label="Donor" style={{ ...bkFld, marginBottom: donorList.length ? 12 : 4 }}>
            <option value="">(unattributed)</option>
            {donorList.map(d => <option key={d.id} value={d.id}>{d.name || '(unnamed)'}</option>)}
          </select>
          {donorList.length === 0 ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>Add donors under “Donors &amp; giving by member” to attribute gifts here.</div> : null}
        </>) : null}
        <label style={bkLbl}>Receipt (optional)</label>
        {attachment
          ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, border: '1px solid var(--line)', borderRadius: 11, padding: 8 }}>
              <img src={attachment.data} alt="Receipt preview" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.name}</div>
              <button onClick={() => setAttachment(null)} title="Remove this receipt" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>Remove</button>
            </div>
          : <input type="file" accept="image/*" onChange={onPickAttachment} aria-label="Attach a receipt image" disabled={attBusy} style={{ ...bkFld, height: 'auto', padding: 9, marginBottom: 8, lineHeight: 1.4 }} />}
        {attBusy ? <p style={{ color: 'var(--ink-3)', fontSize: 12.5, margin: '0 0 4px' }}>Preparing the image…</p> : null}
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          {/* THE LAST THING YOU TOUCH NAMES THE DIRECTION. If the toggle above did not take, this is where a
              person sees it — "Record money IN" under a hall-hire note reads wrong at a glance, which a bare
              "Record" never could. */}
          <button onClick={submit} disabled={!canSave} style={{ flex: 2, height: 44, border: 'none', background: canSave ? 'var(--clay)' : 'var(--line)', color: 'var(--on-clay)', borderRadius: 11, cursor: canSave ? 'pointer' : 'default', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>
            {'Record money ' + (dir === 'in' ? 'IN' : 'OUT') + (total > 0 ? ' · ' + (dir === 'in' ? '+' : '−') + booksFmt(total, book) : '')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- create / edit an account (a category in the chart of accounts) ----
// finance/account:<id> is REPLACEABLE, so editing is a re-publish of the same id. TYPE is locked once the
// account has postings (initial.posted) — changing it would silently re-sign every projection. `archived` is
// carried through unchanged here (the Archive button in the list owns that flag).
function BooksAccountEdit({ book, initial, onSave, onClose }) {
  const ed = initial || {};
  const editing = !!ed.id;
  const [name, setName] = React.useState(ed.name || '');
  const [type, setType] = React.useState(ed.type || 'income');
  const [code, setCode] = React.useState(ed.code || '');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const dlgRef = useStewDialog(onClose);
  const submit = async () => {
    const nm = name.trim();
    if (!nm) return setErr('Give the account a name.');
    const id = editing ? ed.id : (booksSlug(nm) || booksSlug(code) || code);
    if (!id) return setErr('Give the account a name or a code.');
    const cd = (code || '').trim() || suggestCode(book, type);
    if (!editing && book.accounts.has(id)) return setErr('There is already an account called that — pick another name.');
    setBusy(true); setErr('');
    try {
      const ok = await onSave({ id, code: cd, name: nm, type, archived: !!ed.archived });
      if (ok) onClose(); else { setBusy(false); setErr('That didn’t save — your church’s relay refused or did not answer. Try again.'); }
    } catch (e) { setBusy(false); setErr((e && e.message) || 'Could not save that account.'); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 66, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={editing ? 'Edit account' : 'Add account'} tabIndex={-1} style={{ ...bkCard, width: 420, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>{editing ? 'Edit account' : 'Add account'}</h3>
        <label style={bkLbl}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Youth work" style={{ ...bkFld, marginBottom: 12 }} />
        <label style={bkLbl}>Type</label>
        <select value={type} disabled={editing && !!ed.posted} onChange={e => setType(e.target.value)} style={{ ...bkFld, marginBottom: ed.posted ? 4 : 12, opacity: (editing && ed.posted) ? 0.6 : 1 }}>
          {ACCT_TYPES_ORDER.map(t => <option key={t} value={t}>{ACCT_TYPE_LABEL[t] || t}</option>)}
        </select>
        {editing && ed.posted ? <p style={{ color: 'var(--ink-3)', fontSize: 12, margin: '0 0 12px' }}>The type can’t change once an account has transactions — it would re-sign every report.</p> : null}
        <label style={bkLbl}>Code (optional)</label>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder={suggestCode(book, type)} inputMode="numeric" style={{ ...bkFld, marginBottom: 8 }} />
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>{editing ? 'Save changes' : 'Add account'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- create / edit a fund ----
// finance/fund:<id> is REPLACEABLE (edit = re-publish same id). The implicit 'general' fund is never offered
// here (the list shows no Edit for it, and the console's saveFund refuses id 'general').
function BooksFundEdit({ book, initial, onSave, onClose }) {
  const ed = initial || {};
  const editing = !!ed.id;
  const [name, setName] = React.useState(ed.name || '');
  const [kind, setKind] = React.useState(ed.kind || 'designated');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const dlgRef = useStewDialog(onClose);
  const submit = async () => {
    const nm = name.trim();
    if (!nm) return setErr('Give the fund a name.');
    const id = editing ? ed.id : booksSlug(nm);
    if (!id || id === 'general') return setErr('Pick another name for the fund.');
    if (!editing && book.funds.has(id)) return setErr('There is already a fund called that — pick another name.');
    setBusy(true); setErr('');
    try {
      const ok = await onSave({ id, name: nm, kind });
      if (ok) onClose(); else { setBusy(false); setErr('That didn’t save — your church’s relay refused or did not answer. Try again.'); }
    } catch (e) { setBusy(false); setErr((e && e.message) || 'Could not save that fund.'); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 66, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={editing ? 'Edit fund' : 'Add fund'} tabIndex={-1} style={{ ...bkCard, width: 420, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>{editing ? 'Edit fund' : 'Add fund'}</h3>
        <label style={bkLbl}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Building fund" style={{ ...bkFld, marginBottom: 12 }} />
        <label style={bkLbl}>Kind</label>
        <select value={kind} onChange={e => setKind(e.target.value)} style={{ ...bkFld, marginBottom: 8 }}>
          <option value="designated">Designated</option>
          <option value="restricted">Restricted</option>
          <option value="general">General (unrestricted)</option>
        </select>
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>{editing ? 'Save changes' : 'Add fund'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- customer / contact (Phase 5) -----------------------------------------------------------------------
// A customer the church invoices (facility hire is the big UK-church case). Published as a REPLACEABLE
// finance/contact:<id> doc with an OPAQUE id (onSave mints one for a new contact). PII, kept private to the
// church like the rest of finance/. The invoice stores the contact NAME as a plain field, so an invoice reads
// correctly even if the contact record is later edited or removed.
function BooksContact({ initial, onSave, onClose }) {
  const ed = initial || {};
  const editing = !!ed.id;
  const [name, setName] = React.useState(ed.name || '');
  const [email, setEmail] = React.useState(ed.email || '');
  const [address, setAddress] = React.useState(ed.address || '');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const dlgRef = useStewDialog(onClose);
  const submit = async () => {
    const nm = name.trim();
    if (!nm) return setErr('Give the contact a name.');
    setBusy(true); setErr('');
    try {
      const ok = await onSave({ id: editing ? ed.id : undefined, name: nm, email: email.trim(), address: address.trim() });
      if (ok) onClose(); else { setBusy(false); setErr('That didn’t save — your church’s relay refused or did not answer. Try again.'); }
    } catch (e) { setBusy(false); setErr((e && e.message) || 'Could not save that contact.'); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 66, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={editing ? 'Edit contact' : 'Add contact'} tabIndex={-1} style={{ ...bkCard, width: 440, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>{editing ? 'Edit contact' : 'Add contact'}</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>A customer you invoice — kept private to your church.</div>
        <label style={bkLbl}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Scout group / Jane Okafor" style={{ ...bkFld, marginBottom: 12 }} />
        <label style={bkLbl}>Email (optional)</label>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.org" style={{ ...bkFld, marginBottom: 12 }} />
        <label style={bkLbl}>Address (optional)</label>
        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street & postcode" style={{ ...bkFld, marginBottom: 12 }} />
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>{editing ? 'Save changes' : 'Add contact'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- invoice editor (Phase 5) ---------------------------------------------------------------------------
// Create and ISSUE an invoice: one or more line items (each an income category + fund + amount), a contact, a
// number, an issue date and a due date. Issuing posts the accrual journal entry (dr Accounts-Receivable / cr
// income) and publishes the metadata doc — the parent's onIssue does both and mints the opaque id. Amounts are
// typed in major units and parsed to integer minor units (booksParse), the same as every other finance form.
function BooksInvoiceEdit({ book, contacts, onIssue, onClose }) {
  const income = [...book.accounts.values()].filter(a => a.type === 'income' && !a.archived);
  const funds = [...book.funds.values()];
  const contactList = Array.isArray(contacts) ? contacts.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) : [];
  const [number, setNumber] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [issued, setIssued] = React.useState(booksTodayISO());
  const [due, setDue] = React.useState('');
  const [rows, setRows] = React.useState([{ desc: '', account: income[0] ? income[0].id : '', fund: 'general', amount: '' }]);
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const dlgRef = useStewDialog(onClose);
  const setRowAt = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(rs => [...rs, { desc: '', account: income[0] ? income[0].id : '', fund: 'general', amount: '' }]);
  const removeRow = (i) => setRows(rs => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs);
  const total = rows.reduce((s, r) => s + booksParse(r.amount, book), 0);
  const canIssue = !busy && income.length > 0 && rows.some(r => r.account && booksParse(r.amount, book) > 0) && rows.every(r => !r.amount || booksParse(r.amount, book) >= 0);
  const submit = async () => {
    const lines = rows.map(r => ({ desc: r.desc.trim(), account: r.account, fund: r.fund, amount: booksParse(r.amount, book) })).filter(l => l.account && l.amount > 0);
    if (!lines.length) return setErr('Add at least one line with a category and an amount greater than zero.');
    setBusy(true); setErr('');
    try {
      const ok = await onIssue({ number: number.trim(), contact: contact.trim(), lines, issued, due });
      if (ok) onClose(); else { setBusy(false); setErr('That didn’t issue — your church’s relay refused or did not answer. Nothing was recorded.'); }
    } catch (e) { setBusy(false); setErr((e && e.message) || 'Could not issue that invoice.'); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 66, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Create an invoice" tabIndex={-1} style={{ ...bkCard, width: 520, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>New invoice</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>Issuing records the income now (accrual) and tracks what is still owed. The payment is recorded separately when it arrives.</div>
        {income.length === 0 && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '0 0 10px' }}>Add an income category first (Accounts &amp; funds) — an invoice needs one to credit.</p>}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={bkLbl}>Invoice number</label><input value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. 2026-014" style={bkFld} /></div>
          <div style={{ flex: 1 }}><label style={bkLbl}>Billed to</label><input list="fin-contact-list" value={contact} onChange={e => setContact(e.target.value)} placeholder="Customer name" style={bkFld} />
            <datalist id="fin-contact-list">{contactList.map(c => <option key={c.id} value={c.name} />)}</datalist>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={bkLbl}>Issued</label><input type="date" value={issued} onChange={e => setIssued(e.target.value)} style={bkFld} /></div>
          <div style={{ flex: 1 }}><label style={bkLbl}>Due</label><input type="date" value={due} onChange={e => setDue(e.target.value)} style={bkFld} /></div>
        </div>
        <label style={bkLbl}>Lines</label>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input value={r.desc} onChange={e => setRowAt(i, { desc: e.target.value })} placeholder="Description" style={{ ...bkFld, flex: 2 }} />
            <select value={r.account} onChange={e => setRowAt(i, { account: e.target.value })} style={{ ...bkFld, flex: 1, padding: '0 8px' }}>{income.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <select value={r.fund} onChange={e => setRowAt(i, { fund: e.target.value })} style={{ ...bkFld, width: 110, padding: '0 8px' }}>{funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <input value={r.amount} onChange={e => setRowAt(i, { amount: e.target.value })} inputMode="decimal" placeholder="0.00" style={{ ...bkFld, width: 92 }} />
            {rows.length > 1 && <button onClick={() => removeRow(i)} aria-label="Remove line" title="Remove this line" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 16, padding: 4 }}>×</button>}
          </div>
        ))}
        <button onClick={addRow} style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>+ Add line</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 700 }}>Total</span>
          <span style={{ fontSize: 17, fontWeight: 800 }}>{booksFmt(total, book)}</span>
        </div>
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '8px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} disabled={!canIssue} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: canIssue ? 'pointer' : 'default', opacity: canIssue ? 1 : 0.5, fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Issue invoice</button>
        </div>
      </div>
    </div>
  );
}

// ---- bill editor (Phase 6 — Accounts Payable) -----------------------------------------------------------
// Record a bill the church has RECEIVED: one or more line items (each an EXPENSE category + fund + amount), a
// supplier, a reference number, a received date and a due date. Recording posts the accrual journal entry (dr
// expense / cr Accounts-Payable) and publishes the metadata doc — the parent's onSave does both and mints the
// opaque id. It does NOT approve: approval + payment are separate steps on the Bills list. Amounts are typed in
// major units and parsed to integer minor units (booksParse), the same as every other finance form. The
// supplier field reuses the finance/contact: list (suppliers and customers share that record kind).
function BooksBillEdit({ book, contacts, onSave, onClose }) {
  const expense = [...book.accounts.values()].filter(a => a.type === 'expense' && !a.archived);
  const funds = [...book.funds.values()];
  const supplierList = Array.isArray(contacts) ? contacts.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) : [];
  const [number, setNumber] = React.useState('');
  const [supplier, setSupplier] = React.useState('');
  const [received, setReceived] = React.useState(booksTodayISO());
  const [due, setDue] = React.useState('');
  const [rows, setRows] = React.useState([{ desc: '', account: expense[0] ? expense[0].id : '', fund: 'general', amount: '' }]);
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const dlgRef = useStewDialog(onClose);
  const setRowAt = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(rs => [...rs, { desc: '', account: expense[0] ? expense[0].id : '', fund: 'general', amount: '' }]);
  const removeRow = (i) => setRows(rs => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs);
  const total = rows.reduce((s, r) => s + booksParse(r.amount, book), 0);
  const canSave = !busy && expense.length > 0 && rows.some(r => r.account && booksParse(r.amount, book) > 0) && rows.every(r => !r.amount || booksParse(r.amount, book) >= 0);
  const submit = async () => {
    const lines = rows.map(r => ({ desc: r.desc.trim(), account: r.account, fund: r.fund, amount: booksParse(r.amount, book) })).filter(l => l.account && l.amount > 0);
    if (!lines.length) return setErr('Add at least one line with a category and an amount greater than zero.');
    setBusy(true); setErr('');
    try {
      const ok = await onSave({ number: number.trim(), supplier: supplier.trim(), lines, received, due });
      if (ok) onClose(); else { setBusy(false); setErr('That didn’t record — your church’s relay refused or did not answer. Nothing was recorded.'); }
    } catch (e) { setBusy(false); setErr((e && e.message) || 'Could not record that bill.'); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 66, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Record a bill" tabIndex={-1} style={{ ...bkCard, width: 520, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>New bill</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>Recording books the expense now (accrual) and tracks what you owe. It must be approved before you can mark it paid.</div>
        {expense.length === 0 && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '0 0 10px' }}>Add an expense category first (Accounts &amp; funds) — a bill needs one to charge.</p>}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={bkLbl}>Reference</label><input value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. INV-4471" style={bkFld} /></div>
          <div style={{ flex: 1 }}><label style={bkLbl}>Supplier</label><input list="fin-supplier-list" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Supplier name" style={bkFld} />
            <datalist id="fin-supplier-list">{supplierList.map(c => <option key={c.id} value={c.name} />)}</datalist>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={bkLbl}>Received</label><input type="date" value={received} onChange={e => setReceived(e.target.value)} style={bkFld} /></div>
          <div style={{ flex: 1 }}><label style={bkLbl}>Due</label><input type="date" value={due} onChange={e => setDue(e.target.value)} style={bkFld} /></div>
        </div>
        <label style={bkLbl}>Lines</label>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input value={r.desc} onChange={e => setRowAt(i, { desc: e.target.value })} placeholder="Description" style={{ ...bkFld, flex: 2 }} />
            <select value={r.account} onChange={e => setRowAt(i, { account: e.target.value })} style={{ ...bkFld, flex: 1, padding: '0 8px' }}>{expense.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <select value={r.fund} onChange={e => setRowAt(i, { fund: e.target.value })} style={{ ...bkFld, width: 110, padding: '0 8px' }}>{funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <input value={r.amount} onChange={e => setRowAt(i, { amount: e.target.value })} inputMode="decimal" placeholder="0.00" style={{ ...bkFld, width: 92 }} />
            {rows.length > 1 && <button onClick={() => removeRow(i)} aria-label="Remove line" title="Remove this line" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 16, padding: 4 }}>×</button>}
          </div>
        ))}
        <button onClick={addRow} style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>+ Add line</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 700 }}>Total</span>
          <span style={{ fontSize: 17, fontWeight: 800 }}>{booksFmt(total, book)}</span>
        </div>
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '8px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} disabled={!canSave} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: canSave ? 'pointer' : 'default', opacity: canSave ? 1 : 0.5, fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Record bill</button>
        </div>
      </div>
    </div>
  );
}

// ---- donor record (Phase 4b) ----------------------------------------------------------------------------
// A donor's name + (for Gift Aid) address, postcode and declaration date. The single most member-identifying
// finance doc: it is published finance-only and the relay keeps it off a network peer. Opaque id (onSave mints
// one for a new donor). Marking a donor "eligible" + recording a declaration date is what lets the UK Gift Aid
// pack build a claim line for them; it does nothing on its own and nothing at all unless the church turns the
// Gift Aid feature on.
function BooksDonor({ book, initial, onSave, onClose }) {
  const ed = initial || {};
  const editing = !!ed.id;
  const [name, setName] = React.useState(ed.name || '');
  const [eligible, setEligible] = React.useState(ed.eligible === true);
  const [address, setAddress] = React.useState(ed.address || '');
  const [postcode, setPostcode] = React.useState(ed.postcode || '');
  const [giftAidDeclaredAt, setDeclaredAt] = React.useState(ed.giftAidDeclaredAt || '');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const dlgRef = useStewDialog(onClose);
  const submit = async () => {
    const nm = name.trim();
    if (!nm) return setErr('Give the donor a name.');
    setBusy(true); setErr('');
    try {
      const ok = await onSave({ id: editing ? ed.id : undefined, name: nm, eligible, address: address.trim(), postcode: postcode.trim(), giftAidDeclaredAt });
      if (ok) onClose(); else { setBusy(false); setErr('That didn’t save — your church’s relay refused or did not answer. Try again.'); }
    } catch (e) { setBusy(false); setErr((e && e.message) || 'Could not save that donor.'); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 66, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label={editing ? 'Edit donor' : 'Add donor'} tabIndex={-1} style={{ ...bkCard, width: 440, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>{editing ? 'Edit donor' : 'Add donor'}</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>Kept private to your church — only the church key and a Finance steward can ever read it.</div>
        <label style={bkLbl}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane Okafor" style={{ ...bkFld, marginBottom: 12 }} />
        <label onClick={() => setEligible(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 12 }}>
          <input type="checkbox" checked={eligible} onChange={e => setEligible(e.target.checked)} aria-label="Eligible for Gift Aid" style={{ width: 18, height: 18 }} />
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Has made a Gift Aid declaration (UK)</span>
        </label>
        <label style={bkLbl}>Address (for a Gift Aid claim)</label>
        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="House name/number & street" style={{ ...bkFld, marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={bkLbl}>Postcode</label><input value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="e.g. SW1A 1AA" style={bkFld} /></div>
          <div style={{ flex: 1 }}><label style={bkLbl}>Declaration date</label><input type="date" value={giftAidDeclaredAt} onChange={e => setDeclaredAt(e.target.value)} style={bkFld} /></div>
        </div>
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>{editing ? 'Save changes' : 'Add donor'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- BUDGET (Phase 7) — CONSOLE-ONLY READ OVERLAY, finance-gated -----------------------------------------
// BUDGET VS ACTUAL. Compares a saved annual budget to the period's actuals via the PURE F.budgetVsActual
// engine and flags each OVER-BUDGET expense line with a badge. The variance warning is a computed flag on
// THIS screen only: there is NO member notification and NO relay doc for it (a budget never posts to the
// journal). Lives inside the finance screen, already behind the finance-key gate. Empty budget → the engine
// returns no rows → no badge, no false alert (the "No budget set" line shows instead).
function BooksBudgetReport({ book, F, budget, from, to }) {
  const rows = (F && F.budgetVsActual ? F.budgetVsActual(book, budget, { from, to }) : []).map(r => ({
    ...r,
    name: (book.accounts.get(r.account) || {}).name || r.account,
    fundName: r.fund ? ((book.funds.get(r.fund) || {}).name || r.fund) : '',
  }));
  if (!rows.length) return (
    <div style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '6px 0' }}>No budget set for this period yet — tap “Edit budget” to plan income and spending by category.</div>
  );
  return (
    <div>
      <div style={{ display: 'flex', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 700, padding: '0 0 3px' }}>
        <span style={{ flex: 1 }}>Category</span>
        <span style={{ width: 90, textAlign: 'right' }}>Budget</span>
        <span style={{ width: 90, textAlign: 'right' }}>Actual</span>
        <span style={{ width: 90, textAlign: 'right' }}>Variance</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.account + ':' + (r.fund || '') + ':' + i} style={{ display: 'flex', alignItems: 'center', fontSize: 13, padding: '5px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {r.name}{r.fundName ? <span style={{ color: 'var(--ink-3)', fontSize: 12 }}> · {r.fundName}</span> : null}
            {r.over ? <span data-budget-badge="over" title="Spending is over the budgeted amount" style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'color-mix(in oklab, var(--clay) 16%, var(--surface))', color: 'var(--clay-deep, #b4462f)', border: '1px solid color-mix(in oklab, var(--clay) 34%, var(--line))', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 800 }}>Over by {booksFmt(r.overBy, book)}</span> : null}
          </span>
          <span style={{ width: 90, textAlign: 'right' }}>{booksFmt(r.budget, book)}</span>
          <span style={{ width: 90, textAlign: 'right' }}>{booksFmt(r.actual, book)}</span>
          <span style={{ width: 90, textAlign: 'right', color: r.over ? 'var(--clay-deep, #b4462f)' : 'var(--ink-2)', fontWeight: r.over ? 800 : 400 }}>{booksFmt(r.variance, book)}</span>
        </div>
      ))}
    </div>
  );
}

// THE BUDGET EDITOR. One row per budget line: a category (income/expense account), an optional fund (— All
// funds — for an account-wide line, or a specific fund for a per-fund line), and an amount. Saves a
// finance/budget:<id> doc (REPLACEABLE, opaque id) — NEVER a finance/journal: doc. Amounts are entered in
// major units and stored as integer minor units.
function BooksBudgetEdit({ book, initial, onSave, onClose }) {
  const ed = initial || {};
  const div = Math.pow(10, book.decimals || 2);
  const cats = [...book.accounts.values()].filter(a => (a.type === 'income' || a.type === 'expense') && a.id !== 'fund-transfer');
  const funds = [...book.funds.values()];
  const seed = (Array.isArray(ed.lines) ? ed.lines : []).map(l => ({ account: l.account, fund: l.fund || '', amount: l.amount ? String(l.amount / div) : '' }));
  const [rows, setRows] = React.useState(seed.length ? seed : [{ account: cats[0] ? cats[0].id : '', fund: '', amount: '' }]);
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const dlgRef = useStewDialog(onClose);
  const setRowAt = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(rs => [...rs, { account: cats[0] ? cats[0].id : '', fund: '', amount: '' }]);
  const removeRow = (i) => setRows(rs => rs.filter((_, j) => j !== i));
  const submit = async () => {
    const lines = rows.filter(r => r.account && booksParse(r.amount, book) > 0).map(r => ({ account: r.account, fund: r.fund || '', amount: booksParse(r.amount, book) }));
    if (!lines.length) return setErr('Add at least one category with an amount greater than zero.');
    setBusy(true); setErr('');
    try {
      const ok = await onSave({ id: ed.id, year: ed.year || '', lines });
      if (ok) onClose(); else { setBusy(false); setErr('That didn’t save — your church’s relay refused or did not answer. Try again.'); }
    } catch (e) { setBusy(false); setErr((e && e.message) || 'Could not save that budget.'); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 64, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Edit budget" tabIndex={-1} style={{ ...bkCard, width: 560, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>{ed.year ? 'Budget ' + ed.year : 'Budget'}</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>A plan, not a posting — this never moves money or changes your ledger. It only shows how spending compares to plan.</div>
        <div style={{ display: 'flex', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 700, padding: '0 0 4px' }}>
          <span style={{ flex: 1 }}>Category</span>
          <span style={{ width: 150 }}>Fund</span>
          <span style={{ width: 110, textAlign: 'right' }}>Amount ({CCY_SYM[book.baseCurrency] || book.baseCurrency})</span>
          <span style={{ width: 34 }} />
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--line)' }}>
            <select value={r.account} onChange={e => setRowAt(i, { account: e.target.value })} style={{ ...bkFld, flex: 1, minWidth: 0 }}>{cats.map(a => <option key={a.id} value={a.id}>{a.name}{a.type === 'income' ? ' (in)' : ' (out)'}</option>)}</select>
            <select value={r.fund} onChange={e => setRowAt(i, { fund: e.target.value })} style={{ ...bkFld, width: 150 }}><option value="">— All funds —</option>{funds.map(f => <option key={f.id} value={f.id}>{f.name}{f.kind === 'restricted' ? ' (restricted)' : f.kind === 'designated' ? ' (designated)' : ''}</option>)}</select>
            <input value={r.amount} onChange={e => setRowAt(i, { amount: e.target.value })} inputMode="decimal" placeholder="0.00" style={{ ...bkFld, width: 110, textAlign: 'right' }} />
            <button onClick={() => removeRow(i)} aria-label="Remove this budget line" title="Remove this line" style={{ width: 34, height: 34, border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--ink-3)', fontSize: 16 }}>×</button>
          </div>
        ))}
        <button onClick={addRow} style={{ marginTop: 10, border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>+ Add a category</button>
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '10px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Save budget</button>
        </div>
      </div>
    </div>
  );
}

// ---- giving by MEMBER (Phase 4b) — CONSOLE-ONLY, finance-gated, NAME-BEARING ------------------------------
// This is the ONE finance report that carries member names + amounts. It renders inside the finance screen
// (already behind the finance-key gate) and it DELIBERATELY has no Share / Post-to-members control: aggregate
// statements are name-free and this one must never reach the broadcast path. If you ever add a share button
// here, finance-giving-by-member.test.mjs turns red by design.
function BooksGivingByMember({ book, F, donors }) {
  const rows = F.givingByMember(book, { donors });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...bkLbl, margin: '6px 0 4px' }}>Giving by member</div>
      <div style={{ color: 'var(--ink-3)', fontSize: 12, marginBottom: 6 }}>Private to this console. Never shared or posted to members.</div>
      {rows.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '6px 0' }}>No giving has been attributed to a donor yet. Tag a gift with a donor when you record it.</div>}
      {rows.map(r => (
        <div key={r.donor || 'unattributed'} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '3px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ color: r.unattributed ? 'var(--ink-3)' : 'var(--ink)' }}>{r.name}{r.eligible ? <span style={{ color: 'var(--sage, #4f7a5e)', fontSize: 11, fontWeight: 700, marginLeft: 6 }}>Gift Aid</span> : null}</span>
          <span style={{ fontWeight: 700 }}>{booksFmt(r.amount, book)}</span>
        </div>
      ))}
      {rows.length > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0 0', fontWeight: 800 }}><span>Total attributed</span><span>{booksFmt(total, book)}</span></div>}
    </div>
  );
}

// ---- UK Gift Aid pack panel (Phase 4b) — OFF BY DEFAULT, additive -----------------------------------------
// Renders NOTHING unless the church turned Gift Aid on (church.features.giftAid === true, passed as giftAidOn).
// The claim logic lives in the SEPARATE window.FinanceGiftAid bundle (vendor/finance-giftaid.js) which the core
// never imports; this panel is the only caller, and it reaches for it only when the toggle is on. If the bundle
// is not present the panel says so rather than crashing.
function BooksGiftAidPanel({ book, F, donors, giftAidOn, onExport }) {
  if (!giftAidOn) return null;
  const pack = (typeof window !== 'undefined' && window.FinanceGiftAid) || null;
  if (!pack) return <div style={{ ...bkCard, marginBottom: 16 }}><div style={{ fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16, marginBottom: 6 }}>Gift Aid (UK)</div><div style={{ color: 'var(--ink-3)', fontSize: 13 }}>The Gift Aid pack is enabled but its module hasn’t loaded. Reload the console.</div></div>;
  const donorList = Array.isArray(donors) ? donors : [...donors.values()];
  const claim = pack.giftAidClaim(book, { donors: donorList, givingByMember: F.givingByMember });
  return (
    <div style={{ ...bkCard, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16 }}>Gift Aid claim (UK)</div>
        <button onClick={() => onExport && onExport(claim)} title="Download the Gift Aid claim schedule as a spreadsheet (CSV)" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 9, padding: '6px 11px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>Download claim (CSV)</button>
      </div>
      <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 8 }}>Eligible, declared donors only. Reclaims 25p per £1 given.</div>
      {claim.rows.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '4px 0' }}>No eligible donors with a declaration and giving in this period yet.</div>}
      {claim.rows.map(r => (
        <div key={r.donor} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '3px 0', borderTop: '1px solid var(--line)' }}>
          <span>{r.name}{r.postcode ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {r.postcode}</span> : ''}</span>
          <span style={{ fontWeight: 700 }}>{booksFmt(r.donated, book)} → {booksFmt(r.giftAid, book)}</span>
        </div>
      ))}
      {claim.rows.length > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0 0', fontWeight: 800 }}><span>Total to reclaim</span><span>{booksFmt(claim.totalGiftAid, book)}</span></div>}
    </div>
  );
}

// ---- move money between funds (a balanced, income/expenditure-neutral journal entry) ----
function BooksFundMove({ book, onTransfer, onClose }) {
  const fundList = [...book.funds.values()];
  const [fromFund, setFromFund] = React.useState(fundList[0] ? fundList[0].id : 'general');
  const [toFund, setToFund] = React.useState(fundList[1] ? fundList[1].id : (fundList[0] ? fundList[0].id : 'general'));
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState(booksTodayISO());
  const [memo, setMemo] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const dlgRef = useStewDialog(onClose);
  const submit = async () => {
    const minor = booksParse(amount, book);
    if (!minor) return setErr('Enter an amount greater than zero.');
    if (fromFund === toFund) return setErr('Pick two different funds.');
    setBusy(true); setErr('');
    try {
      const ok = await onTransfer({ fromFund, toFund, amountMinor: minor, date, memo: memo.trim() });
      if (ok) onClose(); else { setBusy(false); setErr('That didn’t move — your church’s relay refused or did not answer. Nothing was moved.'); }
    } catch (e) { setBusy(false); setErr((e && e.message) || 'Could not move that.'); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 66, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Move between funds" tabIndex={-1} style={{ ...bkCard, width: 420, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>Move between funds</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>Moves money from one fund to another. It is neither income nor spending — your totals don’t change.</div>
        {fundList.length < 2
          ? <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '4px 0 0' }}>You need at least two funds to move money between them — add a fund first.</p>
          : (<>
              <label style={bkLbl}>From fund</label>
              <select value={fromFund} onChange={e => setFromFund(e.target.value)} style={{ ...bkFld, marginBottom: 12 }}>{fundList.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
              <label style={bkLbl}>To fund</label>
              <select value={toFund} onChange={e => setToFund(e.target.value)} style={{ ...bkFld, marginBottom: 12 }}>{fundList.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}><label style={bkLbl}>Amount ({CCY_SYM[book.baseCurrency] || book.baseCurrency})</label><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" style={bkFld} /></div>
                <div style={{ flex: 1 }}><label style={bkLbl}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={bkFld} /></div>
              </div>
              <label style={bkLbl}>Note (optional)</label>
              <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="e.g. Toward the building fund" style={{ ...bkFld, marginBottom: 8 }} />
            </>)}
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} disabled={busy || fundList.length < 2} style={{ flex: 2, height: 44, border: 'none', background: fundList.length < 2 ? 'var(--line)' : 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: fundList.length < 2 ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Move money</button>
        </div>
      </div>
    </div>
  );
}

// ---- view a receipt image attached to a journal entry ----
// `data` is the decrypted image data: URI, or the sentinel 'pending' when the blob has not arrived from the
// relay yet (the entry references it but the subscription has not delivered the finance/attachment: doc).
function BooksReceiptView({ data, onClose }) {
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 68, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Receipt" tabIndex={-1} style={{ ...bkCard, maxWidth: '96%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        {data === 'pending'
          ? <div style={{ padding: 20, color: 'var(--ink-3)', fontSize: 13.5 }}>The receipt is still arriving from your church’s relay. Give it a moment and try again.</div>
          : <img src={data} alt="Receipt" style={{ display: 'block', maxWidth: '100%', maxHeight: '82vh', borderRadius: 8 }} />}
        <div style={{ textAlign: 'right', marginTop: 10 }}><button onClick={onClose} style={{ height: 40, padding: '0 16px', border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Close</button></div>
      </div>
    </div>
  );
}

// ---- the "support TrinityOne" donation nudge (shown on open; no paywall) ----
function BooksDonate({ onGave, onClose }) {
  const [copied, setCopied] = React.useState(false);
  const copyLn = () => { try { navigator.clipboard.writeText(DONATE.ln).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch (e) {} };
  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Keep TrinityOne going" tabIndex={-1} style={{ ...bkCard, width: 400, maxWidth: '100%', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}><Icon name="gift" size={20} color="var(--clay)" /><h3 style={{ margin: 0, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>Keep TrinityOne going</h3></div>
        <p style={{ color: 'var(--ink)', fontSize: 14, lineHeight: 1.5, margin: '0 0 14px' }}>TrinityOne is free and open — no fees, no lock-in, and your books are always yours. If your church is able, a gift helps cover the shared relays and keep the tools growing. Thank you. 🙏</p>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>{DONATE.suggest.map(a => <span key={a} style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '5px 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-3)' }}>{a}</span>)}<span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>or any amount</span></div>
        <a href={'lightning:' + DONATE.ln} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, borderRadius: 12, background: 'var(--clay)', color: 'var(--on-clay)', textDecoration: 'none', fontFamily: 'var(--font-ui)', fontWeight: 800, marginBottom: 8 }}>⚡ Give with Lightning</a>
        <button onClick={copyLn} style={{ width: '100%', height: 38, border: '1px solid var(--line)', background: 'transparent', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--ink-3)', fontSize: 13, marginBottom: 8 }}>{copied ? 'Copied ✓' : DONATE.ln}</button>
        {DONATE.alt ? <a href={DONATE.alt} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13, marginBottom: 14 }}>Give another way →</a> : null}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Maybe later</button>
          <button onClick={onGave} style={{ flex: 1, height: 44, border: 'none', background: 'var(--sage, #5c8a6a)', color: '#fff', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>I've given</button>
        </div>
      </div>
    </div>
  );
}

// ---- import a bank statement (CSV → categorise → post) ----
// Upload a CSV the bank exported, confirm which columns are which, review each line (pre-categorised, with
// already-imported lines flagged via the importKey de-dup fingerprint), then post the selected ones as
// balanced double-entry journal entries. All parsing is client-side (window.FinanceLedger import engine).
function FinanceImport({ book, F, onPost, onClose }) {
  const incomeAccts = [...book.accounts.values()].filter(a => a.type === 'income' && !a.archived);
  const expenseAccts = [...book.accounts.values()].filter(a => a.type === 'expense' && !a.archived);
  const funds = [...book.funds.values()];
  const dec = book.decimals || 2;
  const defAccount = (dir) => {
    const list = dir === 'in' ? incomeAccts : expenseAccts;
    const pref = dir === 'in' ? 'giving' : 'other-expense';
    return (list.find(a => a.id === pref) || list[0] || {}).id || '';
  };

  const [step, setStep] = React.useState('upload');   // 'upload' → 'review'
  const [fileName, setFileName] = React.useState('');
  const [parsed, setParsed] = React.useState(null);   // { header, rows }
  const [mapping, setMapping] = React.useState({ mode: 'single', date: 0, description: 1, amount: 2, moneyIn: -1, moneyOut: -1 });
  const [monthFirst, setMonthFirst] = React.useState(false);
  const [lines, setLines] = React.useState([]);       // statementLines output
  const [rowState, setRowState] = React.useState([]); // per line: { account, fund, selected, dup }
  const [err, setErr] = React.useState('');

  const onFile = (ev) => {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    setFileName(file.name); setErr('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = F.parseCsv(String(reader.result || ''));
        if (!p.rows.length) { setParsed(null); setErr('That file has a header but no transaction rows.'); return; }
        const g = F.guessColumns(p.header);
        const split = (g.moneyIn >= 0 || g.moneyOut >= 0);
        setParsed(p);
        setMapping({ mode: split ? 'split' : 'single', date: g.date, description: g.description,
          amount: g.amount >= 0 ? g.amount : 0, moneyIn: g.moneyIn, moneyOut: g.moneyOut });
      } catch (e) { setParsed(null); setErr('Could not read that CSV.'); }
    };
    reader.onerror = () => setErr('Could not read that file.');
    reader.readAsText(file);
  };

  const builtMapping = () => mapping.mode === 'single'
    ? { date: mapping.date, description: mapping.description, amount: mapping.amount, moneyIn: -1, moneyOut: -1 }
    : { date: mapping.date, description: mapping.description, amount: -1, moneyIn: mapping.moneyIn, moneyOut: mapping.moneyOut };

  const toReview = () => {
    if (!parsed) return;
    const ls = F.statementLines({ rows: parsed.rows, mapping: builtMapping(), decimals: dec, monthFirst });
    if (!ls.length) { setErr('No transactions found with those columns — check the amount column(s).'); return; }
    const held = new Map();
    for (const e of book.journal) if (e.importKey) held.set(e.importKey, (held.get(e.importKey) || 0) + 1);
    const rs = ls.map(l => {
      const sug = F.suggestCategory(l, []);
      const account = (sug && book.accounts.get(sug.account)) ? sug.account : defAccount(l.dir);
      const fund = (sug && sug.fund && book.funds.has(sug.fund)) ? sug.fund : 'general';
      const n = l.key ? (held.get(l.key) || 0) : 0;
      const dup = n > 0;
      if (dup) held.set(l.key, n - 1);
      return { account, fund, selected: !dup, dup };
    });
    setLines(ls); setRowState(rs); setErr(''); setStep('review');
  };

  const setRow = (i, patch) => setRowState(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const selectable = rowState.filter(r => !r.dup);
  const nSel = rowState.filter(r => r.selected && !r.dup).length;
  const nDup = rowState.filter(r => r.dup).length;
  const allSel = selectable.length > 0 && selectable.every(r => r.selected);
  const toggleAll = () => setRowState(rs => rs.map(r => r.dup ? r : { ...r, selected: !allSel }));

  // KEEP THE MODAL OPEN IF ANY LINE DID NOT POST, and name the ones that did not. Audit 2026-09-02 #17.
  // This closed unconditionally, so a treasurer who imported a statement that reached no relay was returned
  // to a books page they believed was reconciled. Closing is the confirmation; it has to be earned.
  const [posting, setPosting] = React.useState(false);
  const doPost = async () => {
    const picks = [];
    lines.forEach((l, i) => { const r = rowState[i]; if (r.selected && !r.dup) picks.push({ line: l, account: r.account, fund: r.fund }); });
    if (!picks.length) { setErr('Select at least one transaction to import.'); return; }
    setErr(''); setPosting(true);
    let res = null;
    // WHAT THIS SCREEN ALREADY SET AGAINST THE BOOK. A line flagged `dup` was matched to an entry the book holds
    // (toReview), and is not in `picks`. importStatement must not count that same entry a second time against
    // a pick that shares its key — that dropped a real second payment with no message (sim round 2, finding 16:
    // a £45 cleaner imported before, two on the next statement, one posted, books £45 short of the bank).
    const accounted = new Map();
    lines.forEach((l, i) => { const r = rowState[i]; if (r && r.dup && l && l.key) accounted.set(l.key, (accounted.get(l.key) || 0) + 1); });
    try { res = await onPost(picks, accounted); } catch (e) { res = null; }
    setPosting(false);
    const failed = (res && res.failed) || [];
    if (res && !failed.length) { onClose(); return; }
    // MARK WHAT LANDED, so "Try again" retries the rest and not the lot. The `dup` flags were worked out once,
    // when this modal opened, so without this every line the relay DID take was still ticked on the retry.
    // The engine refuses a repeat regardless — this is what stops the screen asking for one.
    const stillFailing = new Set(failed.map(l => l.key));
    setRowState(rs => rs.map((r, i) => {
      const l = lines[i];
      if (!r.selected || r.dup || !l || stillFailing.has(l.key)) return r;
      return { ...r, dup: true, selected: false };
    }));
    setErr(!res
      ? 'Nothing was imported — the import failed before it started. Your books are unchanged.'
      : failed.length + ' of ' + picks.length + ' line' + (picks.length === 1 ? '' : 's') + ' did not reach the relay, and ' + (failed.length === 1 ? 'it is' : 'they are') + ' NOT in your books: '
        + failed.slice(0, 4).map(l => (l.date || '') + ' ' + (l.description || '').slice(0, 28)).join('; ')
        + (failed.length > 4 ? ' …and ' + (failed.length - 4) + ' more' : '') + '. Try again.');
  };

  // NAMED. The captions beside these are plain <label>s with no htmlFor, so they associate with nothing and
  // each select announced as an unnamed combo box — on the screen that decides which column of a bank
  // statement is money. Measured 2026-09-04: labels:0, aria-label:null, aria-labelledby:null, id:"".
  // All five call sites pass a name (rule 2: they are the only ones, all in this file).
  const colSelect = (val, onChange, allowNone, label) => (
    <select value={val} onChange={e => onChange(parseInt(e.target.value, 10))} aria-label={label} style={bkFld}>
      {allowNone && <option value={-1}>— none —</option>}
      {parsed.header.map((h, i) => <option key={i} value={i}>{String(h).trim() || ('Column ' + (i + 1))}</option>)}
    </select>
  );
  const seg = (v, label) => (
    <button onClick={() => setMapping(m => ({ ...m, mode: v }))} title={v === 'single' ? 'The statement has one amount column, with money out shown as negative' : 'The statement has separate columns for money in and money out'} style={{ flex: 1, height: 38, border: 'none', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 13,
      background: mapping.mode === v ? 'var(--clay)' : 'transparent', color: mapping.mode === v ? '#fff' : 'var(--ink-3)' }}>{label}</button>
  );

  const dlgRef = useStewDialog(onClose);   // a11y: Escape + focus (dialog semantics on the panel below)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 62, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Import a bank statement" tabIndex={-1} style={{ ...bkCard, width: step === 'review' ? 640 : 460, maxWidth: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>Import a bank statement</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>{step === 'upload' ? 'Upload a CSV your bank exported, then confirm the columns.' : 'Check each line, pick a category, then post.'}</div>

        {step === 'upload' && (
          <div style={{ overflow: 'auto' }}>
            <label style={bkLbl}>Statement file (CSV)</label>
            <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ ...bkFld, height: 'auto', padding: 9, marginBottom: 14, lineHeight: 1.4 }} />
            {parsed && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div><label style={bkLbl}>Date column</label>{colSelect(mapping.date, v => setMapping(m => ({ ...m, date: v })), undefined, 'Which column holds the date')}</div>
                <div><label style={bkLbl}>Description column</label>{colSelect(mapping.description, v => setMapping(m => ({ ...m, description: v })), undefined, 'Which column holds the description')}</div>
                <div style={{ gridColumn: '1 / span 2' }}>
                  <label style={bkLbl}>Amount columns</label>
                  <div style={{ display: 'flex', gap: 6, background: 'var(--surface-2, #f2efe9)', borderRadius: 10, padding: 4, marginBottom: 8 }}>{seg('single', 'One signed column')}{seg('split', 'Separate in / out')}</div>
                </div>
                {mapping.mode === 'single'
                  ? <div style={{ gridColumn: '1 / span 2' }}><label style={bkLbl}>Amount column (+ in / − out)</label>{colSelect(mapping.amount, v => setMapping(m => ({ ...m, amount: v })), undefined, 'Which column holds the amount')}</div>
                  : (<>
                      <div><label style={bkLbl}>Money in column</label>{colSelect(mapping.moneyIn, v => setMapping(m => ({ ...m, moneyIn: v })), true, 'Which column holds money in')}</div>
                      <div><label style={bkLbl}>Money out column</label>{colSelect(mapping.moneyOut, v => setMapping(m => ({ ...m, moneyOut: v })), true, 'Which column holds money out')}</div>
                    </>)}
                <label style={{ gridColumn: '1 / span 2', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ink)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={monthFirst} onChange={e => setMonthFirst(e.target.checked)} /> Dates are month-first (US: MM/DD/YYYY)
                </label>
              </div>
            )}
            {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
              <button onClick={toReview} disabled={!parsed} style={{ flex: 2, height: 44, border: 'none', background: parsed ? 'var(--clay)' : 'var(--line)', color: 'var(--on-clay)', borderRadius: 11, cursor: parsed ? 'pointer' : 'default', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Review transactions →</button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, fontSize: 12.5, color: 'var(--ink-3)' }}>
              <span>{nSel} selected · {lines.length} found{nDup ? ' · ' + nDup + ' already imported' : ''}</span>
              <button onClick={toggleAll} title="Tick or untick every row in the list" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>{allSel ? 'Deselect all' : 'Select all'}</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1, border: '1px solid var(--line)', borderRadius: 12 }}>
              {lines.map((l, i) => { const r = rowState[i]; const accts = l.dir === 'in' ? incomeAccts : expenseAccts; return (
                <div key={l.key + ':' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderTop: i ? '1px solid var(--line)' : 'none', opacity: r.dup ? .55 : 1 }}>
                  <input type="checkbox" checked={r.selected && !r.dup} disabled={r.dup} onChange={e => setRow(i, { selected: e.target.checked })} />
                  <div style={{ width: 82, flexShrink: 0, fontSize: 12, color: 'var(--ink-3)' }}>{l.date || <span style={{ color: 'var(--clay-deep, #b4462f)' }}>no date</span>}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.description || '(no description)'}{r.dup ? <span style={{ color: 'var(--ink-3)', fontWeight: 400, fontSize: 11.5 }}> · already imported</span> : ''}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <select value={r.account} disabled={r.dup} onChange={e => setRow(i, { account: e.target.value })} style={{ ...bkFld, height: 30, fontSize: 12.5, padding: '0 8px', flex: 1 }}>{accts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                      <select value={r.fund} disabled={r.dup} onChange={e => setRow(i, { fund: e.target.value })} style={{ ...bkFld, height: 30, fontSize: 12.5, padding: '0 8px', width: 130 }}>{funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                    </div>
                  </div>
                  <div style={{ width: 84, textAlign: 'right', flexShrink: 0, fontWeight: 800, fontSize: 13.5, color: l.dir === 'in' ? 'var(--sage, #4f7a5e)' : 'var(--clay-deep, #b4462f)' }}>{l.dir === 'in' ? '+' : '−'}{booksFmt(l.amountMinor, book)}</div>
                </div>
              ); })}
            </div>
            {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '8px 0 0' }}>{err}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={() => { setStep('upload'); setErr(''); }} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>← Back</button>
              <button onClick={doPost} disabled={posting || !nSel} style={{ flex: 2, height: 44, border: 'none', background: nSel ? 'var(--clay)' : 'var(--line)', color: 'var(--on-clay)', borderRadius: 11, cursor: nSel ? 'pointer' : 'default', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Post {nSel} transaction{nSel === 1 ? '' : 's'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- a recurring payment (standing order / direct debit) — a REPLACEABLE finance/template doc ----
function BooksTemplateEdit({ book, initial, onSave, onClose }) {
  const ed = initial && initial.id ? initial : null;
  const [name, setName] = React.useState((ed && ed.name) || '');
  const [dir, setDir] = React.useState((ed && ed.dir) || 'out');
  const cats = (d) => [...book.accounts.values()].filter(a => a.type === (d === 'in' ? 'income' : 'expense') && !a.archived);
  const [account, setAccount] = React.useState((ed && ed.account) || (cats((ed && ed.dir) || 'out')[0] || {}).id || '');
  const [fund, setFund] = React.useState((ed && ed.fund) || 'general');
  const [amount, setAmount] = React.useState(ed && ed.amount ? String(ed.amount / Math.pow(10, book.decimals || 2)) : '');
  const [dayOfMonth, setDayOfMonth] = React.useState(String((ed && ed.dayOfMonth) || 1));
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const funds = [...book.funds.values()];
  React.useEffect(() => { const c = cats(dir); if (!c.some(a => a.id === account)) setAccount(c[0] ? c[0].id : ''); }, [dir]);
  const submit = async () => {
    const minor = booksParse(amount, book);
    if (!minor) return setErr('Enter an amount greater than zero.');
    if (!account) return setErr('Pick a category.');
    const day = Math.max(1, Math.min(31, parseInt(dayOfMonth, 10) || 1));
    setBusy(true);
    const ok = await onSave({ id: ed ? ed.id : undefined, name: name.trim(), account, fund, dir, amount: minor, dayOfMonth: day });
    setBusy(false);
    if (ok) onClose(); else setErr('That did not save — your church’s relay refused or did not answer. Nothing was changed.');
  };
  const dlgRef = useStewDialog(onClose);
  const seg = (v, label) => (
    <button onClick={() => setDir(v)} aria-pressed={dir === v} aria-label={label + (dir === v ? ' (selected)' : '')} style={{ flex: 1, height: 42, border: dir === v ? '2px solid transparent' : '2px dashed var(--line)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 14, background: dir === v ? (v === 'in' ? 'var(--sage, #6b9b7a)' : 'var(--clay)') : 'transparent', color: dir === v ? '#fff' : 'var(--ink-3)' }}>{(v === 'in' ? '+ ' : '− ') + label}</button>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 63, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Recurring payment" tabIndex={-1} style={{ ...bkCard, width: 420, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>{ed ? 'Edit recurring payment' : 'New recurring payment'}</h3>
        <label style={bkLbl}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rent, Insurance, Standing order" style={{ ...bkFld, marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 6, background: 'var(--surface-2, #f2efe9)', borderRadius: 12, padding: 4, marginBottom: 12 }}>{seg('out', 'Money out')}{seg('in', 'Money in')}</div>
        <label style={bkLbl}>Category</label>
        <select value={account} onChange={e => setAccount(e.target.value)} style={{ ...bkFld, marginBottom: 12 }}>{cats(dir).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <label style={bkLbl}>Fund</label>
        <select value={fund} onChange={e => setFund(e.target.value)} style={{ ...bkFld, marginBottom: 12 }}>{funds.map(f => <option key={f.id} value={f.id}>{f.name}{f.kind === 'restricted' ? ' (restricted)' : ''}</option>)}</select>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={bkLbl}>Amount ({CCY_SYM[book.baseCurrency] || book.baseCurrency})</label><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" style={bkFld} /></div>
          <div style={{ flex: 1 }}><label style={bkLbl}>Day of month</label><input value={dayOfMonth} onChange={e => setDayOfMonth(e.target.value)} inputMode="numeric" placeholder="1" style={bkFld} /></div>
        </div>
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>{ed ? 'Save changes' : 'Add recurring payment'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- reconcile an imported bank statement against the ledger, and check the closing balance ----
// Imported bank lines vs the ledger's BANK-SIDE postings. Auto-match (F.match) + manual tick/flag; the result
// is kept as a REPLACEABLE finance/reconcile side doc (match state + statement), never money. The balance
// check (F.statementBalanceCheck) computes its OWN date-bounded single-account balance — see finance-reconcile.
function FinanceReconcile({ book, F, today, saved, onSaveReconcile, onClose }) {
  const dec = book.decimals || 2;
  const hasSaved = !!(saved && saved.lines && saved.lines.length);
  const [step, setStep] = React.useState(hasSaved ? 'review' : 'upload');
  const [fileName, setFileName] = React.useState((saved && saved.label) || '');
  const [lines, setLines] = React.useState(hasSaved ? saved.lines : []);
  const [monthFirst, setMonthFirst] = React.useState(false);
  const [reconciled, setReconciled] = React.useState(() => new Set((saved && saved.reconciled) || []));
  const [closing, setClosing] = React.useState(saved && saved.closing != null ? String(saved.closing / Math.pow(10, dec)) : '');
  const [asOf, setAsOf] = React.useState((saved && saved.asOf) || today || '');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const ingest = (ls) => {
    setLines(ls);
    const r = F.match(ls, book.journal, { windowDays: 3 });
    setReconciled(new Set(r.matched.map(m => m.entry.seq)));   // auto-matched entries start ticked (cleared)
    const dates = ls.map(l => l.date).filter(Boolean).sort();
    if (dates.length) setAsOf(dates[dates.length - 1]);
    setStep('review');
  };
  const onFile = (ev) => {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    setFileName(file.name); setErr('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = F.parseCsv(String(reader.result || ''));
        if (!p.rows.length) { setErr('That file has a header but no transaction rows.'); return; }
        const g = F.guessColumns(p.header);
        const ls = F.statementLines({ rows: p.rows, mapping: g, decimals: dec, monthFirst });
        if (!ls.length) { setErr('No transactions found — check the statement columns.'); return; }
        ingest(ls);
      } catch (e) { setErr('Could not read that CSV.'); }
    };
    reader.onerror = () => setErr('Could not read that file.');
    reader.readAsText(file);
  };

  const res = F.match(lines, book.journal, { windowDays: 3 });
  const closingMinor = (() => { const s = String(closing).replace(/[^0-9.\-]/g, ''); if (!/[0-9]/.test(s)) return null; const n = parseFloat(s); return isFinite(n) ? Math.round(n * Math.pow(10, dec)) : null; })();
  const bchk = closingMinor == null ? null : F.statementBalanceCheck(book, asOf, closingMinor);
  const toggle = (seq) => setReconciled(s => { const n = new Set(s); if (n.has(seq)) n.delete(seq); else n.add(seq); return n; });
  const save = async () => {
    setBusy(true);
    const ok = await onSaveReconcile({ id: saved && saved.id, label: fileName, lines, reconciled: [...reconciled], closing: closingMinor, asOf });
    setBusy(false);
    if (ok) onClose(); else setErr('That did not save — your church’s relay refused or did not answer. Nothing was changed.');
  };
  const dlgRef = useStewDialog(onClose);
  const money = (dir, minor) => (dir === 'in' ? '+' : '−') + booksFmt(minor, book);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 62, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Reconcile a bank statement" tabIndex={-1} style={{ ...bkCard, width: 640, maxWidth: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>Reconcile a bank statement</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>{step === 'upload' ? 'Upload the bank statement; we line it up against your ledger.' : 'Tick what matches, and check the closing balance agrees.'}</div>

        {step === 'upload' && (
          <div style={{ overflow: 'auto' }}>
            <label style={bkLbl}>Statement file (CSV)</label>
            <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ ...bkFld, height: 'auto', padding: 9, marginBottom: 12, lineHeight: 1.4 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ink)', cursor: 'pointer' }}>
              <input type="checkbox" checked={monthFirst} onChange={e => setMonthFirst(e.target.checked)} /> Dates are month-first (US: MM/DD/YYYY)
            </label>
            {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '8px 0 0' }}>{err}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div style={{ overflow: 'auto', flex: 1 }}>
            {/* ── Statement balance check ── */}
            <div style={{ ...bkCard, marginBottom: 14, background: 'var(--surface-2, #f7f5f0)' }}>
              <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 14 }}>Closing balance check</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 130 }}><label style={bkLbl}>Statement closing balance ({CCY_SYM[book.baseCurrency] || book.baseCurrency})</label><input value={closing} onChange={e => setClosing(e.target.value)} inputMode="decimal" placeholder="0.00" style={bkFld} /></div>
                <div style={{ flex: 1, minWidth: 130 }}><label style={bkLbl}>As of (statement date)</label><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={bkFld} /></div>
              </div>
              {bchk && <div role="status" style={{ marginTop: 10, fontSize: 13.5, fontWeight: 700, color: bchk.agrees ? 'var(--sage, #4f7a5e)' : 'var(--clay-deep, #b4462f)' }}>
                {bchk.agrees
                  ? 'Agrees — your ledger bank balance of ' + booksFmt(bchk.balance, book) + ' matches the statement.'
                  : 'Does not agree — your ledger shows ' + booksFmt(bchk.balance, book) + ', off by ' + booksFmt(Math.abs(bchk.delta), book) + ' from the statement.'}
              </div>}
            </div>

            {/* ── Matched ── */}
            <div style={{ fontWeight: 800, fontSize: 14, margin: '4px 0 6px' }}>Matched ({res.matched.length})</div>
            {res.matched.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '2px 0 8px' }}>Nothing matched automatically yet.</div>}
            {res.matched.map((m, i) => (
              <div key={'m' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)' }}>
                <input type="checkbox" checked={reconciled.has(m.entry.seq)} onChange={() => toggle(m.entry.seq)} title="Tick when this line is reconciled; untick to flag it" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.line.description || '(no description)'}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{m.line.date}{m.entry.memo ? ' · ledger: ' + m.entry.memo : ''}</div>
                </div>
                <div style={{ width: 90, textAlign: 'right', fontWeight: 800, fontSize: 13.5, color: m.line.dir === 'in' ? 'var(--sage, #4f7a5e)' : 'var(--clay-deep, #b4462f)' }}>{money(m.line.dir, m.line.amountMinor)}</div>
              </div>
            ))}

            {/* ── Unmatched ── */}
            <div style={{ fontWeight: 800, fontSize: 14, margin: '16px 0 6px' }}>Unmatched ({res.unmatchedLines.length + res.unmatchedEntries.length})</div>
            {res.unmatchedLines.length === 0 && res.unmatchedEntries.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '2px 0' }}>Everything on the statement is accounted for.</div>}
            {res.unmatchedLines.map((l, i) => (
              <div key={'ul' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ fontSize: 11, color: 'var(--clay-deep, #b4462f)', width: 86, flexShrink: 0 }}>on statement</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.description || '(no description)'}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{l.date}{' · not in your books'}</div>
                </div>
                <div style={{ width: 90, textAlign: 'right', fontWeight: 800, fontSize: 13.5, color: l.dir === 'in' ? 'var(--sage, #4f7a5e)' : 'var(--clay-deep, #b4462f)' }}>{money(l.dir, l.amountMinor)}</div>
              </div>
            ))}
            {res.unmatchedEntries.map((e, i) => { const v = booksEntryView(book, e); return (
              <div key={'ue' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', width: 86, flexShrink: 0 }}>in your books</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.category}{v.memo ? ' · ' + v.memo : ''}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{e.date}{' · not on the statement'}</div>
                </div>
                <div style={{ width: 90, textAlign: 'right', fontWeight: 800, fontSize: 13.5, color: 'var(--ink-3)' }}>{booksFmt(v.amount, book)}</div>
              </div>
            ); })}

            {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '10px 0 0' }}>{err}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Close</button>
              <button onClick={save} disabled={busy} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Save reconciliation</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- share a period statement (quarter / year / custom) ----
// Builds an AGGREGATE statement (totals by category + fund — no member names) the treasurer reviews, then
// shares: download a printable doc, copy a plain-text summary (paste into email/WhatsApp), or — deliberately —
// post it to members. The heavy lifting is the pure window.FinanceLedger.buildStatement/statementText/Html.
function fsDownloadDoc(name, text, mime) {   // see booksDownload: same path, same contract
  return saveConsoleFile(name, text, { mime, title: 'Financial statement', blurb: 'Open it to print or save as PDF.' });
}
function fsSlug(s) { return String(s || 'statement').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'statement'; }
// parse a #rgb / #rrggbb brand accent to [r,g,b] for jsPDF; fall back to `fb` when unset/unparseable
function fsHexRgb(hex, fb) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim()) || /^#?([0-9a-fA-F]{3})$/.exec(String(hex || '').trim());
  if (!m) return fb;
  let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Lay the statement out as a real PDF (vendor jsPDF) so the download is shareable and prints cleanly. Mirrors
// the invite-PDF pattern in stew-dashboard.jsx. Returns null if jsPDF isn't loaded (caller falls back to HTML).
function fsBuildStatementPdf(model, F) {
  const J = window.jspdf && window.jspdf.jsPDF; if (!J) return null;
  const doc = new J({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 56;
  const money = m => F.fmtMoney(m, model.currency, model.decimals);
  let y = 64;
  const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const [ar, ag, ab] = fsHexRgb(model.accent, [43, 39, 35]);   // church brand accent (or ink) for the title + rule
  if (model.logo) { try { const fmt = /^data:image\/jpe?g/i.test(model.logo) ? 'JPEG' : 'PNG'; doc.addImage(model.logo, fmt, M, y - 4, 42, 42); y += 50; } catch (e) {} }   // church dp/logo letterhead
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(ar, ag, ab); doc.text(model.title, M, y); y += 22;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(138, 128, 120); doc.text(model.periodLabel, M, y); y += 12;
  doc.setDrawColor(ar, ag, ab); doc.setLineWidth(1.4); doc.line(M, y, W - M, y); y += 24;
  const heading = t => { need(34); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(138, 128, 120); doc.text(String(t).toUpperCase(), M, y); y += 7; doc.setDrawColor(231, 224, 213); doc.setLineWidth(0.7); doc.line(M, y, W - M, y); y += 15; };
  const row = (label, val, bold, rule) => { need(22); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(11.5); doc.setTextColor(43, 39, 35); doc.text(String(label), M, y); doc.text(money(val), W - M, y, { align: 'right' }); y += 8; if (rule) { doc.setDrawColor(231, 224, 213); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); } y += 9; };
  if (model.summary) { heading('Summary'); row('Total income', model.summary.income, false, true); row('Total spending', model.summary.expenditure, false, true); row(model.summary.surplus < 0 ? 'Deficit' : 'Surplus', model.summary.surplus, true, false); y += 8; }
  if (model.income && model.income.length) { heading('Income by category'); model.income.forEach(r => row(r.name, r.amount, false, true)); y += 8; }
  if (model.spending && model.spending.length) { heading('Spending by category'); model.spending.forEach(r => row(r.name, r.amount, false, true)); y += 8; }
  if (model.givingFund && model.givingFund.length) { heading('Giving by fund'); model.givingFund.forEach(r => row(r.name + (r.kind !== 'general' ? ' (' + r.kind + ')' : ''), r.amount, false, true)); y += 8; }
  if (model.funds && model.funds.length) { heading('Fund balances (closing)'); model.funds.forEach(r => row(r.name + (r.kind !== 'general' ? ' (' + r.kind + ')' : ''), r.balance, false, true)); y += 8; }
  // Fund movements — a 4-money-column table (opening · in · out · closing) for the trustees' report.
  if (model.fundMovements && model.fundMovements.length) { heading('Fund movements');
    const cx = [W - M, W - M - 96, W - M - 192, W - M - 288];   // right-aligned x for closing, out, in, opening
    need(16); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(138, 128, 120);
    doc.text('Opening', cx[3], y, { align: 'right' }); doc.text('In', cx[2], y, { align: 'right' }); doc.text('Out', cx[1], y, { align: 'right' }); doc.text('Closing', cx[0], y, { align: 'right' }); y += 13;
    model.fundMovements.forEach(r => { need(20); doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(43, 39, 35);
      doc.text(String(r.name + (r.kind !== 'general' ? ' (' + r.kind + ')' : '')).slice(0, 22), M, y);
      doc.text(money(r.opening), cx[3], y, { align: 'right' }); doc.text(money(r.in), cx[2], y, { align: 'right' }); doc.text(money(r.out), cx[1], y, { align: 'right' }); doc.text(money(r.closing), cx[0], y, { align: 'right' });
      y += 7; doc.setDrawColor(231, 224, 213); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 9; }); y += 8; }
  if (model.receipts) { const rp = model.receipts; heading('Receipts & payments');
    rp.receipts.forEach(r => row(r.name, r.amount, false, true)); row('Total receipts', rp.totalReceipts, true, false); y += 4;
    rp.payments.forEach(r => row(r.name, r.amount, false, true)); row('Total payments', rp.totalPayments, true, false); y += 4;
    row('Net cash movement', rp.net, true, true); row('Cash at start', rp.openingCash, false, true); row('Cash at end', rp.closingCash, false, false); y += 8; }
  if (model.balance) { heading('Balance sheet'); row('Assets', model.balance.assets, false, true); row('Liabilities', model.balance.liabilities, false, true); row('Net funds', model.balance.funds, true, false); y += 8; }
  if (model.note) { heading('Note'); doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(43, 39, 35); const lines = doc.splitTextToSize(model.note, W - 2 * M); need(lines.length * 14 + 6); doc.text(lines, M, y); y += lines.length * 14; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(138, 128, 120);
  doc.text((model.generatedAt ? 'Generated ' + model.generatedAt + ' · ' : '') + 'Prepared with TrinityOne — aggregate figures only.', M, H - 30);
  return doc;
}
// Desktop → direct download; Capacitor/Android → write to Cache then hand to the OS Share sheet (WebView has no
// browser download). Same split as stew-dashboard.jsx savePdf.
async function fsSavePdf(doc, fname) {
  const b64 = doc.output('datauristring').split(',')[1];
  return saveConsoleFile(fname, b64, { mime: 'application/pdf', base64: true, title: 'Financial statement', blurb: 'Open it to print or share.' });
}

function FinanceShareStatement({ book, F, churchName, accent, logo, canPost, onPostToMembers, onClose }) {
  // resolve the church dp/logo to a self-contained data: URI (invImgDataUrl lives in stew-dashboard.jsx; shared
  // steward bundle). Kept in state so the live preview, the HTML download and the PDF all embed the same image.
  const [logoData, setLogoData] = React.useState('');
  React.useEffect(() => { let ok = true; if (typeof churchMarkDataUrl === 'function') { churchMarkDataUrl({ picture: logo, name: churchName, accent }).then(d => { if (ok) setLogoData(d || ''); }); } else setLogoData(''); return () => { ok = false; }; }, [logo, churchName, accent]);
  const now = new Date();
  const curY = now.getFullYear(), curQ = Math.floor(now.getMonth() / 3) + 1;
  const [title, setTitle] = React.useState(churchName || 'Financial statement');
  const [preset, setPreset] = React.useState('this-q');
  const [cFrom, setCFrom] = React.useState(F.quarterRange(curY, curQ).from);
  const [cTo, setCTo] = React.useState(booksTodayISO());
  const [secs, setSecs] = React.useState(() => { const o = {}; (F.STATEMENT_SECTIONS || []).forEach(s => { o[s.key] = s.on; }); return o; });
  const [note, setNote] = React.useState('');
  const [posting, setPosting] = React.useState(false);   // false | 'confirm' | 'done'
  const [flash, setFlash] = React.useState('');

  const period = React.useMemo(() => {
    if (preset === 'this-q') return F.quarterRange(curY, curQ);
    if (preset === 'last-q') return curQ === 1 ? F.quarterRange(curY - 1, 4) : F.quarterRange(curY, curQ - 1);
    if (preset === 'this-y') return { ...F.yearRange(curY), label: 'Year to date ' + curY };
    if (preset === 'last-y') return F.yearRange(curY - 1);
    return { from: cFrom, to: cTo, label: F.rangeLabel(cFrom, cTo) };
  }, [preset, cFrom, cTo, curY, curQ]);

  const enabledKeys = (F.STATEMENT_SECTIONS || []).map(s => s.key).filter(k => secs[k]);
  // Heavy: the journal scan (income/expenditure/funds/balance). Keyed only on inputs that change the numbers —
  // NOT title/note, so typing in those fields doesn't re-scan the ledger on every keystroke.
  const baseModel = React.useMemo(() => F.buildStatement(book, {
    from: period.from, to: period.to, periodLabel: period.label, title: '', note: '',
    sections: enabledKeys, generatedAt: booksTodayISO(), accent, logo: logoData,
  }), [book, period, accent, logoData, JSON.stringify(secs)]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Cheap: fold in the presentation-only title/note (respecting whether the 'note' section is enabled).
  const model = React.useMemo(() => {
    const m = { ...baseModel, title: title || 'Financial statement' };
    if (baseModel.sections.includes('note') && note && note.trim()) m.note = note.trim(); else delete m.note;
    return m;
  }, [baseModel, title, note]);

  const doCopy = async () => { try { await navigator.clipboard.writeText(F.statementText(model)); setFlash('Summary copied — paste it into an email or message.'); setTimeout(() => setFlash(''), 2600); } catch (e) { setFlash('Could not copy on this device.'); } };
  const doDownload = async () => {
    const base = fsSlug(title) + '-' + fsSlug(period.label);
    try { const doc = fsBuildStatementPdf(model, F); if (doc) { const msg = await fsSavePdf(doc, base + '.pdf'); setFlash(msg || 'Statement downloaded — ready to print or share.'); setTimeout(() => setFlash(''), 2600); return; } } catch (e) {}
    // fallback: self-contained HTML. The sentence comes from the save, not from here — "Downloaded" was
    // printed over a WebView that had downloaded nothing.
    try {
      const msg = await fsDownloadDoc(base + '.html', F.statementHtml(model), 'text/html;charset=utf-8');
      setFlash(msg || 'Downloaded — open it to print or save as PDF.'); setTimeout(() => setFlash(''), 2600);
    } catch (e) { setFlash((e && e.message) || 'Could not save the statement on this device.'); }
  };
  const doPost = async () => {
    try { await onPostToMembers(model, F.statementText(model)); setPosting('done'); setFlash('Shared with members.'); }
    catch (e) { setFlash(e && e.message ? e.message : 'Could not post to members.'); setPosting(false); }
  };

  const fmt = m => F.fmtMoney(m, book.baseCurrency, book.decimals);
  const presetBtn = (v, label) => (
    <button key={v} onClick={() => setPreset(v)} title={'Show the report for: ' + label} style={{ padding: '7px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5,
      border: '1px solid ' + (preset === v ? 'var(--clay)' : 'var(--line)'), background: preset === v ? 'var(--clay)' : 'transparent', color: preset === v ? '#fff' : 'var(--ink)' }}>{label}</button>
  );
  const prevRows = (rows, valKey, tag) => rows.map(r => (
    <div key={r.fund || r.account} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
      <span style={{ color: 'var(--ink-2, var(--ink))' }}>{r.name}{tag && r.kind !== 'general' ? ' · ' + r.kind : ''}</span><span style={{ fontWeight: 700 }}>{fmt(r[valKey])}</span>
    </div>
  ));

  const dlgRef = useStewDialog(onClose);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 64, padding: 16 }} onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Share a statement" tabIndex={-1} style={{ ...bkCard, width: 560, maxWidth: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', outline: 'none' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 2px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>Share a statement</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>A summary for a quarter or year — totals only, no names. Review it, then share.</div>

        <div style={{ overflow: 'auto', flex: 1, paddingRight: 2 }}>
          <label style={bkLbl}>Statement title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Grace Community Church" style={{ ...bkFld, marginBottom: 14 }} />

          <label style={bkLbl}>Period</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {presetBtn('this-q', 'This quarter')}{presetBtn('last-q', 'Last quarter')}{presetBtn('this-y', 'This year')}{presetBtn('last-y', 'Last year')}{presetBtn('custom', 'Custom')}
          </div>
          {preset === 'custom'
            ? <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1 }}><label style={bkLbl}>From</label><input type="date" value={cFrom} onChange={e => setCFrom(e.target.value)} style={bkFld} /></div>
                <div style={{ flex: 1 }}><label style={bkLbl}>To</label><input type="date" value={cTo} onChange={e => setCTo(e.target.value)} style={bkFld} /></div>
              </div>
            : <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 14px' }}>{period.from} → {period.to}</div>}

          <label style={bkLbl}>Include</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 4 }}>
            {(F.STATEMENT_SECTIONS || []).map(s => (
              <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--ink)', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!secs[s.key]} onChange={e => setSecs(o => ({ ...o, [s.key]: e.target.checked }))} /> {s.label}
              </label>
            ))}
          </div>
          {secs.note && <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="A short note for members / trustees (optional)…" rows={3} style={{ ...bkFld, height: 'auto', padding: 10, marginTop: 8, resize: 'vertical', lineHeight: 1.4 }} />}

          {/* live preview of exactly what will be shared */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginTop: 14, background: 'var(--surface-2, #f7f3ec)' }}>
            {logoData ? <img src={logoData} alt="" style={{ height: 34, maxWidth: 130, objectFit: 'contain', display: 'block', marginBottom: 8 }} /> : null}
            <div style={{ fontWeight: 800, fontSize: 15, fontFamily: 'var(--font-display, var(--font-ui))', color: accent || undefined, borderTop: '3px solid ' + (accent || 'var(--ink)'), paddingTop: 8 }}>{title || 'Financial statement'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 8 }}>{period.label}</div>
            {model.summary && <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}><span>Total income</span><span style={{ fontWeight: 700, color: 'var(--sage, #4f7a5e)' }}>{fmt(model.summary.income)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}><span>Total spending</span><span style={{ fontWeight: 700, color: 'var(--clay-deep, #b4462f)' }}>{fmt(model.summary.expenditure)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '5px 0 0', marginTop: 4, borderTop: '1px solid var(--line)', fontWeight: 800 }}><span>{model.summary.surplus < 0 ? 'Deficit' : 'Surplus'}</span><span>{fmt(model.summary.surplus)}</span></div>
            </div>}
            {model.income && model.income.length ? <div style={{ marginTop: 10 }}><div style={bkLbl}>Income by category</div>{prevRows(model.income, 'amount')}</div> : null}
            {model.spending && model.spending.length ? <div style={{ marginTop: 10 }}><div style={bkLbl}>Spending by category</div>{prevRows(model.spending, 'amount')}</div> : null}
            {model.funds && model.funds.length ? <div style={{ marginTop: 10 }}><div style={bkLbl}>Fund balances (closing)</div>{prevRows(model.funds, 'balance', true)}</div> : null}
            {model.balance ? <div style={{ marginTop: 10 }}><div style={bkLbl}>Balance sheet</div>
              {prevRows([{ account: 'a', name: 'Assets', amount: model.balance.assets }, { account: 'l', name: 'Liabilities', amount: model.balance.liabilities }, { account: 'n', name: 'Net funds', amount: model.balance.funds }], 'amount')}</div> : null}
            {model.note ? <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'pre-wrap' }}><span style={bkLbl}>Note</span>{model.note}</div> : null}
            {!enabledKeys.length && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Tick at least one section to include.</div>}
          </div>
        </div>

        {flash && <p style={{ color: 'var(--sage, #4f7a5e)', fontSize: 12.5, margin: '10px 0 0', fontWeight: 600 }}>{flash}</p>}

        {posting === 'confirm' ? (
          <div style={{ marginTop: 14, border: '1px solid var(--clay)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Post this statement to every member?</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 12 }}>Members will see it in the church’s announcements. It contains totals only — no names.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPosting(false)} style={{ flex: 1, height: 42, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
              <button onClick={doPost} title="Send this to all members now" style={{ flex: 2, height: 42, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Yes, post to members</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={onClose} style={{ height: 44, padding: '0 16px', border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Close</button>
            <button onClick={doCopy} title="Copy the summary text to paste elsewhere" disabled={!enabledKeys.length} style={{ height: 44, padding: '0 16px', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 11, cursor: enabledKeys.length ? 'pointer' : 'default', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Copy summary</button>
            <button onClick={doDownload} title="Save the summary as a file" disabled={!enabledKeys.length} style={{ height: 44, padding: '0 16px', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 11, cursor: enabledKeys.length ? 'pointer' : 'default', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Download</button>
            {canPost && <button onClick={() => setPosting('confirm')} title="Post this summary to your members" disabled={!enabledKeys.length} style={{ flex: 1, minWidth: 150, height: 44, padding: '0 16px', border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 11, cursor: enabledKeys.length ? 'pointer' : 'default', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Post to members</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- the main screen ----
// THE GATE LIVES IN ITS OWN COMPONENT, and it must stay that way.
//
// DELEGATED BOOKKEEPING. This screen used to refuse to render for a delegated steward, because the three
// things it needs were all broken: encPublish signed with the wrong key and omitted the ['church'] tag
// (fixed 2026-07-06), the books had no shareable key (the finance envelope, 2026-08-19), and a delegate's
// ledger silently arrived empty or was silently dropped (2026-08-20).
//
// What holds a delegate out is the KEY, not this component: without the finance capability the owner never
// wraps them into the envelope, so encSeal returns null and pubEntry refuses the write. A screen that hides
// itself is a preference; a key they do not hold is a protection.
//
// WHY THE SPLIT. The first version of this gate was an early `return` in the middle of DashFinance, after two
// hooks and before nine more. React counts hooks per render: the moment the key arrived and `finKey` flipped,
// the component rendered eleven hooks where it had rendered two, which is React error #310 — and the console
// has exactly one error boundary, around the whole of StewardRoot. So the first time a church actually granted
// Finance to a treasurer, the ENTIRE console dropped to the crash card. Revoking it threw the mirror error.
//
// A conditional return is only safe above every hook in the component, or in a wrapper like this one. Do not
// move the gate back inside DashFinanceBook.
function DashFinance() {
  const F = window.FinanceLedger;
  const S = window.Steward;
  const [finKey, setFinKey] = React.useState(() => !!(S && S.financeKeyRing && S.financeKeyRing().length));
  const _fIdv = window.useStewardIdv ? window.useStewardIdv() : 0;
  const _fConn = window.useStewardConn ? window.useStewardConn() : 0;
  React.useEffect(() => {
    if (!S || !S.subscribeCapKey) return;
    setFinKey(!!(S.capKeyRing && S.capKeyRing('finance').length));   // a church switch clears the ring
    return S.subscribeCapKey('finance', (ring) => setFinKey(!!(ring && ring.length)));
  }, [_fIdv, _fConn]);
  if (!F) return <div style={{ padding: 28, color: 'var(--ink-3)' }}>Loading the ledger engine…</div>;
  // If they genuinely have no key, say which of the two it is rather than showing an empty ledger. An empty
  // ledger is the most misleading thing this screen can display: it reads as "your church has never recorded
  // anything", which is exactly what a treasurer must not be told by mistake.
  if (S && S.actingChurch && !finKey) return <div style={{ padding: 28, maxWidth: 520, color: 'var(--ink-2)', lineHeight: 1.5 }}><div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Waiting for the books to be shared with you</div>The church keeps its accounts under their own key. Whoever holds the church key needs to give you the <b>Finance</b> permission — once they do, the books open here on their own. If they already have, give it a moment to arrive.</div>;
  return <DashFinanceBook />;
}

function DashFinanceBook() {
  const F = window.FinanceLedger;
  const S = window.Steward;
  const _bIdv = window.useStewardIdv ? window.useStewardIdv() : 0;
  const _bConn = window.useStewardConn ? window.useStewardConn() : 0;
  const useRelay = !!(S && S.encSubscribe && S.encPublish);   // real console → relay-backed; else localStorage
  const bookRef = React.useRef(null);
  if (!bookRef.current) bookRef.current = useRelay ? F.createBook({ baseCurrency: 'GBP', decimals: 2 }) : booksLoad();
  const book = bookRef.current;
  // Receipt images, kept OUT of the ledger (they are side blobs): id → data: URI. Filled from every finance/
  // delivery (encSubscribe) and optimistically on upload, read by the feed's receipt viewer.
  const attByIdRef = React.useRef({});
  const [, setTick] = React.useState(0);
  const bump = () => setTick(t => t + 1);
  // A journal entry is the church's money record — it must not be published fire-and-forget. This wasn't
  // awaited and the promise rejection escaped the try, so a write the relay refused (its seq rule rejects
  // whenever this console's view of the journal was incomplete) left the entry on screen and GONE on reload,
  // with nothing written locally either. Await it, and surface a failure instead of silently losing the entry.
  const pubEntry = async (b, e) => {
    if (!useRelay) { booksSave(b); return true; }
    try {
      // attachmentRefs IS LOAD-BEARING HERE. This is the LIVE publish path and it hardcodes its own field list
      // (it does NOT call bookToDocs). Drop attachmentRefs from this object and the receipt link is lost on
      // publish — the entry rebuilds from the relay with no attachments, a control reporting work it did not do.
      const ok = await S.encPublish('finance/journal:' + e.seq, { seq: e.seq, date: e.date, memo: e.memo, postings: e.postings, by: e.by, ts: e.ts, reverses: e.reverses, importKey: e.importKey ?? null, attachmentRefs: e.attachmentRefs ?? [], invoice: e.invoice ?? null, bill: e.bill ?? null });
      // NULL IS NOT SUCCESS. encPublish returns null — never false — when it declines before reaching the
      // relay: no signing key, or no books key to seal with. `ok === false` alone let that through as a
      // success, so a console without the finance ring showed the entry saved, wrote nothing anywhere, and
      // lost it on reload. That is the exact shape of defect this repo keeps finding: a control reporting
      // work it did not do. A delegated treasurer whose envelope has not arrived yet hits it on their first
      // entry, which makes it far more likely now that Finance can be delegated at all.
      if (ok === false || ok == null) throw new Error('the entry was not published');
      return true;
    } catch (x) {
      // NO LOCAL SAVE ON THE RELAY PATH, and no promise of one. booksSave() writes `trinityone.books.v1`,
      // which booksLoad() reads ONLY when !useRelay — never on a console. So the old wording, "it is kept on
      // this device, reopen Finance to retry", described a recovery that could not happen: reopening calls
      // F.createBook() and rebuilds from the relay. The entry was gone, and the message said it was safe.
      //
      // The screen does correct itself — every relay delivery rebuilds the book from the stored documents, so
      // the optimistic row disappears — but not before the treasurer has been told the opposite.
      try { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'journal entry', message: 'That entry was NOT recorded — your church\'s relay refused or did not answer. Nothing has been saved. Check you are online and enter it again.' } })); } catch (e2) {}
      return false;
    }
  };
  // relay-backed persistence: subscribe to the church's encrypted finance docs → rebuild the book; seed the
  // default chart on first use. Journal entries publish through the relay's single-writer seq guard.
  React.useEffect(() => {
    if (!useRelay) return;
    let seeded = false;
    const unsub = S.encSubscribe('finance/', items => {
      const docs = items.map(finItemToDoc).filter(Boolean);
      // Receipt blobs ride the same subscription. Pull their data: URIs into the side map BEFORE rebuildBook,
      // which deliberately ignores t:'attachment' (a blob is not part of the double-entry book).
      for (const d of docs) if (d.t === 'attachment' && d.data) attByIdRef.current[d.id] = d.data;
      // Phase 3 side docs live in their OWN state, never in the book (rebuildBook ignores them).
      setTemplates(docs.filter(d => d.t === 'template'));
      setReconciles(docs.filter(d => d.t === 'reconcile'));
      setDonors(docs.filter(d => d.t === 'donor'));   // Phase 4b — finance/donor:<id> docs, SEPARATE from the book
      setInvoices(docs.filter(d => d.t === 'invoice')); // Phase 5 — finance/invoice:<id> docs, SEPARATE from the book
      setContacts(docs.filter(d => d.t === 'contact')); // Phase 5 — finance/contact:<id> docs, SEPARATE from the book
      setBudgets(docs.filter(d => d.t === 'budget'));  // Phase 7 — finance/budget:<id> docs, SEPARATE from the book (a READ overlay, never a ledger input)
      setBills(docs.filter(d => d.t === 'bill'));       // Phase 6 — finance/bill:<id> docs, SEPARATE from the book (the money rides the journal)
      setBillApprovals(docs.filter(d => d.t === 'billapproval')); // Phase 6 — dual-control approvals, approver bound to the signer by the d-tag
      // "Empty" means no BOOK docs (settings/account/fund/journal). Side docs (attachment/template/reconcile)
      // must NOT count, or a side-doc-only delivery would wrongly enter the seed path over a real book.
      if (!docs.some(d => d.t === 'settings' || d.t === 'account' || d.t === 'fund' || d.t === 'journal')) {
        // AUDIT-2026-07-24: "no docs came back" is NOT proof this church has no book. Finance docs are private,
        // so an unauthenticated or restarting relay returns exactly this empty result — and seeding republishes
        // finance/settings and finance/account:<id>, which are REPLACEABLE, so the church's real currency,
        // fiscal year and chart of accounts are overwritten and hard-deleted. The journal survives under
        // different d-tags and then replays against a chart it no longer matches. Only seed once we've had an
        // authenticated read (same guard as the care key).
        if (seeded) return;
        if (window.Steward && window.Steward.relayAuthed && !window.Steward.relayAuthed()) return;
        seeded = true;
        const b = booksFresh(); bookRef.current = b; bump();
        S.encPublish('finance/settings', { baseCurrency: b.baseCurrency, decimals: b.decimals, fiscalYearStart: b.fiscalYearStart });
        for (const a of b.accounts.values()) S.encPublish('finance/account:' + a.id, { code: a.code, name: a.name, type: a.type, archived: !!a.archived });
        for (const f of b.funds.values()) if (f.id !== 'general') S.encPublish('finance/fund:' + f.id, { name: f.name, kind: f.kind });
        return;
      }
      const r = F.rebuildBook(docs); if (r.book) { bookRef.current = r.book; setBookErrors(r.errors || []); bump(); }
    });
    return unsub;
    // [idv, conn], like every other subscription in this console — this one was the last still mounted with
    // [], so it never followed a church switch and never re-issued its REQ after a relay reconnect.
  }, [_bIdv, _bConn]);
  const [bookErrors, setBookErrors] = React.useState([]);
  const [recording, setRecording] = React.useState(false);   // null|true for a fresh entry, or a {initial} prefill for a correction
  const [importing, setImporting] = React.useState(false);
  const [viewingAtt, setViewingAtt] = React.useState('');    // the data: URI of a receipt being viewed, or ''
  const [reports, setReports] = React.useState(false);
  const [rptPreset, setRptPreset] = React.useState('pl');    // which aggregate report the Reports panel shows
  const [rptPeriod, setRptPeriod] = React.useState('this-y'); // this-q | this-y | last-y
  const [rptFlash, setRptFlash] = React.useState('');         // what an Export reported, or why it did not
  const [donate, setDonate] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [managing, setManaging] = React.useState(false);     // collapsible "Accounts & funds" panel (same pattern as Reports)
  const [accEditing, setAccEditing] = React.useState(null);  // account modal: null closed · {} add · {id,…} edit
  const [fundEditing, setFundEditing] = React.useState(null);// fund modal: null closed · {} add · {id,…} edit
  const [moving, setMoving] = React.useState(false);         // "Move between funds" (fund transfer) modal
  const [reconciling, setReconciling] = React.useState(null);// reconcile modal: null closed · {} new · {id,…} reopen a saved reconciliation
  const [recurringOpen, setRecurringOpen] = React.useState(false); // collapsible "Recurring payments" panel
  const [tplEditing, setTplEditing] = React.useState(null);  // template modal: null closed · {} add · {id,…} edit
  const [templates, setTemplates] = React.useState([]);      // finance/template:<id> docs — SEPARATE from the book
  const [reconciles, setReconciles] = React.useState([]);    // finance/reconcile:<id> docs — SEPARATE from the book
  const [donors, setDonors] = React.useState([]);            // finance/donor:<id> docs (Phase 4b) — SEPARATE from the book
  const [donorsOpen, setDonorsOpen] = React.useState(false); // collapsible "Donors & giving by member" panel
  const [donorEditing, setDonorEditing] = React.useState(null); // donor modal: null closed · {} add · {id,…} edit
  const [invoices, setInvoices] = React.useState([]);        // finance/invoice:<id> docs (Phase 5) — SEPARATE from the book
  const [contacts, setContacts] = React.useState([]);        // finance/contact:<id> docs (Phase 5) — SEPARATE from the book
  const [invoicesOpen, setInvoicesOpen] = React.useState(false); // collapsible "Invoices" panel
  const [invEditing, setInvEditing] = React.useState(null);  // invoice editor: null closed · {} new · {id,…} view
  const [contactEditing, setContactEditing] = React.useState(null); // contact editor: null closed · {} add · {id,…} edit
  const [invFlash, setInvFlash] = React.useState('');        // what an invoice action reported (saved / paid / exported / why not)
  const [budgets, setBudgets] = React.useState([]);          // finance/budget:<id> docs (Phase 7) — SEPARATE from the book (a READ overlay)
  const [bills, setBills] = React.useState([]);              // finance/bill:<id> docs (Phase 6) — SEPARATE from the book (the money rides the journal)
  const [billApprovals, setBillApprovals] = React.useState([]); // finance/billapproval:<billId>:<approverhex> docs (Phase 6, dual-control) — approver bound to the signer
  const [billsOpen, setBillsOpen] = React.useState(false);   // collapsible "Bills" panel
  const [billEditing, setBillEditing] = React.useState(null);// bill editor: null closed · {} new
  const [billFlash, setBillFlash] = React.useState('');      // what a bill action reported (recorded / approved / paid / why not)
  const [budgetOpen, setBudgetOpen] = React.useState(false); // collapsible "Budget" panel
  const [budgetEditing, setBudgetEditing] = React.useState(null); // budget modal: null closed · {year, lines} the budget being edited
  const [exported, setExported] = React.useState('');   // what Export CSV reported: "Saved to …", or why it did not
  // church profile + groups (for the statement title + the "post to members" broadcast target). Relay-backed
  // console only; in localStorage mode these are absent and the modal simply omits the "Post to members" button.
  const church = window.useStewardChurch ? window.useStewardChurch() : { name: '' };
  const groups = window.useStewardGroups ? window.useStewardGroups() : [];
  const broadcastGroup = groups.find(g => g.kind === 'broadcast');
  const canPost = !!(useRelay && S && S.publishPost && broadcastGroup);
  const postStatementToMembers = async (model, text) => {
    if (!broadcastGroup) throw new Error('No announcements channel to post to. Create a broadcast group first.');
    const lead = (model.title || 'Financial statement') + ' — ' + (model.periodLabel || '') + '\n\n';
    // THE FOURTH CALLER OF publishPost, and it had the same hole as the two in stew-dashboard.jsx:
    // publishPost RESOLVES `false` when the publish set was empty or every relay refused — it never throws —
    // so awaiting it alone let doPost() in FinanceShareStatement print "Shared with members." over a
    // statement no member received. Nothing typed is lost here (the text is rebuilt from the book), but the
    // claim was still false. Throw, so the existing catch in doPost shows the reason and keeps the dialog open.
    const ok = await S.publishPost(lead + text, broadcastGroup.id);
    if (!ok) throw new Error('That didn’t post — nothing reached your church. Check your connection and try again.');
  };
  React.useEffect(() => {   // gentle donation nudge — once per session, unless hidden for ~3 months after giving
    if (!DONATE_ON || _booksDonateShown || Date.now() < booksDonateHiddenUntil()) return;
    _booksDonateShown = true; setDonate(true);
  }, []);

  // Discard a local entry the relay refused. NOT history editing: an entry nothing accepted is not history,
  // it is a guess that turned out wrong, and leaving it behind invalidates every seq after it. The one case
  // this gets wrong is a relay that STORED the entry and lost the OK on the way back — the entry then
  // reappears on the next delivery, which rebuilds the book from what the relay actually holds. Re-entering
  // it by hand inside that window is the way to double it, so the wording never invites that.
  const _dropIfRefused = (b, entry) => { if (entry && F.dropFrom) { try { F.dropFrom(b, entry.seq); } catch (x) {} } };
  // Publish a receipt image as its own REPLACEABLE finance/attachment:<id> doc, BEFORE the journal entry that
  // references it goes up — so a delivery that rebuilds the book always finds the blob the ref points at. The
  // id is opaque (booksRandId). A relay refusal here aborts the whole record: a journal entry must never cite
  // an attachment the relay rejected. Optimistically cached so the feed can show it before the round-trip.
  const pubAttachment = async (id, dataUri) => {
    attByIdRef.current[id] = dataUri;
    if (!useRelay) { booksSave(bookRef.current); return true; }
    try {
      const ok = await S.encPublish('finance/attachment:' + id, { data: dataUri });
      if (ok === false || ok == null) throw new Error('the receipt was not published');
      return true;
    } catch (x) {
      try { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'receipt', message: 'The receipt was NOT saved — your church\'s relay refused or did not answer. Nothing was recorded; try again.' } })); } catch (e2) {}
      return false;
    }
  };
  // Record a transaction. `legs` is one OR MORE category postings (a split); their amounts sum to `totalMinor`,
  // which is the single balancing bank leg (BooksRecord disables Save unless they match, and F.post's balance
  // check is the backstop). `attachment` (optional) is published first; its id rides on the entry's
  // attachmentRefs, which pubEntry/bookToDocs/finItemToDoc/applyEntry all carry.
  const record = async ({ dir, legs, totalMinor, date, memo, attachment, donor }) => {
    const b = bookRef.current;
    let attachmentRefs = [];
    if (attachment && attachment.data) {
      const ok = await pubAttachment(attachment.id, attachment.data);
      if (!ok) { bump(); return false; }   // the receipt did not land — post nothing that would cite it
      attachmentRefs = [attachment.id];
    }
    // DONOR attribution (Phase 4b) rides ONLY the money-IN (income) legs, and ONLY as the OPAQUE donor id —
    // never the name (the id is network-readable via the journal; the name stays in the finance/donor doc the
    // relay keeps off network peers). Money-out has no donor. '' / falsy = unattributed, so _normalize drops it.
    const donorTag = (dir === 'in' && donor) ? { donor: String(donor) } : {};
    const catLegs = legs.map(l => ({ account: l.account, fund: l.fund, dir: dir === 'in' ? 'cr' : 'dr', amount: l.amountMinor, ...donorTag }));
    const bankLeg = { account: 'bank', dir: dir === 'in' ? 'dr' : 'cr', amount: totalMinor };
    const P = dir === 'in' ? [bankLeg, ...catLegs] : [...catLegs, bankLeg];
    // Awaited: pubEntry's answer is the only thing that distinguishes a recorded entry from a lost one.
    // ROLL BACK A REFUSED ENTRY (dropFrom): one refused entry otherwise advances the local book past a seq the
    // relay never took, and every later entry/import is numbered past a gap the relay refuses (audit 2026-09-04).
    let entry = null;
    try { entry = F.post(b, { date, memo, postings: P, attachmentRefs }); }
    catch (e) { bump(); throw e; }   // e.g. a split that does not balance — surfaced to BooksRecord's catch
    const ok = await pubEntry(b, entry);
    if (!ok) _dropIfRefused(b, entry);
    bump();
    return ok;
  };
  const undo = seq => { const b = bookRef.current; try { const rev = F.reverse(b, seq); return pubEntry(b, rev).then((ok) => { if (!ok) _dropIfRefused(b, rev); bump(); return ok; }); } catch (e) { return Promise.resolve(false); } };
  // "Correct this entry": reverse the original (append-only), then open BooksRecord pre-filled from it so the
  // treasurer re-enters the fixed version through the ordinary record() path. TWO appended entries, in order —
  // the reversal must be published and confirmed BEFORE the replacement is posted (post() advances _seq and the
  // relay demands exactly the next seq), so we await undo() and only pre-fill on success. A refused reversal
  // surfaces its own write-blocked toast (via pubEntry) and we do NOT open the form — nothing to correct.
  // The reversal does NOT copy attachmentRefs (reverse() posts a bare mirror); the replacement carries its own
  // receipt. Transfers and already-reversed/reversal rows never reach here (the row gate below hides Correct).
  const correctEntry = async (e) => {
    const cat = e.postings.find(p => { const a = book.accounts.get(p.account); return a && (a.type === 'income' || a.type === 'expense'); });
    if (!cat) return;   // not an income/expense entry (e.g. a transfer) — no BooksRecord shape to pre-fill
    const a = book.accounts.get(cat.account);
    const dec = book.decimals || 2;
    const prefill = {
      dir: a.type === 'income' ? 'in' : 'out',
      account: cat.account,
      fund: cat.fund || 'general',
      amount: (cat.amount / Math.pow(10, dec)).toFixed(dec),
      date: e.date || booksTodayISO(),
      memo: e.memo || '',
      donor: cat.donor || '',   // keep the gift's donor attribution across a correction (money-in only; '' otherwise)
      correctingSeq: e.seq,
    };
    const ok = await undo(e.seq);
    if (ok) setRecording({ initial: prefill });
  };
  // Post the lines the treasurer selected in the import modal. Each carries its statement lineKey as importKey
  // so a future re-import of the same statement is flagged as already-imported (see FinanceImport de-dup).
  // AN IMPORT THAT POSTED NOTHING MUST NOT CLOSE AS THOUGH IT HAD. Audit 2026-09-02 #17.
  //
  // Every line was posted locally and its publish fired and forgotten, so a bank statement that reached no
  // relay left the modal closing on a books page the treasurer believed was reconciled. `record`/`undo`
  // above already await pubEntry and read it; this is the same treatment for the bulk path.
  // Promise.all, not a serial await: a statement can be 200 lines.
  // "TRY AGAIN" POSTED THE LINES THAT HAD ALREADY LANDED, A SECOND TIME. Audit 2026-09-04, and the cause was
  // two things at once — both of which come from the journal being a single-writer, relay-ORDERED, append-only
  // sequence (gateway.mjs accepts a journal doc only when `seq === FINANCE_SEQ.get(cp) + 1`).
  //
  // 1. Promise.all. Two hundred lines were signed and fired at the relay together, so they arrived in
  //    whatever order the network chose, and every one that arrived out of turn was refused for a gap. The
  //    partial failure this modal reports was largely manufactured here.
  // 2. `post()` advances the local book whether or not the publish lands, and never rolled back. So the
  //    already-landed lines stayed selected in the review list (its `dup` flags were computed once, when the
  //    modal opened) and went out again on the retry, while the refused ones were numbered past a gap the
  //    relay can never accept — and carried importKeys, so the de-dup thought they were already imported.
  //
  // Serial, stop at the first refusal, and roll the book back to the last entry the relay actually took.
  // Slower on a long statement; it is the only order the relay will accept, so the parallel version was not
  // faster, it was wrong. The de-dup guard is re-read from the book on EVERY call rather than trusting the
  // modal's flags, because that is the layer a stale screen cannot get past.
  const importStatement = async (picks, accounted) => {
    const b = bookRef.current;
    // COUNT, DO NOT ASK "IS THIS KEY PRESENT". Audit #5, and it is the SAME £45-becomes-£25 defect one tap
    // further on. `lineKey` is date|amount|description, so two identical payments on one day share a key K.
    // With a set: attempt 1 lands the first and the relay drops before the second; on "Try again" K is now in
    // the book, so BOTH rows are skipped, `failed` is empty, and the modal closes as a clean success with one
    // donation never posted and nothing on screen.
    //
    // The question is not "has this key been imported" but "how many of these does the book already hold
    // against how many the statement offers". Two in the file and one in the book means post ONE more.
    // That is right in all three cases: a fresh import (0 held, 2 offered -> post 2), a re-import of the same
    // file (2 held, 2 offered -> post 0), and a retry after a partial failure (1 held, 2 offered -> post 1).
    const held = new Map();
    for (const k of (b.journal || [])) if (k.importKey) held.set(k.importKey, (held.get(k.importKey) || 0) + 1);
    // ...MINUS THE ONES THE SCREEN ALREADY USED UP. `picks` leaves out the lines the review flagged as already
    // imported, so each of those has consumed one held entry of its key. Counting it again here made the guard
    // see "1 held" for a pick that was the SECOND of two identical lines and skip it: the review ticked it,
    // "Post 1 transaction" closed with no message, and the payment never reached the books. `accounted` is
    // key -> how many lines of that key the screen set against the book (absent: nothing, the old behaviour).
    if (accounted) for (const [k, n] of accounted) held.set(k, Math.max(0, (held.get(k) || 0) - n));
    const failed = [], skipped = [];
    let posted = 0;
    for (let i = 0; i < picks.length; i++) {
      const { line, account, fund } = picks[i];
      const n = line.key ? (held.get(line.key) || 0) : 0;
      if (n > 0) { held.set(line.key, n - 1); skipped.push(line); continue; }
      const amount = line.amountMinor;
      const P = line.dir === 'in'
        ? [{ account: 'bank', dir: 'dr', amount }, { account, fund, dir: 'cr', amount }]
        : [{ account, fund, dir: 'dr', amount }, { account: 'bank', dir: 'cr', amount }];
      let entry = null, ok = false;
      try {
        entry = F.post(b, { date: line.date, memo: line.description, importKey: line.key, postings: P });
        ok = !!(await pubEntry(b, entry));
      } catch (e) { ok = false; }
      if (!ok) {
        // Undo the local guess and stop: every seq after this one is invalid to the relay anyway.
        _dropIfRefused(b, entry);
        for (let j = i; j < picks.length; j++) failed.push(picks[j].line);
        break;
      }
      posted++;
      // Nothing is added to `held` here. A row we have just posted is a row we WANTED to post; the count read
      // from the book above already accounts for everything that landed on an earlier attempt.
    }
    bump();
    return { posted, failed, skipped };
  };
  // ── chart of accounts + funds management ──────────────────────────────────────────────────────────────
  // Accounts and funds are first-class, editable objects. Both publish as REPLACEABLE finance docs (no seq —
  // the same encPublish the seed uses), so an edit is a re-publish of the SAME id. The local book is updated
  // optimistically and then self-corrects on the next encSubscribe delivery (rebuildBook replaces it).
  const saveAccount = async ({ id, code, name, type, archived }) => {
    const b = bookRef.current;
    const existing = b.accounts.get(id);
    // TYPE NEVER CHANGES on an existing account — it would silently re-sign every projection that branches on
    // account.type. The modal disables the selector on a posted account; this keeps the stored type regardless.
    const t = existing ? existing.type : type;
    const doc = { code: code || id, name: name || id, type: t, archived: !!archived };
    if (existing) b.accounts.set(id, { id, ...doc });
    else F.addAccount(b, { id, ...doc });
    if (!useRelay) { booksSave(b); bump(); return true; }
    const ok = await S.encPublish('finance/account:' + id, doc);
    bump();
    return !(ok === false || ok == null);
  };
  const setAccountArchived = (id, archived) => {
    const b = bookRef.current; const a = b.accounts.get(id); if (!a) return Promise.resolve(false);
    return saveAccount({ id: a.id, code: a.code, name: a.name, type: a.type, archived });
  };
  const saveFund = async ({ id, name, kind }) => {
    const b = bookRef.current;
    if (id === 'general') return false;   // the implicit general fund is never renamed or removed
    if (b.funds.has(id)) b.funds.set(id, { id, name: name || id, kind });
    else F.addFund(b, { id, name, kind });
    if (!useRelay) { booksSave(b); bump(); return true; }
    const ok = await S.encPublish('finance/fund:' + id, { name: name || id, kind });
    bump();
    return !(ok === false || ok == null);
  };
  // Move £X from one fund to another as a balanced, income/expenditure-NEUTRAL journal entry (see
  // FUND_TRANSFER_ACCT in finance-ledger.mjs). Publish-if-absent the reserved account FIRST, as a normal
  // replaceable doc, so every console — old and new — can rebuild a book that contains the transfer.
  const transferFunds = async ({ fromFund, toFund, amountMinor, date, memo }) => {
    const b = bookRef.current;
    if (!amountMinor || fromFund === toFund || !b.funds.has(fromFund) || !b.funds.has(toFund)) return false;
    if (!b.accounts.get('fund-transfer')) {
      if (useRelay) {
        const ok = await S.encPublish('finance/account:fund-transfer', { code: '3900', name: 'Fund transfer', type: 'equity', archived: false });
        if (ok === false || ok == null) {
          try { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'fund transfer', message: 'Could not set up fund transfers — your church\'s relay refused or did not answer. Nothing was moved.' } })); } catch (e2) {}
          return false;
        }
      }
      try { F.addAccount(b, { id: 'fund-transfer', code: '3900', name: 'Fund transfer', type: 'equity', archived: false }); } catch (e) {}
    }
    const P = [{ account: 'fund-transfer', fund: fromFund, dir: 'dr', amount: amountMinor },
               { account: 'fund-transfer', fund: toFund, dir: 'cr', amount: amountMinor }];
    const entry = F.post(b, { date, memo, postings: P });
    return pubEntry(b, entry).then((ok) => { if (!ok) _dropIfRefused(b, entry); bump(); return ok; });
  };

  // ── recurring templates (standing orders / DDs) ──────────────────────────────────────────────────────────
  // A template is a REPLACEABLE finance/template:<id> doc (opaque id), NOT part of the book. "Post this month"
  // mints a balanced journal entry via the SAME awaited pubEntry + dropFrom-on-refusal path as record(), with
  // a deterministic importKey so a double tap (or a second co-steward) cannot post it twice — F.templatePost
  // returns null when the book already holds this template-month.
  const thisMonth = booksTodayISO().slice(0, 7);   // LOCAL month (booksTodayISO is the local-day helper), injected into the pure module
  const saveTemplate = async ({ id, name, account, fund, dir, amount, dayOfMonth }) => {
    const theId = id || opaqueId();
    const body = { name: name || '', account, fund: fund || 'general', dir, amount, dayOfMonth };
    if (!useRelay) { setTemplates(ts => [...ts.filter(t => t.id !== theId), { t: 'template', id: theId, ...body }]); bump(); return true; }
    const ok = await S.encPublish('finance/template:' + theId, body);
    bump();
    return !(ok === false || ok == null);
  };
  const postTemplate = (t) => {
    const b = bookRef.current;
    const plan = F.templatePost(b, { id: t.id, name: t.name, account: t.account, fund: t.fund, dir: t.dir, amount: t.amount, dayOfMonth: t.dayOfMonth }, thisMonth);
    if (!plan) return Promise.resolve('already');   // already posted this month — idempotent, nothing to do
    let entry = null;
    try { entry = F.post(b, { date: plan.date, memo: plan.memo, importKey: plan.importKey, postings: plan.postings }); }
    catch (e) { return Promise.resolve(false); }
    return pubEntry(b, entry).then((ok) => { if (!ok) _dropIfRefused(b, entry); bump(); return ok; });
  };
  // A reconciliation is a REPLACEABLE finance/reconcile:<id> side doc (match state + statement identity), NOT
  // money — the matcher is pure and read-only over the journal, so it structurally cannot double-count.
  const saveReconcile = async ({ id, label, lines, reconciled, closing, asOf }) => {
    const theId = id || opaqueId();
    const body = { label: label || '', lines: lines || [], reconciled: reconciled || [], closing: closing == null ? null : closing, asOf: asOf || '' };
    if (!useRelay) { setReconciles(rs => [...rs.filter(r => r.id !== theId), { t: 'reconcile', id: theId, ...body }]); bump(); return true; }
    const ok = await S.encPublish('finance/reconcile:' + theId, body);
    bump();
    return !(ok === false || ok == null);
  };
  // A DONOR RECORD (finance/donor:<id>, Phase 4b) — a REPLACEABLE finance doc holding member-identifying giving
  // data. OPAQUE id (CONTEXT: two authorised writers must not collide on a shared slug). Written finance-only
  // (the relay's generic finance/ write prefix); the relay keeps it off a network peer on READ (the explicit
  // finance/donor read rule). NOTE a "forget this donor" removes this doc but CANNOT scrub the opaque donorId
  // already embedded in the append-only journal — acceptable under HMRC retention, surfaced in the UI copy.
  const saveDonor = async ({ id, name, eligible, address, postcode, giftAidDeclaredAt, title, firstName, lastName, house }) => {
    const theId = id || opaqueId();
    const body = { name: name || '', eligible: eligible === true, address: address || '', postcode: postcode || '', giftAidDeclaredAt: giftAidDeclaredAt || '', title: title || '', firstName: firstName || '', lastName: lastName || '', house: house || '' };
    if (!useRelay) { setDonors(ds => [...ds.filter(d => d.id !== theId), { t: 'donor', id: theId, ...body }]); bump(); return true; }
    const ok = await S.encPublish('finance/donor:' + theId, body);
    bump();
    return !(ok === false || ok == null);
  };
  // ── invoicing / accounts receivable (Phase 5) ──────────────────────────────────────────────────────────
  // A CONTACT is a REPLACEABLE finance/contact:<id> side doc (opaque id), customer PII the money never carries.
  const saveContact = async ({ id, name, email, address }) => {
    const theId = id || opaqueId();
    const body = { name: name || '', email: email || '', address: address || '' };
    if (!useRelay) { setContacts(cs => [...cs.filter(c => c.id !== theId), { t: 'contact', id: theId, ...body }]); bump(); return true; }
    const ok = await S.encPublish('finance/contact:' + theId, body);
    bump();
    return !(ok === false || ok == null);
  };
  // Publish-if-absent the reserved Accounts-Receivable account (the fund-transfer pattern), so an un-upgraded
  // console can still rebuild a book that posts to it. assertArAccount THROWS if a hand-made account collided on
  // the slug with the wrong type — caught by the issue path, which refuses rather than post a dr to non-asset.
  const ensureAr = async () => {
    const b = bookRef.current;
    if (F.assertArAccount(b)) return true;   // present + asset
    const a = F.AR_ACCOUNT;
    if (useRelay) {
      const ok = await S.encPublish('finance/account:' + a.id, { code: a.code, name: a.name, type: a.type, archived: false });
      if (ok === false || ok == null) {
        try { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'invoice', message: 'Could not set up the receivables account — your church\'s relay refused or did not answer. Nothing was raised.' } })); } catch (e2) {}
        return false;
      }
    }
    try { F.addAccount(b, { id: a.id, code: a.code, name: a.name, type: a.type, archived: false }); } catch (e) {}
    return true;
  };
  // ISSUE an invoice: dr AR / cr income (accrual) on the append-only journal — the SAME awaited pubEntry +
  // dropFrom-on-refusal path as record() — then publish the REPLACEABLE finance/invoice:<id> metadata doc. The
  // id is opaque (booksRandId); the human invoice number is a FIELD. The journal entry carries the invoice id so
  // status can be derived from it. If the journal is refused, nothing is published and nothing is left behind.
  const issueInvoice = async ({ number, contact, lines, issued, due }) => {
    const b = bookRef.current;
    const clean = (lines || []).filter(l => l && l.account && Number.isSafeInteger(l.amount) && l.amount > 0);
    if (!clean.length) return false;
    let okAr;
    try { okAr = await ensureAr(); }
    catch (e) { try { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'invoice', message: (e && e.message) || 'The receivables account is the wrong type.' } })); } catch (e2) {} return false; }
    if (!okAr) return false;
    const id = booksRandId();
    const invoice = { id, number: number || '', contact: contact || '', lines: clean, issued: issued || booksTodayISO(), due: due || '' };
    let entry = null;
    try { entry = F.post(b, F.invoiceIssueEntry(invoice)); }
    catch (e) { bump(); return false; }
    const ok = await pubEntry(b, entry);
    if (!ok) { _dropIfRefused(b, entry); bump(); return false; }
    const body = { number: invoice.number, contact: invoice.contact, lines: clean, issued: invoice.issued, due: invoice.due, issueSeq: entry.seq };
    if (!useRelay) { setInvoices(xs => [...xs.filter(x => x.id !== id), { t: 'invoice', id, ...body }]); bump(); return true; }
    const okDoc = await S.encPublish('finance/invoice:' + id, body);
    bump();
    return !(okDoc === false || okDoc == null);
  };
  // MARK PAID — manual settlement: dr bank / cr AR, tagged with the invoice id. Works STANDALONE (no Phase 3);
  // auto-match of a bank line to an open invoice is the only part that would ride reconcile. `amount` optional
  // (defaults to the whole invoice) for a part payment.
  const settleInvoice = async (inv, amount) => {
    const b = bookRef.current;
    let entry = null;
    try { if (!F.assertArAccount(b)) return false; entry = F.post(b, F.invoiceSettlementEntry(inv, { date: booksTodayISO(), amount })); }
    catch (e) { bump(); return false; }
    const ok = await pubEntry(b, entry);
    if (!ok) _dropIfRefused(b, entry);
    bump();
    return ok;
  };
  // CREDIT NOTE — its OWN doc + its OWN balanced reversing entry (dr income/fund, cr AR), tagged with the
  // ORIGINAL invoice id so the receivable nets out; the original invoice is never edited (append-only). This is
  // a FULL credit of every line (a hand-built entry, since ledger.reverse() is full-only and carries no invoice tag).
  const creditInvoice = async (inv) => {
    const b = bookRef.current;
    const cnId = booksRandId();
    let entry = null;
    try { entry = F.post(b, F.creditNoteEntry(inv, { id: cnId, lines: inv.lines || [] }, { date: booksTodayISO() })); }
    catch (e) { bump(); return false; }
    const ok = await pubEntry(b, entry);
    if (!ok) { _dropIfRefused(b, entry); bump(); return false; }
    const body = { number: inv.number ? inv.number + '-CN' : '', contact: inv.contact || '', lines: inv.lines || [], issued: booksTodayISO(), due: '', credit: true, ref: inv.id, issueSeq: entry.seq };
    if (!useRelay) { setInvoices(xs => [...xs, { t: 'invoice', id: cnId, ...body }]); bump(); return true; }
    const okDoc = await S.encPublish('finance/invoice:' + cnId, body);
    bump();
    return !(okDoc === false || okDoc == null);
  };
  // Printable invoice/credit-note — the SAME saveConsoleFile path the statement HTML export uses. The status
  // stamped on it is DERIVED (F.invoiceStatus), never the stored cache.
  const exportInvoicePdf = async (inv) => {
    const status = F.invoiceStatus(inv, booksTodayISO(), book.journal);
    try {
      const html = F.invoiceHtml(inv, { churchName: church.name || '', currency: book.baseCurrency, decimals: book.decimals, status, generatedAt: booksTodayISO(), credit: inv.credit });
      const base = fsSlug((inv.credit ? 'credit-note-' : 'invoice-') + (inv.number || inv.id));
      const msg = await fsDownloadDoc(base + '.html', html, 'text/html;charset=utf-8');
      setInvFlash(msg || 'Downloaded — open it to print or save as PDF.');
    } catch (e) { setInvFlash((e && e.message) || 'Could not save the invoice on this device.'); }
  };
  // ── bills / accounts payable (Phase 6) ─────────────────────────────────────────────────────────────────
  // Publish-if-absent the reserved Accounts-Payable account (the AR / fund-transfer pattern), so an un-upgraded
  // console can still rebuild a book that posts to it. assertApAccount THROWS if a hand-made account collided on
  // the slug with the wrong type — caught by the record path, which refuses rather than cr a non-liability.
  const ensureAp = async () => {
    const b = bookRef.current;
    if (F.assertApAccount(b)) return true;   // present + liability
    const a = F.AP_ACCOUNT;
    if (useRelay) {
      const ok = await S.encPublish('finance/account:' + a.id, { code: a.code, name: a.name, type: a.type, archived: false });
      if (ok === false || ok == null) {
        try { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'bill', message: 'Could not set up the payables account — your church\'s relay refused or did not answer. Nothing was recorded.' } })); } catch (e2) {}
        return false;
      }
    }
    try { F.addAccount(b, { id: a.id, code: a.code, name: a.name, type: a.type, archived: false }); } catch (e) {}
    return true;
  };
  // RECORD a bill: dr expense/fund / cr AP (accrual) on the append-only journal — the SAME awaited pubEntry +
  // dropFrom-on-refusal path as issueInvoice — then publish the REPLACEABLE finance/bill:<id> metadata doc. The
  // id is opaque (booksRandId); the supplier's invoice number is a FIELD. Recording does NOT approve: the bill
  // is unpaid until it is approved AND paid.
  const recordBill = async ({ number, supplier, lines, received, due }) => {
    const b = bookRef.current;
    const clean = (lines || []).filter(l => l && l.account && Number.isSafeInteger(l.amount) && l.amount > 0);
    if (!clean.length) return false;
    let okAp;
    try { okAp = await ensureAp(); }
    catch (e) { try { window.dispatchEvent(new CustomEvent('steward-write-blocked', { detail: { what: 'bill', message: (e && e.message) || 'The payables account is the wrong type.' } })); } catch (e2) {} return false; }
    if (!okAp) return false;
    const id = booksRandId();
    // WHO RECORDED IT — the separation-of-duties anchor for dual mode. window.Steward.pubkey is this console's
    // signing pubkey (the key the relay sees as e.pubkey): the church key on an owner console, the steward's own
    // key on a delegated one. Stored on the bill doc so a DIFFERENT finance steward must be the one who approves.
    const me = ((S && S.pubkey) || '').toLowerCase();
    const bill = { id, number: number || '', supplier: supplier || '', lines: clean, received: received || booksTodayISO(), due: due || '' };
    let entry = null;
    try { entry = F.post(b, F.billReceiveEntry(bill)); }
    catch (e) { bump(); return false; }
    const ok = await pubEntry(b, entry);
    if (!ok) { _dropIfRefused(b, entry); bump(); return false; }
    const body = { number: bill.number, supplier: bill.supplier, lines: clean, received: bill.received, due: bill.due, by: me, receiveSeq: entry.seq };
    if (!useRelay) { setBills(xs => [...xs.filter(x => x.id !== id), { t: 'bill', id, ...body }]); bump(); return true; }
    const okDoc = await S.encPublish('finance/bill:' + id, body);
    bump();
    return !(okDoc === false || okDoc == null);
  };
  // APPROVE a bill. BOTH owner-chosen modes (OWNER DECISION 2026-10-30):
  //  · LIGHT (default): set an `approved` field on the REPLACEABLE finance/bill:<id> doc — any finance steward
  //    may; convenient, not tamper-evident. Re-publishes the whole bill doc with approved={by,ts} added.
  //  · DUAL (features.billApproval===true): publish a SEPARATE approver-SIGNED finance/billapproval:<billId>:
  //    <approverhex> doc. The relay refuses any write whose signer != the hex in the address (the check-in-
  //    arrival pattern), so the approver is BOUND to the signer and cannot be forged. We sign as ourselves, so
  //    the hex is our own signing pubkey (window.Steward.pubkey — the key the relay sees as e.pubkey).
  const approveBill = async (bill) => {
    const me = ((S && S.pubkey) || '').toLowerCase();
    if (billApprovalMode === 'dual') {
      if (!/^[0-9a-f]{64}$/.test(me)) { setBillFlash('Could not read your signing key, so nothing was approved.'); return false; }
      // SEPARATION OF DUTIES: you cannot approve a bill you recorded. The engine (isBillApproved) ignores a
      // self-approval anyway, so this is honest UX, not the only guard — but it stops a pointless write that
      // would never count. A church with one finance steward simply cannot reach approved in dual mode (intended).
      if (me === (bill.by || '').toLowerCase()) { setBillFlash('You recorded this bill, so another finance steward must approve it — that is what dual control means.'); return false; }
      if (!useRelay) { setBillApprovals(xs => [...xs.filter(x => x.id !== bill.id + ':' + me), { t: 'billapproval', id: bill.id + ':' + me, bill: bill.id, approver: me, ts: Math.floor(Date.now() / 1000) }]); bump(); return true; }
      const ok = await S.encPublish('finance/billapproval:' + bill.id + ':' + me, { bill: bill.id, ts: Math.floor(Date.now() / 1000) });
      bump();
      return !(ok === false || ok == null);
    }
    // LIGHT: re-publish the bill doc with the approval field set. PRESERVE `by` (the recorder) — a replaceable
    // doc is overwritten wholesale, so dropping it here would wipe who recorded the bill.
    const body = { number: bill.number || '', supplier: bill.supplier || '', lines: bill.lines || [], received: bill.received || '', due: bill.due || '', by: bill.by || '', receiveSeq: bill.receiveSeq ?? null, approved: { by: me, ts: Math.floor(Date.now() / 1000) } };
    if (!useRelay) { setBills(xs => xs.map(x => x.id === bill.id ? { ...x, approved: body.approved } : x)); bump(); return true; }
    const ok = await S.encPublish('finance/bill:' + bill.id, body);
    bump();
    return !(ok === false || ok == null);
  };
  // MARK PAID — manual settlement: dr AP / cr bank, tagged with the bill id. Works STANDALONE (no Phase 3); an
  // auto-match of a bank line to an open bill is the only part that would ride reconcile, and it MUST call this
  // same path so the guard still applies. THE APPROVAL GUARD is in F.billPaymentEntry (it throws unless the bill
  // is approved), so this cannot pay an unapproved bill even if the disabled Mark-paid control were bypassed —
  // the screen control AND the engine guard both have to be deleted for an unapproved bill to be paid.
  const payBill = async (bill, amount) => {
    const b = bookRef.current;
    const approved = F.isBillApproved(bill, { mode: billApprovalMode, approvals: billApprovals, recordedBy: bill.by || '' });
    let entry = null;
    try { if (!F.assertApAccount(b)) return false; entry = F.post(b, F.billPaymentEntry(bill, { date: booksTodayISO(), amount, approved })); }
    catch (e) { setBillFlash((e && e.message) || 'That bill cannot be paid yet.'); bump(); return false; }
    const ok = await pubEntry(b, entry);
    if (!ok) _dropIfRefused(b, entry);
    bump();
    return ok;
  };
  // AN ANNUAL BUDGET (finance/budget:<id>, Phase 7) — a REPLACEABLE finance doc that is a pure READ OVERLAY:
  // it carries {year, lines:[{account, fund, amount}]} and is NEVER posted to the journal (no encPublish of a
  // finance/journal: doc here; rebuildBook ignores t:'budget'). OPAQUE id (CONTEXT: two authorised writers must
  // not collide on a shared slug and silently overwrite). Written finance-only via the relay's generic finance/
  // write prefix — no new gateway rule, no widening. `amount` is integer minor units; `fund` is '' for an
  // account-across-all-funds line or a fund id for a per-fund line.
  const saveBudget = async ({ id, year, lines }) => {
    const theId = id || opaqueId();
    const body = { year: year || '', lines: (Array.isArray(lines) ? lines : []).map(l => ({ account: l.account, fund: l.fund || '', amount: Math.round(l.amount || 0) })) };
    if (!useRelay) { setBudgets(bs => [...bs.filter(b => b.id !== theId), { t: 'budget', id: theId, ...body }]); bump(); return true; }
    const ok = await S.encPublish('finance/budget:' + theId, body);
    bump();
    return !(ok === false || ok == null);
  };
  // The donor NAME lookup the giving-by-member + Gift Aid screens resolve opaque donorIds through.
  const donorMap = React.useMemo(() => new Map(donors.map(d => [d.id, d])), [donors]);
  // Gift Aid is a UK regional PACK, OFF BY DEFAULT: strict === true (NOT the default-on `!== false` feature
  // convention — DOMAIN nation-neutral), and the pack code only exists if its separate bundle loaded.
  const giftAidOn = !!(church && church.features && church.features.giftAid === true);
  // Bill approval mode — DUAL control is an OPT-IN a church turns on, OFF BY DEFAULT: strict === true (NOT the
  // default-on `!== false` convention — DOMAIN nation-neutral/silent, like giftAid). Default is the LIGHT flow
  // (approval is a field on the replaceable bill doc). In BOTH modes the Mark-paid control and the engine guard
  // refuse payment before approval; dual adds the tamper-evident, approver-signed approval doc.
  const billApprovalMode = (church && church.features && church.features.billApproval === true) ? 'dual' : 'light';

  const funds = F.fundBalances(book);
  const fyStart = (() => { const mm = (book.fiscalYearStart || '01-01'); const y = new Date().getFullYear(); const t = y + '-' + mm; return t <= todayISO() ? t : (y - 1) + '-' + mm; })();   // LOCAL today, as the year above is local (calendar-day.test.mjs)
  const fyYear = fyStart.slice(0, 4);   // the fiscal year the Budget panel plans/compares against
  const budgetForFy = budgets.find(b => b.year === fyYear) || budgets[0] || null;   // one budget per year; fall back to any saved budget
  const ie = F.incomeExpenditure(book, { from: fyStart });
  const bank = F.trialBalance(book).rows.find(r => r.account === 'bank');
  const cash = bank ? bank.debit - bank.credit : 0;
  const recent = book.journal.slice().reverse().slice(0, 16);
  const exportCsv = async () => {
    // MAJOR UNITS (pounds), not the ledger's integer pence — F.journalCsvRows does the conversion (sim 2026-10-02 #62).
    const rows = F.journalCsvRows(book);
    // SECURITY-AUDIT-2026-07-06 H6: CSV formula-injection guard. `memo` carries bank-statement descriptions
    // imported verbatim (attacker-controllable via a payment reference). RFC-4180 quoting does NOT stop a cell
    // that STARTS with = + - @ (or tab/CR) from being run as a formula when the treasurer opens the file in
    // Excel/Sheets (=HYPERLINK/WEBSERVICE exfil, or DDE command exec). Prefix such cells with a ' to neutralise.
    const csvCell = c => { let s = String(c); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    try {
      const msg = await booksDownload('finance-' + booksTodayISO() + '.csv', rows.map(r => r.map(csvCell).join(',')).join('\n'));
      setExported(msg); if (/^Saved/.test(msg)) setTimeout(() => setExported(''), 5000);   // a receipt fades; a warning stays
    } catch (e) { setExported((e && e.message) || 'Could not save the export on this device.'); }
  };

  // ── aggregate Reports panel: a report PRESET + a PERIOD, rendered on screen and exported to PDF/CSV/HTML via
  // the same statement render + saveConsoleFile path the Share modal uses. All presets are name-free (no PII).
  const rptNow = new Date();
  const rptY = rptNow.getFullYear(), rptQ = Math.floor(rptNow.getMonth() / 3) + 1;
  const rptRange = rptPeriod === 'this-q' ? F.quarterRange(rptY, rptQ)
    : rptPeriod === 'last-y' ? F.yearRange(rptY - 1)
    : { ...F.yearRange(rptY), to: booksTodayISO(), label: 'Year to date ' + rptY };
  const rptDef = FIN_REPORT_PRESETS.find(p => p.key === rptPreset) || FIN_REPORT_PRESETS[0];
  const rptModel = F.buildStatement(book, {
    from: rptRange.from, to: rptRange.to, periodLabel: rptRange.label,
    title: (church.name || 'Financial statement') + ' — ' + rptDef.label,
    sections: rptDef.sections, generatedAt: booksTodayISO(), accent: (church.accent || ''),
  });
  const rptBase = () => fsSlug((church.name || 'report') + '-' + rptDef.label) + '-' + fsSlug(rptRange.label);
  const exportReportPdf = async () => {
    try {
      const doc = fsBuildStatementPdf(rptModel, F);
      if (doc) { const msg = await fsSavePdf(doc, rptBase() + '.pdf'); setRptFlash(msg || 'Downloaded — ready to print or share.'); return; }
      const msg = await fsDownloadDoc(rptBase() + '.html', F.statementHtml(rptModel), 'text/html;charset=utf-8');   // no jsPDF → HTML
      setRptFlash(msg || 'Downloaded — open it to print or save as PDF.');
    } catch (e) { setRptFlash((e && e.message) || 'Could not save the report on this device.'); }
  };
  const exportReportHtml = async () => {
    try { const msg = await fsDownloadDoc(rptBase() + '.html', F.statementHtml(rptModel), 'text/html;charset=utf-8'); setRptFlash(msg || 'Downloaded — open it to print or save as PDF.'); }
    catch (e) { setRptFlash((e && e.message) || 'Could not save the report on this device.'); }
  };
  const exportReportCsv = async () => {
    // Same formula-injection guard as exportCsv — a report cell can carry an imported, attacker-controllable memo.
    const csvCell = c => { let s = String(c); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    try { const rows = F.reportCsvRows(rptModel); const msg = await booksDownload(rptBase() + '.csv', rows.map(r => r.map(csvCell).join(',')).join('\n')); setRptFlash(msg); }
    catch (e) { setRptFlash((e && e.message) || 'Could not save the report on this device.'); }
  };

  const stat = (label, val, tone) => (
    <div style={{ ...bkCard, flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
      <div style={{ fontSize: 25, fontWeight: 800, marginTop: 6, color: tone || 'var(--ink)', fontFamily: 'var(--font-display, var(--font-ui))' }}>{val}</div>
    </div>
  );

  return (
    <div style={{ padding: '4px 2px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 24 }}>Finance</h2>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 2 }}>Your church's accounts — double-entry, with fund tracking.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setImporting(true)} title="Bring in transactions from a bank statement file" disabled={bookErrors.length > 0} className="sk-btn" style={{ padding: '10px 16px', fontSize: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', opacity: bookErrors.length ? 0.5 : 1 }}><Icon name="receipt" size={16} color="var(--ink)" /> Import statement</button>
          <button onClick={() => setReconciling({})} title="Reconcile a bank statement against your ledger and check the closing balance" disabled={bookErrors.length > 0} className="sk-btn" style={{ padding: '10px 16px', fontSize: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', opacity: bookErrors.length ? 0.5 : 1 }}><Icon name="check" size={16} color="var(--ink)" /> Reconcile</button>
          <button onClick={() => setRecording(true)} title="Record a gift or an expense by hand" disabled={bookErrors.length > 0} className="sk-btn sk-btn--clay" style={{ padding: '10px 16px', fontSize: 14, opacity: bookErrors.length ? 0.5 : 1 }}><Icon name="plus" size={16} color="var(--on-clay)" /> Record a transaction</button>
        </div>
      </div>

      {bookErrors.length > 0 && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 12, marginBottom: 16, background: 'color-mix(in oklab, var(--clay) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 30%, var(--line))' }}>
        <Icon name="alert" size={18} color="var(--clay)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>Your books are incomplete — {bookErrors[0]}. Don't re-enter anything; new entries can't be saved until it arrives. If this persists, check your connection.</div>
      </div>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {stat('In the bank', booksFmt(cash, book))}
        {stat('Income this year', booksFmt(ie.income, book), 'var(--sage, #4f7a5e)')}
        {stat('Spending this year', booksFmt(ie.expenditure, book), 'var(--clay-deep, #b4462f)')}
        {stat('Surplus this year', booksFmt(ie.surplus, book), ie.surplus < 0 ? 'var(--clay-deep, #b4462f)' : 'var(--sage, #4f7a5e)')}
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 10, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16 }}>Funds</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {funds.map(f => (
            <div key={f.fund} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px', minWidth: 150 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{f.name}{f.kind === 'restricted' ? ' · restricted' : f.kind === 'designated' ? ' · designated' : ''}</div>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 2 }}>{booksFmt(f.balance, book)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16 }}>Recent transactions</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSharing(true)} title="Choose what to share and send a statement to members" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 9, padding: '6px 11px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="share" size={14} color="var(--ink)" /> Share statement</button>
            <button onClick={exportCsv} title="Download all transactions as a spreadsheet (CSV) file" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 9, padding: '6px 11px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>Export CSV</button>
          </div>
        </div>
        {exported ? <div role="status" style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)', margin: '-4px 0 10px' }}>{exported}</div> : null}
        {recent.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '10px 0' }}>No transactions yet — record your first with the button above.</div>}
        {recent.map(e => { const v = booksEntryView(book, e); return (
          <div key={e.seq} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, textDecoration: v.wasReversed ? 'line-through' : 'none', opacity: v.wasReversed ? .6 : 1 }}>{v.category}{v.memo ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {v.memo}</span> : ''}{v.wasReversed ? <span style={{ color: 'var(--ink-3)', fontWeight: 400, fontSize: 12, marginLeft: 6 }}>reversed</span> : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{v.date}{v.fund && v.fund !== 'general' ? ' · ' + ((book.funds.get(v.fund) || {}).name || v.fund) : ''}</div>
            </div>
            {e.attachmentRefs && e.attachmentRefs.length ? <button title="View the receipt attached to this entry" aria-label="View receipt" onClick={() => setViewingAtt(attByIdRef.current[e.attachmentRefs[0]] || 'pending')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 14, padding: 4 }}>📎</button> : null}
            <div style={{ fontWeight: 800, fontSize: 14.5, color: v.isTransfer ? 'var(--ink-3)' : (v.inflow ? 'var(--sage, #4f7a5e)' : 'var(--clay-deep, #b4462f)'), whiteSpace: 'nowrap' }}>{v.isTransfer ? '' : (v.inflow ? '+' : '−')}{booksFmt(v.amount, book)}</div>
            {/* Correct and Reverse share the gate: both are hidden on a reversal row and on an already-reversed
                row (reuse booksEntryView's isReversal/wasReversed). Correct additionally skips a fund transfer,
                which has no BooksRecord (income/expense) shape to pre-fill. */}
            {!v.isReversal && !v.wasReversed && !v.isTransfer && <button title="Reverse this entry and enter a corrected copy" onClick={() => correctEntry(e)} disabled={bookErrors.length > 0} style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '3px 9px', cursor: bookErrors.length ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)', opacity: bookErrors.length ? 0.5 : 1 }}>Correct</button>}
            {!v.isReversal && !v.wasReversed && <button title="Reverse this entry" aria-label="Reverse this entry" onClick={() => undo(e.seq)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 15, padding: 4 }}>↩</button>}
          </div>
        ); })}
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <button onClick={() => setReports(r => !r)} title="Show or hide the income and expense reports" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16, color: 'var(--ink)', padding: 0 }}>{reports ? '▾' : '▸'} Reports</button>
        {reports && (() => {
          const m = rptModel;
          const chip = (active, onClick, label, key) => (
            <button key={key} onClick={onClick} style={{ padding: '6px 11px', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5,
              border: '1px solid ' + (active ? 'var(--clay)' : 'var(--line)'), background: active ? 'var(--clay)' : 'transparent', color: active ? '#fff' : 'var(--ink)' }}>{label}</button>
          );
          const line = (label, val, bold) => (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '3px 0', fontWeight: bold ? 800 : 400 }}>
              <span>{label}</span><span style={{ fontWeight: bold ? 800 : 700 }}>{booksFmt(val, book)}</span>
            </div>
          );
          const kindOf = r => r.kind === 'restricted' ? ' · restricted' : r.kind === 'designated' ? ' · designated' : '';
          return (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 9 }}>
              {FIN_REPORT_PRESETS.map(p => chip(rptPreset === p.key, () => setRptPreset(p.key), p.label, p.key))}
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
              {chip(rptPeriod === 'this-q', () => setRptPeriod('this-q'), 'This quarter', 'q')}
              {chip(rptPeriod === 'this-y', () => setRptPeriod('this-y'), 'Year to date', 'y')}
              {chip(rptPeriod === 'last-y', () => setRptPeriod('last-y'), 'Last year', 'ly')}
            </div>
            <div style={{ fontWeight: 800, fontSize: 14, margin: '2px 0 2px', fontFamily: 'var(--font-display, var(--font-ui))' }}>{rptDef.label}</div>
            <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 8 }}>{rptRange.label}</div>

            {m.summary && (<div style={{ marginBottom: 8 }}>
              {line('Total income', m.summary.income)}{line('Total spending', m.summary.expenditure)}{line(m.summary.surplus < 0 ? 'Deficit' : 'Surplus', m.summary.surplus, true)}
            </div>)}
            {m.income && m.income.length ? <div style={{ marginBottom: 8 }}><div style={{ ...bkLbl, margin: '6px 0 2px' }}>Income by category</div>{m.income.map(r => <div key={r.account}>{line(r.name, r.amount)}</div>)}</div> : null}
            {m.spending && m.spending.length ? <div style={{ marginBottom: 8 }}><div style={{ ...bkLbl, margin: '6px 0 2px' }}>Spending by category</div>{m.spending.map(r => <div key={r.account}>{line(r.name, r.amount)}</div>)}</div> : null}
            {m.givingFund && m.givingFund.length ? <div style={{ marginBottom: 8 }}><div style={{ ...bkLbl, margin: '6px 0 2px' }}>Giving by fund</div>{m.givingFund.map(r => <div key={r.fund}>{line(r.name + kindOf(r), r.amount)}</div>)}</div> : null}
            {m.funds && m.funds.length ? <div style={{ marginBottom: 8 }}><div style={{ ...bkLbl, margin: '6px 0 2px' }}>Fund balances (closing)</div>{m.funds.map(r => <div key={r.fund}>{line(r.name + kindOf(r), r.balance)}</div>)}</div> : null}
            {m.fundMovements && m.fundMovements.length ? (
              <div style={{ marginBottom: 8 }}>
                <div style={{ ...bkLbl, margin: '6px 0 4px' }}>Fund movements</div>
                <div style={{ display: 'flex', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 700, padding: '0 0 3px' }}><span style={{ flex: 1 }} /><span style={{ width: 86, textAlign: 'right' }}>Opening</span><span style={{ width: 70, textAlign: 'right' }}>In</span><span style={{ width: 70, textAlign: 'right' }}>Out</span><span style={{ width: 86, textAlign: 'right' }}>Closing</span></div>
                {m.fundMovements.map(r => (
                  <div key={r.fund} style={{ display: 'flex', fontSize: 13, padding: '3px 0', borderTop: '1px solid var(--line)' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{r.name}{kindOf(r)}</span>
                    <span style={{ width: 86, textAlign: 'right' }}>{booksFmt(r.opening, book)}</span>
                    <span style={{ width: 70, textAlign: 'right', color: 'var(--sage, #4f7a5e)' }}>{booksFmt(r.in, book)}</span>
                    <span style={{ width: 70, textAlign: 'right', color: 'var(--clay-deep, #b4462f)' }}>{booksFmt(r.out, book)}</span>
                    <span style={{ width: 86, textAlign: 'right', fontWeight: 700 }}>{booksFmt(r.closing, book)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {m.receipts ? (() => { const rp = m.receipts; return (
              <div style={{ marginBottom: 8 }}>
                <div style={{ ...bkLbl, margin: '6px 0 2px' }}>Receipts</div>
                {rp.receipts.map(r => <div key={r.account}>{line(r.name, r.amount)}</div>)}
                {line('Total receipts', rp.totalReceipts, true)}
                <div style={{ ...bkLbl, margin: '10px 0 2px' }}>Payments</div>
                {rp.payments.map(r => <div key={r.account}>{line(r.name, r.amount)}</div>)}
                {line('Total payments', rp.totalPayments, true)}
                <div style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 4 }}>{line('Net cash movement', rp.net, true)}{line('Cash at start', rp.openingCash)}{line('Cash at end', rp.closingCash)}</div>
              </div>
            ); })() : null}
            {m.balance ? <div style={{ marginBottom: 8 }}><div style={{ ...bkLbl, margin: '6px 0 2px' }}>Balance sheet</div>{line('Assets', m.balance.assets)}{line('Liabilities', m.balance.liabilities)}{line('Net funds', m.balance.funds, true)}</div> : null}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <button onClick={exportReportPdf} title="Download this report as a PDF to print or share" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 9, padding: '6px 11px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>Export PDF</button>
              <button onClick={exportReportCsv} title="Download this report as a spreadsheet (CSV) file" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 9, padding: '6px 11px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>Export CSV</button>
              <button onClick={exportReportHtml} title="Download this report as a printable web page" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 9, padding: '6px 11px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>Export HTML</button>
            </div>
            {rptFlash ? <div role="status" style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)', marginTop: 8 }}>{rptFlash}</div> : null}
          </div>
          );
        })()}
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <button onClick={() => setManaging(r => !r)} title="Show or hide your chart of accounts and funds" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16, color: 'var(--ink)', padding: 0 }}>{managing ? '▾' : '▸'} Accounts &amp; funds</button>
        {managing && (
          <div style={{ marginTop: 14 }}>
            {/* ── Funds ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2px 0 8px' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Funds</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setMoving(true)} disabled={bookErrors.length > 0} title="Move money from one fund to another" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)', opacity: bookErrors.length ? 0.5 : 1 }}>Move between funds</button>
                <button onClick={() => setFundEditing({})} title="Create a new fund" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>+ Add fund</button>
              </div>
            </div>
            {[...book.funds.values()].map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>{f.name}</span>{f.kind !== 'general' ? <span style={{ color: 'var(--ink-3)', fontSize: 12 }}> · {FUND_KIND_LABEL[f.kind] || f.kind}</span> : null}</div>
                {f.id === 'general'
                  ? <span style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>default</span>
                  : <button onClick={() => setFundEditing({ id: f.id, name: f.name, kind: f.kind })} title="Rename this fund or change its kind" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>Edit</button>}
              </div>
            ))}

            {/* ── Accounts, grouped by type (the reserved fund-transfer + accounts-receivable accounts are exempt and hidden) ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 8px' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Accounts</div>
              <button onClick={() => setAccEditing({})} title="Create a new account (category)" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>+ Add account</button>
            </div>
            {ACCT_TYPES_ORDER.map(type => {
              const list = [...book.accounts.values()].filter(a => a.type === type && a.id !== 'fund-transfer' && a.id !== 'accounts-receivable');
              if (!list.length) return null;
              return (
                <div key={type} style={{ marginBottom: 6 }}>
                  <div style={{ ...bkLbl, margin: '10px 0 2px' }}>{ACCT_TYPE_LABEL[type] || type}</div>
                  {list.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)', opacity: a.archived ? 0.55 : 1 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.name}</span>
                        <span style={{ color: 'var(--ink-3)', fontSize: 12 }}> · {a.code}</span>
                        {a.archived ? <span style={{ color: 'var(--ink-3)', fontSize: 11.5, fontWeight: 400 }}> · archived</span> : null}
                      </div>
                      <button onClick={() => setAccEditing({ id: a.id, code: a.code, name: a.name, type: a.type, archived: !!a.archived, posted: F.accountHasPostings(book, a.id) })} title="Rename this account or change its code" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>Edit</button>
                      <button onClick={() => setAccountArchived(a.id, !a.archived)} title={a.archived ? 'Show this account in the pickers again' : 'Hide this account from the pickers (kept in the ledger and reports)'} style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>{a.archived ? 'Unarchive' : 'Archive'}</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => setRecurringOpen(r => !r)} title="Show or hide standing orders and other repeating payments" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16, color: 'var(--ink)', padding: 0 }}>{recurringOpen ? '▾' : '▸'} Recurring payments</button>
          {recurringOpen && <button onClick={() => setTplEditing({})} title="Create a new recurring payment" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>+ Add recurring</button>}
        </div>
        {recurringOpen && (
          <div style={{ marginTop: 12 }}>
            {templates.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '4px 0' }}>No recurring payments yet. Add a standing order or direct debit, then post it each month in one tap.</div>}
            {templates.map(t => {
              const acct = book.accounts.get(t.account);
              const postedThisMonth = F.importedKeys(book).has(F.templateImportKey(t.id, thisMonth));
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name || '(unnamed)'}<span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {(acct && acct.name) || t.account} · day {t.dayOfMonth || 1}</span></div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t.dir === 'in' ? '+' : '−'}{booksFmt(t.amount, book)} each month</div>
                  </div>
                  <button onClick={() => setTplEditing({ id: t.id, name: t.name, account: t.account, fund: t.fund, dir: t.dir, amount: t.amount, dayOfMonth: t.dayOfMonth })} title="Edit this recurring payment" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>Edit</button>
                  <button onClick={() => postTemplate(t)} disabled={postedThisMonth || bookErrors.length > 0} title={postedThisMonth ? 'Already posted this month' : 'Post this month’s entry to the ledger'} style={{ border: 'none', background: postedThisMonth ? 'var(--line)' : 'var(--clay)', color: postedThisMonth ? 'var(--ink-3)' : 'var(--on-clay)', borderRadius: 8, padding: '4px 12px', cursor: postedThisMonth ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 12 }}>{postedThisMonth ? 'Posted this month' : 'Post this month'}</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => setDonorsOpen(r => !r)} title="Show or hide your donor records and giving by member" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16, color: 'var(--ink)', padding: 0 }}>{donorsOpen ? '▾' : '▸'} Donors &amp; giving by member</button>
          {donorsOpen && <button onClick={() => setDonorEditing({})} title="Add a donor record" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>+ Add donor</button>}
        </div>
        {donorsOpen && (
          <div style={{ marginTop: 12 }}>
            {donors.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '4px 0' }}>No donor records yet. Add one to track giving by member and (if your church uses it) Gift Aid.</div>}
            {donors.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{d.name || '(unnamed)'}</span>
                  {d.eligible ? <span style={{ color: 'var(--sage, #4f7a5e)', fontSize: 11, fontWeight: 700, marginLeft: 6 }}>Gift Aid</span> : null}
                  {d.postcode ? <span style={{ color: 'var(--ink-3)', fontSize: 12 }}> · {d.postcode}</span> : null}
                </div>
                <button onClick={() => setDonorEditing({ id: d.id, name: d.name, eligible: d.eligible, address: d.address, postcode: d.postcode, giftAidDeclaredAt: d.giftAidDeclaredAt })} title="Edit this donor" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>Edit</button>
              </div>
            ))}
            <BooksGivingByMember book={book} F={F} donors={donorMap} />
          </div>
        )}
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => setInvoicesOpen(r => !r)} title="Show or hide invoices and customers" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16, color: 'var(--ink)', padding: 0 }}>{invoicesOpen ? '▾' : '▸'} Invoices</button>
          {invoicesOpen && <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setContactEditing({})} title="Add a customer / contact" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>+ Add contact</button>
            <button onClick={() => setInvEditing({})} disabled={bookErrors.length > 0} title="Create and issue an invoice" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)', opacity: bookErrors.length ? 0.5 : 1 }}>+ New invoice</button>
          </div>}
        </div>
        {invoicesOpen && (() => {
          const today = booksTodayISO();
          const badge = (status) => {
            const tone = status === 'paid' ? 'var(--sage, #4f7a5e)' : status === 'overdue' ? 'var(--clay-deep, #b4462f)' : 'var(--ink-3)';
            return <span data-invoice-status={status} style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: tone, border: '1px solid var(--line)', borderRadius: 7, padding: '2px 8px', marginLeft: 8 }}>{status}</span>;
          };
          const rows = invoices.slice().sort((a, b) => (a.issued < b.issued ? 1 : a.issued > b.issued ? -1 : 0));
          return (
          <div style={{ marginTop: 12 }}>
            {invFlash ? <div role="status" style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)', margin: '0 0 8px' }}>{invFlash}</div> : null}
            {rows.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '4px 0' }}>No invoices yet. Raise one for facility hire or any amount owed to the church — the double-entry and the receivable are kept for you.</div>}
            {rows.map(inv => {
              const status = inv.credit ? 'credit' : F.invoiceStatus(inv, today, book.journal);
              const total = F.invoiceTotal(inv);
              return (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{inv.credit ? 'Credit note' : 'Invoice'}{inv.number ? ' ' + inv.number : ''}{inv.contact ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {inv.contact}</span> : null}{!inv.credit ? badge(status) : null}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{booksFmt(total, book)}{inv.issued ? ' · issued ' + inv.issued : ''}{inv.due && !inv.credit ? ' · due ' + inv.due : ''}</div>
                  </div>
                  <button onClick={() => exportInvoicePdf(inv)} title="Download this as a printable PDF" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>PDF</button>
                  {!inv.credit && status !== 'paid' && <button onClick={() => { settleInvoice(inv).then(ok => setInvFlash(ok ? 'Marked paid.' : 'That didn’t post — nothing was recorded.')); }} disabled={bookErrors.length > 0} title="Record payment in full (dr bank / cr receivables)" style={{ border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 8, padding: '4px 12px', cursor: bookErrors.length ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 12, opacity: bookErrors.length ? 0.5 : 1 }}>Mark paid</button>}
                  {!inv.credit && <button onClick={() => { creditInvoice(inv).then(ok => setInvFlash(ok ? 'Credit note raised.' : 'That didn’t post — nothing was recorded.')); }} disabled={bookErrors.length > 0} title="Raise a credit note that reverses this invoice (its own entry; the original is untouched)" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: bookErrors.length ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)', opacity: bookErrors.length ? 0.5 : 1 }}>Credit note</button>}
                </div>
              );
            })}
            {contacts.length > 0 && <div style={{ marginTop: 14 }}>
              <div style={{ ...bkLbl, margin: '6px 0 2px' }}>Contacts</div>
              {contacts.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name || '(unnamed)'}</span>{c.email ? <span style={{ color: 'var(--ink-3)', fontSize: 12 }}> · {c.email}</span> : null}</div>
                  <button onClick={() => setContactEditing({ id: c.id, name: c.name, email: c.email, address: c.address })} title="Edit this contact" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>Edit</button>
                </div>
              ))}
            </div>}
          </div>
          );
        })()}
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => setBillsOpen(r => !r)} title="Show or hide bills you owe (accounts payable)" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16, color: 'var(--ink)', padding: 0 }}>{billsOpen ? '▾' : '▸'} Bills</button>
          {billsOpen && <button onClick={() => setBillEditing({})} disabled={bookErrors.length > 0} title="Record a bill you have received (accounts payable)" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: bookErrors.length ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)', opacity: bookErrors.length ? 0.5 : 1 }}>+ New bill</button>}
        </div>
        {billsOpen && (() => {
          const today = booksTodayISO();
          const me = ((S && S.pubkey) || '').toLowerCase();   // this console's signing pubkey — who "I" am, for the self-approval block
          const badge = (status) => {
            const tone = status === 'paid' ? 'var(--sage, #4f7a5e)' : status === 'overdue' ? 'var(--clay-deep, #b4462f)' : 'var(--ink-3)';
            return <span data-bill-status={status} style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: tone, border: '1px solid var(--line)', borderRadius: 7, padding: '2px 8px', marginLeft: 8 }}>{status}</span>;
          };
          const rows = bills.slice().sort((a, b) => (a.received < b.received ? 1 : a.received > b.received ? -1 : 0));
          return (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 8 }}>Recording a bill books the expense now (accrual) and tracks what is owed. A bill must be <b>approved</b> before it can be paid{billApprovalMode === 'dual' ? ' — dual control is on, so a DIFFERENT finance steward than the one who recorded it must approve it (you cannot approve your own bill).' : '.'}</div>
            {billFlash ? <div role="status" style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)', margin: '0 0 8px' }}>{billFlash}</div> : null}
            {rows.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '4px 0' }}>No bills yet. Record one you have received — the double-entry and what you owe are kept for you, and it must be approved before it is paid.</div>}
            {rows.map(bill => {
              const status = F.billStatus(bill, today, book.journal);
              const approved = F.isBillApproved(bill, { mode: billApprovalMode, approvals: billApprovals, recordedBy: bill.by || '' });
              // In dual mode the recorder may not approve their OWN bill (separation of duties). The engine
              // ignores a self-approval regardless; this disables the control so the steward is not misled.
              const iRecorded = billApprovalMode === 'dual' && me && me === (bill.by || '').toLowerCase();
              const total = F.billTotal(bill);
              return (
                <div key={bill.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>Bill{bill.number ? ' ' + bill.number : ''}{bill.supplier ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {bill.supplier}</span> : null}{badge(status)}{approved ? <span data-bill-approved="1" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--sage, #4f7a5e)', border: '1px solid var(--line)', borderRadius: 7, padding: '2px 8px', marginLeft: 6 }}>approved</span> : null}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{booksFmt(total, book)}{bill.received ? ' · received ' + bill.received : ''}{bill.due ? ' · due ' + bill.due : ''}</div>
                  </div>
                  {!approved && status !== 'paid' && <button onClick={() => { approveBill(bill).then(ok => setBillFlash(ok ? 'Approved.' : 'That didn’t approve — your church’s relay refused or did not answer.')); }} disabled={bookErrors.length > 0 || iRecorded} title={iRecorded ? 'You recorded this bill — another finance steward must approve it (dual control)' : 'Approve this bill so it can be paid (finance stewards only)'} style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: (bookErrors.length || iRecorded) ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)', opacity: (bookErrors.length || iRecorded) ? 0.5 : 1 }}>Approve</button>}
                  {status !== 'paid' && <button onClick={() => { payBill(bill).then(ok => setBillFlash(ok ? 'Marked paid.' : 'That didn’t post — the bill must be approved first, or the relay refused.')); }} disabled={!approved || bookErrors.length > 0} title={approved ? 'Record payment in full (dr payables / cr bank)' : 'Approve the bill first — an unapproved bill cannot be paid'} style={{ border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', borderRadius: 8, padding: '4px 12px', cursor: (!approved || bookErrors.length) ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 12, opacity: (!approved || bookErrors.length) ? 0.5 : 1 }}>Mark paid</button>}
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => setBudgetOpen(r => !r)} title="Show or hide your annual budget and how spending compares to it" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16, color: 'var(--ink)', padding: 0 }}>{budgetOpen ? '▾' : '▸'} Budget</button>
          {budgetOpen && <button onClick={() => setBudgetEditing({ id: budgetForFy && budgetForFy.id, year: fyYear, lines: (budgetForFy && budgetForFy.lines) || [] })} title="Set or change this year's budget" style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>Edit budget</button>}
        </div>
        {budgetOpen && (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 8 }}>Year to date {fyYear} — a plan for information only; it never posts to your ledger.</div>
            <BooksBudgetReport book={book} F={F} budget={budgetForFy} from={fyStart} to={booksTodayISO()} />
          </div>
        )}
      </div>

      <BooksGiftAidPanel book={book} F={F} donors={donorMap} giftAidOn={giftAidOn} onExport={(claim) => {
        // CSV formula-injection guard, same as exportCsv / exportReportCsv — a donor name/postcode is free text.
        const csvCell = c => { let s = String(c == null ? '' : c); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
        const sym = CCY_SYM[book.baseCurrency] || book.baseCurrency;
        const div = Math.pow(10, book.decimals || 2);
        const money = m => (m / div).toFixed(book.decimals || 2);
        const rows = [['Title', 'First name', 'Last name', 'House', 'Postcode', 'Donated (' + sym + ')', 'Gift Aid (' + sym + ')'],
          ...claim.rows.map(r => [r.title, r.firstName || r.name, r.lastName, r.house, r.postcode, money(r.donated), money(r.giftAid)]),
          ['', '', '', '', 'TOTAL', money(claim.totalDonated), money(claim.totalGiftAid)]];
        booksDownload('gift-aid-claim-' + booksTodayISO() + '.csv', rows.map(r => r.map(csvCell).join(',')).join('\n')).then(m => setRptFlash(m)).catch(() => {});
      }} />

      <div style={{ border: '1px dashed var(--line)', borderRadius: 14, padding: 16, color: 'var(--ink-3)', fontSize: 13.5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="gift" size={17} color="var(--clay)" />
        <div><b style={{ color: 'var(--ink)' }}>Coming soon — all free &amp; open:</b> bills &amp; approvals, invoicing, multi-currency, and more regional giving-relief packs.</div>
      </div>

      {recording && <BooksRecord book={book} onRecord={record} donors={donors} initial={recording && recording.initial} onClose={() => setRecording(false)} />}
      {importing && <FinanceImport book={book} F={F} onPost={importStatement} onClose={() => setImporting(false)} />}
      {viewingAtt ? <BooksReceiptView data={viewingAtt} onClose={() => setViewingAtt('')} /> : null}
      {accEditing && <BooksAccountEdit book={book} initial={accEditing} onSave={saveAccount} onClose={() => setAccEditing(null)} />}
      {fundEditing && <BooksFundEdit book={book} initial={fundEditing} onSave={saveFund} onClose={() => setFundEditing(null)} />}
      {moving && <BooksFundMove book={book} onTransfer={transferFunds} onClose={() => setMoving(false)} />}
      {donate && <BooksDonate onGave={() => { booksDonateGave(); setDonate(false); }} onClose={() => setDonate(false)} />}
      {sharing && <FinanceShareStatement book={book} F={F} churchName={church.name || ''} accent={church.accent || ''} logo={church.picture || ''} canPost={canPost} onPostToMembers={postStatementToMembers} onClose={() => setSharing(false)} />}
      {reconciling && <FinanceReconcile book={book} F={F} today={booksTodayISO()} saved={reconciling && reconciling.id ? reconciles.find(r => r.id === reconciling.id) : reconciling} onSaveReconcile={saveReconcile} onClose={() => setReconciling(null)} />}
      {tplEditing && <BooksTemplateEdit book={book} initial={tplEditing} onSave={saveTemplate} onClose={() => setTplEditing(null)} />}
      {donorEditing && <BooksDonor book={book} initial={donorEditing} onSave={saveDonor} onClose={() => setDonorEditing(null)} />}
      {contactEditing && <BooksContact initial={contactEditing} onSave={saveContact} onClose={() => setContactEditing(null)} />}
      {invEditing && <BooksInvoiceEdit book={book} contacts={contacts} onIssue={issueInvoice} onClose={() => setInvEditing(null)} />}
      {billEditing && <BooksBillEdit book={book} contacts={contacts} onSave={recordBill} onClose={() => setBillEditing(null)} />}
      {budgetEditing && <BooksBudgetEdit book={book} initial={budgetEditing} onSave={saveBudget} onClose={() => setBudgetEditing(null)} />}
    </div>
  );
}
window.DashFinance = DashFinance;
