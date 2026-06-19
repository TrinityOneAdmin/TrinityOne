// steward-finance.src.js — TrinityOne's optional Finance module (bundled → vendor/steward-finance.js).
//
// A treasurer's ledger: record giving, keep Gift-Aid-ready donor records, categorise funds, export CSV.
// IMPORTANT: this is the one part of TrinityOne that deals in identified people + financial data — the
// opposite of the anonymity-first core. So every record is stored NIP-44-ENCRYPTED to the church's own
// key (via window.Steward.encPublish/encSubscribe): the relay only ever sees ciphertext, and only the
// church key (held in Keykeeper on the steward's device) can read it. This module never touches the raw
// key — it talks only to those primitives. Off by default; a treasurer turns it on.
//
// Exposes window.StewardFinance.

(function () {
  const S = () => window.Steward;
  const PFX = 'trinityone/fin-';
  const SETTINGS_D = PFX + 'settings';            // single doc: { enabled, baseCurrency }
  const DONOR_D = PFX + 'donor:';                 // + donorId
  const TX_D = PFX + 'tx:';                       // + txId
  const FUND_D = PFX + 'fund:';                   // + fundId

  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };

  // ---- bank-statement import helpers (all client-side; no data leaves the device unencrypted) ----
  const normRef = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parseAmount = (s) => { const n = parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  function parseDate(s) {
    s = String(s || '').trim(); if (!s) return '';
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) { let d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0'), y = m[3]; if (y.length === 2) y = '20' + y; return y + '-' + mo + '-' + d; }
    const mon = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/))) { const mm = mon[m[2].toLowerCase()]; if (mm) return m[3] + '-' + mm + '-' + m[1].padStart(2, '0'); }
    const d = new Date(s); return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  // RFC-4180-ish CSV parser (handles quotes, embedded commas/newlines) → { header:[], rows:[[…]] }
  function parseCsv(text) {
    const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const out = []; let row = [], cur = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); out.push(row); }
    const rows = out.filter(r => r.some(c => String(c).trim() !== ''));
    return { header: rows[0] || [], rows: rows.slice(1) };
  }
  // best guess at which columns are which, from the header names
  function guessMapping(header) {
    const H = (header || []).map(h => normRef(h));
    const find = (...keys) => { for (let i = 0; i < H.length; i++) if (keys.some(k => H[i].includes(k))) return i; return -1; };
    const date = find('date');
    const moneyIn = find('money in', 'paid in', 'credit', 'amount in', 'receipt');
    const amount = moneyIn < 0 ? find('amount', 'value') : -1;
    const ref = find('reference', 'description', 'details', 'narrative', 'payee', 'memo', 'transaction', 'name');
    return { date: date < 0 ? 0 : date, amount, moneyIn, ref: ref < 0 ? Math.max(0, (header || []).length - 1) : ref };
  }
  // guess which columns hold donor details in a migration export (ChurchSuite / Breeze / Planning Center)
  function guessDonorMapping(header) {
    const H = (header || []).map(h => normRef(h));
    const find = (...keys) => { for (let i = 0; i < H.length; i++) if (keys.some(k => H[i].includes(k))) return i; return -1; };
    return {
      name: find('full name', 'display name', 'donor name', 'contact name'),
      first: find('first', 'forename', 'given'),
      last: find('last', 'surname', 'family name'),
      address: find('address', 'street'),
      postcode: find('postcode', 'post code', 'postal', 'zip'),
      email: find('email', 'e mail'),
      giftAid: find('gift aid', 'giftaid'),
    };
  }
  const importKeyOf = (date, amount, ref) => date + '|' + num(amount).toFixed(2) + '|' + normRef(ref).slice(0, 40);
  // turn parsed CSV + a column mapping into credit rows (money IN only) ready to review
  function buildRows(parsed, mapping) {
    const rows = [];
    for (const r of (parsed.rows || [])) {
      const date = parseDate(r[mapping.date] || '') || new Date().toISOString().slice(0, 10);
      const amount = mapping.moneyIn >= 0 ? parseAmount(r[mapping.moneyIn]) : parseAmount(r[mapping.amount]);
      const ref = String(r[mapping.ref] || '').trim();
      if (!(amount > 0)) continue;   // credits only — money coming in
      rows.push({ date, amount, ref, importKey: importKeyOf(date, amount, ref) });
    }
    return rows;
  }
  // match a statement line to a donor: first by a learned bank reference, then by the donor's name
  function matchDonor(text, donors) {
    const n = normRef(text); if (!n) return null;
    for (const d of donors || []) for (const r of (d.bankRefs || [])) if (r && n.includes(r)) return { donorId: d.id, by: 'ref' };
    for (const d of donors || []) {
      const dn = normRef(d.name); if (!dn) continue;
      if (n.includes(dn)) return { donorId: d.id, by: 'name' };
      const p = dn.split(' '), last = p[p.length - 1], first = p[0];
      if (p.length >= 2 && last.length >= 3 && n.includes(last) && first && n.includes(first[0])) return { donorId: d.id, by: 'name' };
    }
    return null;
  }
  const existingImportKeys = (txs) => new Set((txs || []).map(t => t.importKey).filter(Boolean));

  // ---- settings / enable ----
  // The enabled flag also gates the "Finance" sidebar item. Reading it from the (encrypted) relay doc
  // takes a round-trip, which made the tab pop in a beat late. So we mirror just the boolean in
  // localStorage (per church) and paint it instantly, then reconcile with the relay value.
  const enKey = () => 'trinityone.fin.enabled.' + ((S() && S().churchPub) || '');
  function cachedEnabled() { try { return localStorage.getItem(enKey()) === '1'; } catch { return false; } }
  function subscribeSettings(cb) {
    if (!S() || !S().encSubscribe) { cb({ enabled: false }); return () => {}; }
    cb({ enabled: cachedEnabled() });   // instant paint from cache — no relay wait for the nav item
    return S().encSubscribe(SETTINGS_D, (items) => {
      // SETTINGS_D has no suffix, so the single doc lands with id === '' — pick it (or defaults)
      const doc = items.find(x => x.id === '') || items[0] || {};
      try { localStorage.setItem(enKey(), doc.enabled ? '1' : '0'); } catch {}
      cb({ enabled: !!doc.enabled, baseCurrency: doc.baseCurrency || 'GBP', giftAid: !!doc.giftAid });
    });
  }
  // opts: { baseCurrency, giftAid }. Gift Aid is the optional UK add-on, off by default — the core
  // ledger (donor records, funds, statements) is nationality-agnostic.
  function setEnabled(on, opts) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    opts = opts || {};
    try { localStorage.setItem(enKey(), on ? '1' : '0'); } catch {}   // cache immediately so it persists for next load
    return S().encPublish(SETTINGS_D, { enabled: !!on, baseCurrency: opts.baseCurrency || 'GBP', giftAid: !!opts.giftAid, updated: Math.floor(Date.now() / 1000) });
  }

  // ---- donors (PII: name, address, Gift Aid declaration) ----
  // shape: { id, name, address, postcode, email, memberPub, giftAid:{declared:bool, date}, note }
  function subscribeDonors(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(DONOR_D, (items) => cb(items.sort((a, b) => (a.name || '').localeCompare(b.name || ''))));
  }
  function saveDonor(d) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    const id = d.id || uid('d');
    const nm = (d.name || '').trim();
    // structured name for an HMRC claim — default-split the display name if not given explicitly
    const parts = nm.split(/\s+/);
    const firstName = (d.firstName || parts[0] || '').trim();
    const lastName = (d.lastName != null ? d.lastName : (parts.length > 1 ? parts.slice(1).join(' ') : '')).trim();
    const rec = {
      name: nm,
      title: (d.title || '').trim(),
      firstName, lastName,
      house: (d.house || '').trim(),     // HMRC: house name or number (taken from the address)
      address: (d.address || '').trim(),
      postcode: (d.postcode || '').trim().toUpperCase(),
      email: (d.email || '').trim(),
      memberPub: d.memberPub || '',
      // bankRefs: the text that appears on this donor's bank deposits (a reference they quote, or how
      // their name shows on a standing order). Used to auto-match imported statement lines; the console
      // learns a new one each time the treasurer confirms a match. Stored normalised.
      bankRefs: [...new Set((d.bankRefs || []).map(normRef).filter(Boolean))],
      giftAid: d.giftAid && d.giftAid.declared
        ? { declared: true, date: d.giftAid.date || new Date().toISOString().slice(0, 10) }
        : { declared: false },
      note: (d.note || '').trim(),
    };
    return S().encPublish(DONOR_D + id, rec).then(() => ({ id, ...rec }));
  }
  function removeDonor(id) { return (S() && S().encRemove) ? S().encRemove(DONOR_D + id) : Promise.resolve(null); }

  // ---- funds (categories: General, Building, Missions…) ----
  function subscribeFunds(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(FUND_D, (items) => cb(items.sort((a, b) => (a.name || '').localeCompare(b.name || ''))));
  }
  function saveFund(f) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    const id = f.id || uid('f');
    const rec = { name: (f.name || '').trim() || 'General' };
    return S().encPublish(FUND_D + id, rec).then(() => ({ id, ...rec }));
  }
  function removeFund(id) { return (S() && S().encRemove) ? S().encRemove(FUND_D + id) : Promise.resolve(null); }

  // ---- transactions (the ledger) ----
  // shape: { id, date(YYYY-MM-DD), amount(number), currency, method, fundId, donorId, giftAid:bool, note }
  // method: 'lightning' | 'cash' | 'bank' | 'card' | 'other'
  function subscribeTx(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(TX_D, (items) => cb(items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.ts || 0) - (a.ts || 0))));
  }
  function saveTx(t) {
    if (!S() || !S().encPublish) return Promise.resolve(null);
    const id = t.id || uid('t');
    const rec = {
      date: t.date || new Date().toISOString().slice(0, 10),
      amount: num(t.amount),
      currency: t.currency || 'GBP',
      method: t.method || 'cash',
      fundId: t.fundId || '',
      donorId: t.donorId || '',
      giftAid: !!t.giftAid,
      note: (t.note || '').trim(),
      importKey: t.importKey || '',   // set on bank-statement import to de-dupe re-imports of the same line
      claimId: t.claimId || '',       // set when this donation has been included in a Gift Aid claim (won't be re-claimed)
    };
    return S().encPublish(TX_D + id, rec).then(() => ({ id, ...rec }));
  }
  function removeTx(id) { return (S() && S().encRemove) ? S().encRemove(TX_D + id) : Promise.resolve(null); }

  // ---- reporting ----
  // Gift Aid: HMRC lets a charity reclaim basic-rate tax (25p per £1) on eligible donations from UK
  // taxpayers who've made a declaration. Eligible here = a GBP donation, flagged giftAid, from a donor
  // whose record carries a declaration. (This is a *records* aid, not an HMRC submission — that's later.)
  function giftAidSummary(txs, donors) {
    const decl = new Set((donors || []).filter(d => d.giftAid && d.giftAid.declared).map(d => d.id));
    let eligible = 0, count = 0;
    for (const t of txs || []) {
      if (t.giftAid && (t.currency || 'GBP') === 'GBP' && t.donorId && decl.has(t.donorId)) { eligible += num(t.amount); count++; }
    }
    return { eligibleTotal: eligible, reclaimable: Math.round(eligible * 0.25 * 100) / 100, count };
  }

  const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\r\n');

  // full ledger as CSV (all giving)
  function exportLedgerCsv(txs, donors, funds) {
    const dById = Object.fromEntries((donors || []).map(d => [d.id, d]));
    const fById = Object.fromEntries((funds || []).map(f => [f.id, f]));
    const head = ['Date', 'Donor', 'Amount', 'Currency', 'Method', 'Fund', 'Gift Aid', 'Note'];
    const rows = (txs || []).map(t => [
      t.date, (dById[t.donorId] && dById[t.donorId].name) || 'Anonymous', num(t.amount).toFixed(2),
      t.currency || 'GBP', t.method || '', (fById[t.fundId] && fById[t.fundId].name) || '',
      t.giftAid ? 'Yes' : 'No', t.note || '',
    ]);
    return csv([head, ...rows]);
  }
  // Gift-Aid schedule CSV — the donor + donation rows a claim is built from (declared donors, GBP, flagged)
  function exportGiftAidCsv(txs, donors) {
    const dById = Object.fromEntries((donors || []).map(d => [d.id, d]));
    const decl = new Set((donors || []).filter(d => d.giftAid && d.giftAid.declared).map(d => d.id));
    const head = ['Donor name', 'Address', 'Postcode', 'Donation date', 'Amount (GBP)'];
    const rows = (txs || [])
      .filter(t => t.giftAid && (t.currency || 'GBP') === 'GBP' && t.donorId && decl.has(t.donorId))
      .map(t => { const d = dById[t.donorId] || {}; return [d.name || '', d.address || '', d.postcode || '', t.date, num(t.amount).toFixed(2)]; });
    return csv([head, ...rows]);
  }
  // Year-end giving statements — a printable page with one statement per donor who gave in `year`:
  // itemised gifts + total + Gift-Aid note + the church's name. The treasurer prints / saves as PDF / emails.
  function exportStatementsHtml(year, txs, donors, funds, churchName) {
    const fById = Object.fromEntries((funds || []).map(f => [f.id, f]));
    const dById = Object.fromEntries((donors || []).map(d => [d.id, d]));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const money = (n) => '£' + num(n).toFixed(2);
    const yr = String(year);
    const byDonor = new Map();
    for (const t of txs || []) {
      if (!t.donorId || String(t.date || '').slice(0, 4) !== yr) continue;
      if (!byDonor.has(t.donorId)) byDonor.set(t.donorId, []);
      byDonor.get(t.donorId).push(t);
    }
    const sections = [...byDonor.entries()]
      .map(([id, gifts]) => ({ d: dById[id] || { name: 'Donor' }, gifts: gifts.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))) }))
      .sort((a, b) => (a.d.name || '').localeCompare(b.d.name || ''))
      .map(({ d, gifts }) => {
        const total = gifts.reduce((s, t) => s + num(t.amount), 0);
        const ga = gifts.filter(t => t.giftAid).reduce((s, t) => s + num(t.amount), 0);
        const rows = gifts.map(t => `<tr><td>${esc(t.date)}</td><td>${esc((fById[t.fundId] && fById[t.fundId].name) || 'General')}</td><td>${esc(t.method || '')}</td><td class="r">${money(t.amount)}</td></tr>`).join('');
        return `<section class="stmt"><h2>${esc(churchName || 'Our Church')}</h2><div class="sub">Giving statement · ${esc(yr)}</div>`
          + `<div class="to"><b>${esc(d.name || '')}</b>${d.address ? '<br>' + esc(d.address) : ''}${d.postcode ? '<br>' + esc(d.postcode) : ''}</div>`
          + `<table><thead><tr><th>Date</th><th>Fund</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody>`
          + `<tfoot><tr><td colspan="3"><b>Total for ${esc(yr)}</b></td><td class="r"><b>${money(total)}</b></td></tr></tfoot></table>`
          + (d.giftAid && d.giftAid.declared
            ? `<p class="ga">Gift Aid declaration on file${d.giftAid.date ? ' (since ' + esc(d.giftAid.date) + ')' : ''}. Gift-Aided giving this year: <b>${money(ga)}</b>.</p>`
            : `<p class="ga muted">No Gift Aid declaration on file.</p>`)
          + `<p class="thx">Thank you for your generous giving. Please keep this statement for your records.</p></section>`;
      }).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Giving statements ${esc(yr)}</title><style>`
      + `body{font-family:Georgia,'Times New Roman',serif;color:#1b1714;max-width:720px;margin:0 auto;padding:24px}`
      + `.bar{font-family:system-ui,sans-serif;background:#f4efe6;border:1px solid #e6ddcb;border-radius:10px;padding:12px 14px;margin-bottom:20px;font-size:13px;color:#5b5345;display:flex;align-items:center;gap:12px}`
      + `.bar button{font:inherit;background:#8a6717;color:#fff;border:none;border-radius:8px;padding:7px 13px;cursor:pointer;font-weight:700}`
      + `.stmt{page-break-after:always;border-bottom:1px dashed #ccc;padding-bottom:28px;margin-bottom:28px}.stmt:last-child{border:none}`
      + `h2{margin:0;font-size:22px}.sub{color:#777;font-size:13px;font-family:system-ui,sans-serif}.to{margin:14px 0 10px;font-size:15px;line-height:1.5}`
      + `table{width:100%;border-collapse:collapse;font-size:14px;font-family:system-ui,sans-serif}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}.r{text-align:right}tfoot td{border-top:2px solid #333;border-bottom:none}`
      + `.ga{font-family:system-ui,sans-serif;font-size:13px;color:#345c41}.muted{color:#999}.thx{font-style:italic;color:#555;font-size:13.5px}@media print{.bar{display:none}}`
      + `</style></head><body><div class="bar"><span>${byDonor.size} statement${byDonor.size === 1 ? '' : 's'} for ${esc(yr)}.</span><button onclick="window.print()">Print / Save as PDF</button></div>`
      + (sections || `<p>No donor-attributed giving recorded for ${esc(yr)}.</p>`)
      + `</body></html>`;
  }

  // ---- HMRC Gift Aid claim pipeline ----
  // A claim = the eligible, not-yet-claimed donations in a date range, joined to donor PII, validated to
  // HMRC's rules, formatted to the Charities Online schedule, then marked claimed so they're never
  // double-counted. The final upload happens on gov.uk with the charity's Government Gateway login.
  const CLAIM_D = PFX + 'claim:';
  const ukDate = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (m[3] + '/' + m[2] + '/' + m[1].slice(2)) : ''; };

  // eligible donations for a claim: GBP, gift-aid flagged, donor declared, not already in a claim, in range
  function eligibleForClaim(txs, donors, range) {
    const dById = Object.fromEntries((donors || []).map(d => [d.id, d]));
    const from = (range && range.from) || '', to = (range && range.to) || '';
    return (txs || [])
      .filter(t => t.giftAid && (t.currency || 'GBP') === 'GBP' && t.donorId && !t.claimId && dById[t.donorId] && dById[t.donorId].giftAid && dById[t.donorId].giftAid.declared)
      .filter(t => (!from || t.date >= from) && (!to || t.date <= to))
      .map(t => ({ tx: t, donor: dById[t.donorId] }))
      .sort((a, b) => (a.tx.date || '').localeCompare(b.tx.date || ''));
  }
  // HMRC requires: a last name, a house name/number, a postcode, a date and an amount per row
  function validateClaimRow(donor, tx) {
    const problems = [];
    if (!(donor.lastName || '').trim()) problems.push('last name');
    if (!(donor.house || '').trim()) problems.push('house name/number');
    if (!(donor.postcode || '').trim()) problems.push('postcode');
    if (!/^\d{4}-\d{2}-\d{2}/.test(tx.date || '')) problems.push('donation date');
    if (!(num(tx.amount) > 0)) problems.push('amount');
    return problems;
  }
  function claimSummary(eligible) {
    let total = 0, bad = 0; const donors = new Set();
    for (const { donor, tx } of eligible) { total += num(tx.amount); donors.add(donor.id); if (validateClaimRow(donor, tx).length) bad++; }
    return { total, reclaimable: Math.round(total * 0.25 * 100) / 100, donations: eligible.length, donors: donors.size, invalid: bad };
  }
  // the HMRC "Schedule spreadsheet for Gift Aid donations" columns, in order. Paste under the headers of
  // HMRC's official template, then upload via Charities Online. (Title is optional; Sponsored event = No.)
  function exportHmrcCsv(eligible) {
    const head = ['Title', 'First name', 'Last name', 'House name or number', 'Postcode', 'Aggregated donations', 'Sponsored event', 'Donation date', 'Amount'];
    const rows = (eligible || []).map(({ donor, tx }) => [
      donor.title || '', donor.firstName || '', donor.lastName || '', donor.house || '', (donor.postcode || '').toUpperCase(),
      '', 'No', ukDate(tx.date), num(tx.amount).toFixed(2),
    ]);
    return csv([head, ...rows]);
  }
  // record a claim batch + stamp each donation with the claimId so it can't be claimed twice
  async function recordClaim(eligible, range) {
    if (!S() || !S().encPublish) return null;
    const id = uid('c');
    const sum = claimSummary(eligible);
    await S().encPublish(CLAIM_D + id, { date: new Date().toISOString().slice(0, 10), from: (range && range.from) || '', to: (range && range.to) || '', total: sum.total, reclaimable: sum.reclaimable, donations: sum.donations, donors: sum.donors });
    for (const { tx } of eligible) await saveTx({ ...tx, claimId: id });
    return { id, ...sum };
  }
  function subscribeClaims(cb) {
    if (!S() || !S().encSubscribe) { cb([]); return () => {}; }
    return S().encSubscribe(CLAIM_D, (items) => cb(items.sort((a, b) => (b.date || '').localeCompare(a.date || ''))));
  }

  window.StewardFinance = {
    subscribeSettings, setEnabled, cachedEnabled,
    subscribeDonors, saveDonor, removeDonor,
    subscribeFunds, saveFund, removeFund,
    subscribeTx, saveTx, removeTx,
    giftAidSummary, exportLedgerCsv, exportGiftAidCsv, exportStatementsHtml,
    // bank-statement import
    parseCsv, guessMapping, guessDonorMapping, buildRows, matchDonor, existingImportKeys, normRef,
    // Gift Aid claim pipeline
    eligibleForClaim, validateClaimRow, claimSummary, exportHmrcCsv, recordClaim, subscribeClaims,
  };
})();
