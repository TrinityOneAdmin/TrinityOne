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
const DONATE_LS = 'trinityone.books.donateHiddenUntil';
const DONATE = {
  ln: 'donate@trinityone.church',        // TODO(owner): real Lightning address / LNURL for donations
  alt: 'https://strike.me/trinityone',   // TODO(owner): real Strike (or other gateway) donation link — '' to hide
  suggest: ['£5', '£10', '£25'],
  hideDays: 90,
};
let _booksDonateShown = false;           // once per app session
function booksDonateHiddenUntil() { try { return parseInt(localStorage.getItem(DONATE_LS) || '0', 10) || 0; } catch (e) { return 0; } }
function booksDonateGave() { try { localStorage.setItem(DONATE_LS, String(Date.now() + DONATE.hideDays * 864e5)); } catch (e) {} }

function booksFresh() {
  const F = window.FinanceLedger;
  const b = F.createBook({ baseCurrency: 'GBP', decimals: 2 });
  [['bank', '1000', 'Bank / cash', 'asset'],
   ['giving', '4000', 'Giving & offerings', 'income'],
   ['other-income', '4900', 'Other income', 'income'],
   ['utilities', '5000', 'Utilities', 'expense'],
   ['outreach', '5100', 'Outreach & mission', 'expense'],
   ['building', '5200', 'Building & upkeep', 'expense'],
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
  if (id.startsWith('account:')) return { t: 'account', id: id.slice(8), code: it.code, name: it.name, type: it.type };
  if (id.startsWith('fund:')) return { t: 'fund', id: id.slice(5), name: it.name, kind: it.kind };
  if (id.startsWith('journal:')) return { t: 'journal', seq: it.seq, date: it.date, memo: it.memo, postings: it.postings, by: it.by, ts: it.ts, reverses: it.reverses, importKey: it.importKey ?? null };
  return null;
}
function booksDownload(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  } catch (e) {}
}
function booksTodayISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function booksFmt(minor, book) {
  const dec = book.decimals || 2, sym = CCY_SYM[book.baseCurrency] || '';
  const s = (minor / Math.pow(10, dec)).toLocaleString('en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return book.baseCurrency === 'sats' ? (s + ' ' + sym) : (sym + s);
}
function booksParse(str, book) {
  const dec = book.decimals || 2, n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return (!isFinite(n) || n <= 0) ? 0 : Math.round(n * Math.pow(10, dec));
}
function booksEntryView(book, e) {
  const other = e.postings.find(p => { const a = book.accounts.get(p.account); return a && (a.type === 'income' || a.type === 'expense'); }) || e.postings[0];
  const a = book.accounts.get(other.account);
  return { date: e.date, memo: e.memo, category: a ? a.name : other.account, fund: other.fund, amount: other.amount, inflow: !!(a && a.type === 'income'), reversed: e.reverses != null };
}

const bkFld = { width: '100%', boxSizing: 'border-box', height: 44, padding: '0 13px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
const bkLbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 6px', display: 'block', textTransform: 'uppercase' };
const bkCard = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 18 };

// ---- record a transaction (guided double-entry — the treasurer never sees "debit/credit") ----
function BooksRecord({ book, onRecord, onClose }) {
  const [dir, setDir] = React.useState('in');
  const cats = [...book.accounts.values()].filter(a => a.type === (dir === 'in' ? 'income' : 'expense'));
  const funds = [...book.funds.values()];
  const [account, setAccount] = React.useState(cats[0] ? cats[0].id : '');
  const [fund, setFund] = React.useState('general');
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState(booksTodayISO());
  const [memo, setMemo] = React.useState('');
  const [err, setErr] = React.useState('');
  React.useEffect(() => { const c = [...book.accounts.values()].filter(a => a.type === (dir === 'in' ? 'income' : 'expense')); setAccount(c[0] ? c[0].id : ''); }, [dir]);
  const submit = () => {
    const minor = booksParse(amount, book);
    if (!minor) return setErr('Enter an amount greater than zero.');
    if (!account) return setErr('Pick a category.');
    try { onRecord({ dir, account, fund, amountMinor: minor, date, memo: memo.trim() }); onClose(); }
    catch (e) { setErr(e.message || 'Could not record that.'); }
  };
  const seg = (v, label) => (
    <button onClick={() => setDir(v)} style={{ flex: 1, height: 42, border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 14,
      background: dir === v ? (v === 'in' ? 'var(--sage, #6b9b7a)' : 'var(--clay)') : 'transparent', color: dir === v ? '#fff' : 'var(--ink-3)' }}>{label}</button>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }} onClick={onClose}>
      <div style={{ ...bkCard, width: 420, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 14px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>Record a transaction</h3>
        <div style={{ display: 'flex', gap: 6, background: 'var(--surface-2, #f2efe9)', borderRadius: 12, padding: 4, marginBottom: 14 }}>{seg('in', 'Money in')}{seg('out', 'Money out')}</div>
        <label style={bkLbl}>Category</label>
        <select value={account} onChange={e => setAccount(e.target.value)} style={{ ...bkFld, marginBottom: 12 }}>{cats.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <label style={bkLbl}>Fund</label>
        <select value={fund} onChange={e => setFund(e.target.value)} style={{ ...bkFld, marginBottom: 12 }}>{funds.map(f => <option key={f.id} value={f.id}>{f.name}{f.kind === 'restricted' ? ' (restricted)' : ''}</option>)}</select>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label style={bkLbl}>Amount ({CCY_SYM[book.baseCurrency] || book.baseCurrency})</label><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" style={bkFld} /></div>
          <div style={{ flex: 1 }}><label style={bkLbl}>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={bkFld} /></div>
        </div>
        <label style={bkLbl}>Note (optional)</label>
        <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="e.g. Sunday offering" style={{ ...bkFld, marginBottom: 8 }} />
        {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
          <button onClick={submit} style={{ flex: 2, height: 44, border: 'none', background: 'var(--clay)', color: '#fff', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Record</button>
        </div>
      </div>
    </div>
  );
}

// ---- the "support TrinityOne" donation nudge (shown on open; no paywall) ----
function BooksDonate({ onGave, onClose }) {
  const [copied, setCopied] = React.useState(false);
  const copyLn = () => { try { navigator.clipboard.writeText(DONATE.ln); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch (e) {} };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }} onClick={onClose}>
      <div style={{ ...bkCard, width: 400, maxWidth: '100%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}><Icon name="gift" size={20} color="var(--clay)" /><h3 style={{ margin: 0, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>Keep TrinityOne going</h3></div>
        <p style={{ color: 'var(--ink)', fontSize: 14, lineHeight: 1.5, margin: '0 0 14px' }}>TrinityOne is free and open — no fees, no lock-in, and your books are always yours. If your church is able, a gift helps cover the shared relays and keep the tools growing. Thank you. 🙏</p>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>{DONATE.suggest.map(a => <span key={a} style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '5px 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-3)' }}>{a}</span>)}<span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>or any amount</span></div>
        <a href={'lightning:' + DONATE.ln} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, borderRadius: 12, background: 'var(--clay)', color: '#fff', textDecoration: 'none', fontFamily: 'var(--font-ui)', fontWeight: 800, marginBottom: 8 }}>⚡ Give with Lightning</a>
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
  const incomeAccts = [...book.accounts.values()].filter(a => a.type === 'income');
  const expenseAccts = [...book.accounts.values()].filter(a => a.type === 'expense');
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
    const already = F.importedKeys(book);
    const rs = ls.map(l => {
      const sug = F.suggestCategory(l, []);
      const account = (sug && book.accounts.get(sug.account)) ? sug.account : defAccount(l.dir);
      const fund = (sug && sug.fund && book.funds.has(sug.fund)) ? sug.fund : 'general';
      const dup = already.has(l.key);
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

  const doPost = () => {
    const picks = [];
    lines.forEach((l, i) => { const r = rowState[i]; if (r.selected && !r.dup) picks.push({ line: l, account: r.account, fund: r.fund }); });
    if (!picks.length) { setErr('Select at least one transaction to import.'); return; }
    onPost(picks); onClose();
  };

  const colSelect = (val, onChange, allowNone) => (
    <select value={val} onChange={e => onChange(parseInt(e.target.value, 10))} style={bkFld}>
      {allowNone && <option value={-1}>— none —</option>}
      {parsed.header.map((h, i) => <option key={i} value={i}>{String(h).trim() || ('Column ' + (i + 1))}</option>)}
    </select>
  );
  const seg = (v, label) => (
    <button onClick={() => setMapping(m => ({ ...m, mode: v }))} style={{ flex: 1, height: 38, border: 'none', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 13,
      background: mapping.mode === v ? 'var(--clay)' : 'transparent', color: mapping.mode === v ? '#fff' : 'var(--ink-3)' }}>{label}</button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,28,.44)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 62, padding: 16 }} onClick={onClose}>
      <div style={{ ...bkCard, width: step === 'review' ? 640 : 460, maxWidth: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 19 }}>Import a bank statement</h3>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5, marginBottom: 14 }}>{step === 'upload' ? 'Upload a CSV your bank exported, then confirm the columns.' : 'Check each line, pick a category, then post.'}</div>

        {step === 'upload' && (
          <div style={{ overflow: 'auto' }}>
            <label style={bkLbl}>Statement file (CSV)</label>
            <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ ...bkFld, height: 'auto', padding: 9, marginBottom: 14, lineHeight: 1.4 }} />
            {parsed && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div><label style={bkLbl}>Date column</label>{colSelect(mapping.date, v => setMapping(m => ({ ...m, date: v })))}</div>
                <div><label style={bkLbl}>Description column</label>{colSelect(mapping.description, v => setMapping(m => ({ ...m, description: v })))}</div>
                <div style={{ gridColumn: '1 / span 2' }}>
                  <label style={bkLbl}>Amount columns</label>
                  <div style={{ display: 'flex', gap: 6, background: 'var(--surface-2, #f2efe9)', borderRadius: 10, padding: 4, marginBottom: 8 }}>{seg('single', 'One signed column')}{seg('split', 'Separate in / out')}</div>
                </div>
                {mapping.mode === 'single'
                  ? <div style={{ gridColumn: '1 / span 2' }}><label style={bkLbl}>Amount column (+ in / − out)</label>{colSelect(mapping.amount, v => setMapping(m => ({ ...m, amount: v })))}</div>
                  : (<>
                      <div><label style={bkLbl}>Money in column</label>{colSelect(mapping.moneyIn, v => setMapping(m => ({ ...m, moneyIn: v })), true)}</div>
                      <div><label style={bkLbl}>Money out column</label>{colSelect(mapping.moneyOut, v => setMapping(m => ({ ...m, moneyOut: v })), true)}</div>
                    </>)}
                <label style={{ gridColumn: '1 / span 2', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ink)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={monthFirst} onChange={e => setMonthFirst(e.target.checked)} /> Dates are month-first (US: MM/DD/YYYY)
                </label>
              </div>
            )}
            {err && <p style={{ color: 'var(--clay-deep, #b4462f)', fontSize: 13, margin: '4px 0 0' }}>{err}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid var(--line)', background: 'transparent', borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--ink)' }}>Cancel</button>
              <button onClick={toReview} disabled={!parsed} style={{ flex: 2, height: 44, border: 'none', background: parsed ? 'var(--clay)' : 'var(--line)', color: '#fff', borderRadius: 11, cursor: parsed ? 'pointer' : 'default', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Review transactions →</button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, fontSize: 12.5, color: 'var(--ink-3)' }}>
              <span>{nSel} selected · {lines.length} found{nDup ? ' · ' + nDup + ' already imported' : ''}</span>
              <button onClick={toggleAll} style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>{allSel ? 'Deselect all' : 'Select all'}</button>
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
              <button onClick={doPost} disabled={!nSel} style={{ flex: 2, height: 44, border: 'none', background: nSel ? 'var(--clay)' : 'var(--line)', color: '#fff', borderRadius: 11, cursor: nSel ? 'pointer' : 'default', fontFamily: 'var(--font-ui)', fontWeight: 800 }}>Post {nSel} transaction{nSel === 1 ? '' : 's'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- the main screen ----
function DashFinance() {
  const F = window.FinanceLedger;
  if (!F) return <div style={{ padding: 28, color: 'var(--ink-3)' }}>Loading the ledger engine…</div>;
  const S = window.Steward;
  // Defensive: never run relay-backed Finance under a delegated steward's key — encPublish would sign/encrypt
  // with the wrong key and omit the ['church'] tag, so the relay rejects every write and the book silently
  // re-seeds empty on reload. The nav already hides Finance when acting as a delegated steward; this guards
  // any other entry (deep link, tab state). (audit 2026-07-06 #3)
  if (S && S.actingChurch) return <div style={{ padding: 28, maxWidth: 520, color: 'var(--ink-2)', lineHeight: 1.5 }}><div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Finance is on the church console</div>The books are kept on the church’s own key. Open the console with the church key to record and view finances — delegated-steward bookkeeping isn’t available yet.</div>;
  const useRelay = !!(S && S.encSubscribe && S.encPublish);   // real console w/ the church key → relay-backed; else localStorage
  const bookRef = React.useRef(null);
  if (!bookRef.current) bookRef.current = useRelay ? F.createBook({ baseCurrency: 'GBP', decimals: 2 }) : booksLoad();
  const book = bookRef.current;
  const [, setTick] = React.useState(0);
  const bump = () => setTick(t => t + 1);
  const pubEntry = (b, e) => { if (useRelay) { try { S.encPublish('finance/journal:' + e.seq, { seq: e.seq, date: e.date, memo: e.memo, postings: e.postings, by: e.by, ts: e.ts, reverses: e.reverses, importKey: e.importKey ?? null }); } catch (x) {} } else booksSave(b); };
  // relay-backed persistence: subscribe to the church's encrypted finance docs → rebuild the book; seed the
  // default chart on first use. Journal entries publish through the relay's single-writer seq guard.
  React.useEffect(() => {
    if (!useRelay) return;
    let seeded = false;
    const unsub = S.encSubscribe('finance/', items => {
      const docs = items.map(finItemToDoc).filter(Boolean);
      if (!docs.length) {
        if (seeded) return; seeded = true;
        const b = booksFresh(); bookRef.current = b; bump();
        S.encPublish('finance/settings', { baseCurrency: b.baseCurrency, decimals: b.decimals, fiscalYearStart: b.fiscalYearStart });
        for (const a of b.accounts.values()) S.encPublish('finance/account:' + a.id, { code: a.code, name: a.name, type: a.type });
        for (const f of b.funds.values()) if (f.id !== 'general') S.encPublish('finance/fund:' + f.id, { name: f.name, kind: f.kind });
        return;
      }
      const r = F.rebuildBook(docs); if (r.book) { bookRef.current = r.book; bump(); }
    });
    return unsub;
  }, []);
  const [recording, setRecording] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [reports, setReports] = React.useState(false);
  const [donate, setDonate] = React.useState(false);
  React.useEffect(() => {   // gentle donation nudge — once per session, unless hidden for ~3 months after giving
    if (_booksDonateShown || Date.now() < booksDonateHiddenUntil()) return;
    _booksDonateShown = true; setDonate(true);
  }, []);

  const record = ({ dir, account, fund, amountMinor, date, memo }) => {
    const b = bookRef.current;
    const P = dir === 'in'
      ? [{ account: 'bank', dir: 'dr', amount: amountMinor }, { account, fund, dir: 'cr', amount: amountMinor }]
      : [{ account, fund, dir: 'dr', amount: amountMinor }, { account: 'bank', dir: 'cr', amount: amountMinor }];
    const entry = F.post(b, { date, memo, postings: P }); pubEntry(b, entry); bump();
  };
  const undo = seq => { const b = bookRef.current; try { const rev = F.reverse(b, seq); pubEntry(b, rev); bump(); } catch (e) {} };
  // Post the lines the treasurer selected in the import modal. Each carries its statement lineKey as importKey
  // so a future re-import of the same statement is flagged as already-imported (see FinanceImport de-dup).
  const importStatement = (picks) => {
    const b = bookRef.current;
    for (const { line, account, fund } of picks) {
      const amount = line.amountMinor;
      const P = line.dir === 'in'
        ? [{ account: 'bank', dir: 'dr', amount }, { account, fund, dir: 'cr', amount }]
        : [{ account, fund, dir: 'dr', amount }, { account: 'bank', dir: 'cr', amount }];
      try { const entry = F.post(b, { date: line.date, memo: line.description, importKey: line.key, postings: P }); pubEntry(b, entry); } catch (e) {}
    }
    bump();
  };
  const funds = F.fundBalances(book);
  const ie = F.incomeExpenditure(book);
  const bank = F.trialBalance(book).rows.find(r => r.account === 'bank');
  const cash = bank ? bank.debit - bank.credit : 0;
  const recent = book.journal.slice().reverse().slice(0, 16);
  const exportCsv = () => {
    const rows = [['seq', 'date', 'memo', 'account', 'fund', 'debit', 'credit']];
    for (const e of book.journal) for (const p of e.postings) rows.push([e.seq, e.date, e.memo, (book.accounts.get(p.account) || {}).name || p.account, p.fund || '', p.dir === 'dr' ? p.amount : '', p.dir === 'cr' ? p.amount : '']);
    booksDownload('finance-' + booksTodayISO() + '.csv', rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n'));
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
          <button onClick={() => setImporting(true)} className="sk-btn" style={{ padding: '10px 16px', fontSize: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}><Icon name="receipt" size={16} color="var(--ink)" /> Import statement</button>
          <button onClick={() => setRecording(true)} className="sk-btn sk-btn--clay" style={{ padding: '10px 16px', fontSize: 14 }}><Icon name="plus" size={16} color="#fff" /> Record a transaction</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {stat('In the bank', booksFmt(cash, book))}
        {stat('Income this year', booksFmt(ie.income, book), 'var(--sage, #4f7a5e)')}
        {stat('Spending this year', booksFmt(ie.expenditure, book), 'var(--clay-deep, #b4462f)')}
        {stat('Surplus', booksFmt(ie.surplus, book), ie.surplus < 0 ? 'var(--clay-deep, #b4462f)' : 'var(--sage, #4f7a5e)')}
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
          <button onClick={exportCsv} style={{ border: '1px solid var(--line)', background: 'transparent', borderRadius: 9, padding: '6px 11px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>Export CSV</button>
        </div>
        {recent.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '10px 0' }}>No transactions yet — record your first with the button above.</div>}
        {recent.map(e => { const v = booksEntryView(book, e); return (
          <div key={e.seq} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, textDecoration: v.reversed ? 'line-through' : 'none', opacity: v.reversed ? .6 : 1 }}>{v.category}{v.memo ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {v.memo}</span> : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{v.date}{v.fund && v.fund !== 'general' ? ' · ' + ((book.funds.get(v.fund) || {}).name || v.fund) : ''}</div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 14.5, color: v.inflow ? 'var(--sage, #4f7a5e)' : 'var(--clay-deep, #b4462f)', whiteSpace: 'nowrap' }}>{v.inflow ? '+' : '−'}{booksFmt(v.amount, book)}</div>
            {!v.reversed && e.reverses == null && <button title="Reverse this entry" onClick={() => undo(e.seq)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 15, padding: 4 }}>↩</button>}
          </div>
        ); })}
      </div>

      <div style={{ ...bkCard, marginBottom: 16 }}>
        <button onClick={() => setReports(r => !r)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontFamily: 'var(--font-display, var(--font-ui))', fontSize: 16, color: 'var(--ink)', padding: 0 }}>{reports ? '▾' : '▸'} Reports</button>
        {reports && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, margin: '4px 0 6px' }}>Income &amp; Expenditure</div>
            {ie.byAccount.map(r => (
              <div key={r.account} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '3px 0' }}>
                <span>{(book.accounts.get(r.account) || {}).name || r.account}</span><span style={{ fontWeight: 700 }}>{booksFmt(Math.abs(r.amount), book)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '8px 0 0', marginTop: 6, borderTop: '1px solid var(--line)', fontWeight: 800 }}>
              <span>Surplus</span><span>{booksFmt(ie.surplus, book)}</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ border: '1px dashed var(--line)', borderRadius: 14, padding: 16, color: 'var(--ink-3)', fontSize: 13.5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="gift" size={17} color="var(--clay)" />
        <div><b style={{ color: 'var(--ink)' }}>Coming soon — all free &amp; open:</b> bank reconciliation, bills &amp; approvals, invoicing, budgets, multi-currency, a balance sheet + trustees' report, and regional giving-relief packs. TrinityOne charges nothing — <button onClick={() => setDonate(true)} style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--clay)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13.5 }}>support the project →</button></div>
      </div>

      {recording && <BooksRecord book={book} onRecord={record} onClose={() => setRecording(false)} />}
      {importing && <FinanceImport book={book} F={F} onPost={importStatement} onClose={() => setImporting(false)} />}
      {donate && <BooksDonate onGave={() => { booksDonateGave(); setDonate(false); }} onClose={() => setDonate(false)} />}
    </div>
  );
}
window.DashFinance = DashFinance;
