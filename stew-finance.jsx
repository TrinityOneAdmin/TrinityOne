// stew-finance.jsx — the optional Finance module UI (a treasurer's ledger). Exports DashFinance
// (the section) + DashFinancePanel (the enable card in Settings). All data is held encrypted to the
// church key via window.StewardFinance — the relay only ever sees ciphertext.

const FIN_METHODS = [['cash', 'Cash'], ['bank', 'Bank transfer'], ['card', 'Card'], ['lightning', 'Lightning'], ['other', 'Other']];
const FIN_CCY = [['GBP', '£ GBP'], ['sats', '⚡ sats'], ['USD', '$ USD'], ['EUR', '€ EUR']];

function finMoney(amount, currency) {
  const n = Number(amount) || 0;
  if ((currency || 'GBP') === 'GBP') return '£' + n.toFixed(2);
  if (currency === 'USD') return '$' + n.toFixed(2);
  if (currency === 'EUR') return '€' + n.toFixed(2);
  if (currency === 'sats') return n.toLocaleString('en-GB') + ' sats';
  return n.toFixed(2) + ' ' + (currency || '');
}
function finDownload(name, text, mime) {
  try {
    const blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  } catch (e) {}
}
const finFld = { width: '100%', boxSizing: 'border-box', height: 44, padding: '0 13px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--surface)', outline: 'none', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-ui)' };
const finLbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '.5px', margin: '0 0 6px' };

// ---- Settings: the opt-in enable card ----
function DashFinancePanel({ church }) {
  const s = window.useFinanceSettings ? window.useFinanceSettings() : { enabled: false };
  const on = !!s.enabled;
  const ga = !!s.giftAid;
  const setFin = (en, gift) => window.StewardFinance.setEnabled(en, { baseCurrency: s.baseCurrency, giftAid: gift });
  const toggleBtn = (active, onClick, label) => (
    <button onClick={onClick} aria-label={label} style={{ width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: active ? 'var(--sage)' : 'var(--line)', position: 'relative', transition: 'background .2s' }}>
      <span style={{ position: 'absolute', top: 3, left: active ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
    </button>
  );
  return (
    <Panel title="Finance &amp; giving records">
      <div style={{ display: 'flex', gap: 10, padding: '11px 13px', borderRadius: 12, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 26%, transparent)', marginBottom: 14 }}>
        <Icon name="lock" size={17} color="#8a6717" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>Unlike the rest of TrinityOne, this keeps <b>named, identified</b> records (donor names and giving history). Everything is <b>encrypted to your church key</b> — the relay only stores unreadable ciphertext, and only this console can open it. Use it only if you’re the treasurer and you handle this data under your church’s privacy policy.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 13, border: '1px solid var(--line)', background: on ? 'color-mix(in oklab, var(--sage) 10%, var(--surface))' : 'var(--surface-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Giving records (Finance)</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.45 }}>{on ? 'On — a “Finance” tab is in your sidebar: a treasurer’s ledger with donor records, funds and printable year-end statements.' : 'Off — turn on to keep a giving ledger, donor records and year-end statements.'}</div>
        </div>
        {toggleBtn(on, () => setFin(!on, ga), 'Toggle finance module')}
      </div>
      {on ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 13, border: '1px solid var(--line)', background: ga ? 'color-mix(in oklab, var(--sage) 10%, var(--surface))' : 'var(--surface-2)', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>UK Gift Aid <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: '#8a6717', background: 'var(--gold-tint)', borderRadius: 999, padding: '2px 8px', verticalAlign: 'middle' }}>UK only</span></div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, lineHeight: 1.45 }}>{ga ? 'On — track donor declarations, mark eligible gifts, and build the HMRC Gift Aid claim schedule.' : 'Off — turn on only if your church reclaims UK Gift Aid. Adds declarations, eligibility and the HMRC claim builder.'}</div>
          </div>
          {toggleBtn(ga, () => setFin(on, !ga), 'Toggle UK Gift Aid')}
        </div>
      ) : null}
      {ga ? <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.45 }}>Gift Aid records are a foundation for a claim, not an HMRC submission — exports can feed Xero or a future filing.</div> : null}
    </Panel>
  );
}
window.DashFinancePanel = DashFinancePanel;

// ---- the Finance section ----
function DashFinance() {
  const donors = window.useFinanceDonors ? window.useFinanceDonors() : [];
  const funds = window.useFinanceFunds ? window.useFinanceFunds() : [];
  const txs = window.useFinanceTx ? window.useFinanceTx() : [];
  const [view, setView] = React.useState('ledger');   // ledger | donors | funds
  const [txModal, setTxModal] = React.useState(null);
  const [donorModal, setDonorModal] = React.useState(null);
  const [importing, setImporting] = React.useState(false);
  const [donorImport, setDonorImport] = React.useState(false);   // migration: import a donor roster from another app's CSV
  const [newFund, setNewFund] = React.useState('');
  const F = window.StewardFinance;
  const sset = window.useFinanceSettings ? window.useFinanceSettings() : {};
  const giftAid = !!sset.giftAid;   // UK Gift Aid add-on — off by default; the core ledger is nationality-agnostic
  const cur = sset.baseCurrency || 'GBP';
  const donorById = Object.fromEntries(donors.map(d => [d.id, d]));
  const fundById = Object.fromEntries(funds.map(f => [f.id, f]));
  const ga = F ? F.giftAidSummary(txs, donors) : { eligibleTotal: 0, reclaimable: 0, count: 0 };
  // totals by currency
  const totals = {}; txs.forEach(t => { const c = t.currency || 'GBP'; totals[c] = (totals[c] || 0) + (Number(t.amount) || 0); });
  const totalLine = Object.keys(totals).length ? Object.entries(totals).map(([c, v]) => finMoney(v, c)).join(' · ') : '—';

  const addFund = () => { const n = newFund.trim(); if (n && F) { F.saveFund({ name: n }); setNewFund(''); } };
  const exportLedger = () => finDownload('trinityone-giving-' + new Date().toISOString().slice(0, 10) + '.csv', F.exportLedgerCsv(txs, donors, funds));
  const exportGiftAid = () => finDownload('trinityone-giftaid-' + new Date().toISOString().slice(0, 10) + '.csv', F.exportGiftAidCsv(txs, donors));
  const [chName, setChName] = React.useState('');
  React.useEffect(() => (window.Steward.subscribeProfile ? window.Steward.subscribeProfile(p => setChName((p && p.name) || '')) : undefined), []);
  const genStatements = () => {   // printable per-donor year-end giving statements
    const def = String(new Date().getFullYear() - 1);
    const yr = window.prompt('Year for the giving statements:', def);
    if (!yr || !/^\d{4}$/.test(yr.trim())) return;
    const html = F.exportStatementsHtml(yr.trim(), txs, donors, funds, chName || 'Our Church');
    if (window.skPrintable) window.skPrintable(html); else finDownload('giving-statements-' + yr.trim() + '.html', html);
  };

  const tab = (k, label) => (
    <button onClick={() => setView(k)} style={{ padding: '7px 13px', borderRadius: 999, border: '1px solid ' + (view === k ? 'var(--clay)' : 'var(--line)'), cursor: 'pointer', background: view === k ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'var(--surface)', color: view === k ? 'var(--clay-ink)' : 'var(--ink-2)', fontWeight: 700, fontSize: 12.5, fontFamily: 'var(--font-ui)' }}>{label}</button>
  );
  const tile = (label, value, sub, tint) => (
    <div style={{ flex: 1, minWidth: 150, padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: tint || 'var(--ink)', marginTop: 3 }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div> : null}
    </div>
  );

  return (
    <Panel title="Finance" action={<span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={() => setImporting(true)} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12.5 }}><Icon name="globe" size={14} color="currentColor" /> Import statement</button>
      <button onClick={exportLedger} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12.5 }}><Icon name="share" size={14} color="currentColor" /> Export CSV</button>
      <button onClick={() => setTxModal({})} className="sk-btn sk-btn--clay" style={{ padding: '7px 12px', fontSize: 12.5 }}><Icon name="plus" size={14} color="#fff" /> Record giving</button>
    </span>} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {tile('Total recorded', totalLine, txs.length + ' ' + (txs.length === 1 ? 'entry' : 'entries'))}
        {giftAid
          ? tile('Gift Aid eligible', finMoney(ga.eligibleTotal, cur), ga.count + ' donation' + (ga.count === 1 ? '' : 's'), 'var(--sage)')
          : tile('Donors', String(donors.length), 'on file', 'var(--sage)')}
        {giftAid
          ? tile('Reclaimable (est.)', finMoney(ga.reclaimable, cur), '25% basic-rate top-up', '#8a6717')
          : tile('Funds', String(funds.length), funds.length === 1 ? 'category' : 'categories', '#8a6717')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {tab('ledger', 'Ledger')}{tab('donors', 'Donors')}{tab('funds', 'Funds')}{giftAid ? tab('giftaid', 'Gift Aid') : null}
        {view === 'donors' ? <React.Fragment><button onClick={() => setDonorImport(true)} title="Import a donor list from your previous church software (CSV)" className="sk-btn sk-btn--ghost" style={{ padding: '6px 11px', fontSize: 12.5, marginLeft: 'auto' }}><Icon name="globe" size={13} color="currentColor" /> Import</button><button onClick={genStatements} title="Printable year-end giving statements" className="sk-btn sk-btn--ghost" style={{ padding: '6px 11px', fontSize: 12.5 }}><Icon name="share" size={13} color="currentColor" /> Statements</button><button onClick={() => setDonorModal({})} className="sk-btn sk-btn--ghost" style={{ padding: '6px 11px', fontSize: 12.5 }}><Icon name="plus" size={13} color="currentColor" /> Add donor</button></React.Fragment> : null}
        {view === 'ledger' && giftAid ? <button onClick={exportGiftAid} title="Gift Aid schedule (declared donors only)" className="sk-btn sk-btn--ghost" style={{ padding: '6px 11px', fontSize: 12.5, marginLeft: 'auto' }}><Icon name="share" size={13} color="currentColor" /> Gift Aid CSV</button> : null}
      </div>

      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {view === 'ledger' ? (
          txs.length === 0 ? <FinEmpty icon="gift" text="No giving recorded yet. Tap “Record giving” to add your first entry — cash, bank, card or Lightning." />
          : txs.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: 'color-mix(in oklab, var(--clay) 12%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="gift" size={18} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{finMoney(t.amount, t.currency)} <span style={{ fontWeight: 500, color: 'var(--ink-3)', fontSize: 12.5 }}>· {(FIN_METHODS.find(m => m[0] === t.method) || [, t.method])[1]}</span></div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.date} · {(donorById[t.donorId] && donorById[t.donorId].name) || 'Anonymous'}{t.fundId && fundById[t.fundId] ? ' · ' + fundById[t.fundId].name : ''}{t.note ? ' · ' + t.note : ''}</div>
              </div>
              {giftAid && t.giftAid ? <SkPill tint="sage">Gift Aid</SkPill> : null}
              <button onClick={() => setTxModal(t)} title="Edit" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="pen" size={14} color="currentColor" /></button>
              <button onClick={() => F.removeTx(t.id)} title="Delete" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="trash" size={14} color="currentColor" /></button>
            </div>
          ))
        ) : view === 'donors' ? (
          donors.length === 0 ? <FinEmpty icon="pray" text="No donors yet. Add a donor to attach giving to a name." />
          : donors.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{d.name || '—'}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[d.postcode, d.email].filter(Boolean).join(' · ') || 'No address on file'}</div>
              </div>
              {giftAid ? (d.giftAid && d.giftAid.declared ? <SkPill tint="sage">Gift Aid ✓</SkPill> : <SkPill tint="ink">No declaration</SkPill>) : null}
              <button onClick={() => setDonorModal(d)} title="Edit" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="pen" size={14} color="currentColor" /></button>
              <button onClick={() => F.removeDonor(d.id)} title="Delete" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name="trash" size={14} color="currentColor" /></button>
            </div>
          ))
        ) : view === 'funds' ? (
          <React.Fragment>
            <div style={{ display: 'flex', gap: 9 }}>
              <input value={newFund} onChange={e => setNewFund(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addFund(); }} placeholder="New fund — e.g. Building, Missions" style={finFld} />
              <button onClick={addFund} className="sk-btn sk-btn--clay" style={{ padding: '0 15px', fontSize: 13 }}>Add</button>
            </div>
            {funds.length === 0 ? <FinEmpty icon="sliders" text="No funds yet. Funds let you split giving by purpose (General, Building, Missions…)." />
              : funds.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <div style={{ flex: 1, fontWeight: 700, fontSize: 14.5 }}>{f.name}</div>
                  <button onClick={() => F.removeFund(f.id)} title="Delete" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={14} color="currentColor" /></button>
                </div>
              ))}
          </React.Fragment>
        ) : giftAid ? (
          <FinGiftAidClaim txs={txs} donors={donors} onEditDonor={setDonorModal} />
        ) : null}
      </div>

      {txModal ? <FinTxModal tx={txModal} donors={donors} funds={funds} onClose={() => setTxModal(null)} /> : null}
      {donorModal ? <FinDonorModal donor={donorModal} onClose={() => setDonorModal(null)} /> : null}
      {importing ? <FinImportModal txs={txs} donors={donors} funds={funds} onClose={() => setImporting(false)} /> : null}
      {donorImport ? <FinDonorImportModal donors={donors} onClose={() => setDonorImport(false)} /> : null}
    </Panel>
  );
}
window.DashFinance = DashFinance;

function FinEmpty({ icon, text }) {
  return (
    <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 24px' }}>
      <div style={{ width: 50, height: 50, borderRadius: 15, background: 'var(--surface-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><Icon name={icon} size={24} color="var(--ink-3)" /></div>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: 0, maxWidth: 340, marginLeft: 'auto', marginRight: 'auto' }}>{text}</p>
    </div>
  );
}

function FinModalShell({ title, onClose, children, onSave, saveLabel }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 26, background: 'color-mix(in oklab, var(--ink) 32%, transparent)', backdropFilter: 'blur(3px)', animation: 'lumenFade .18s ease both' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', maxHeight: '90%', display: 'flex', flexDirection: 'column', borderRadius: 22, background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'lumenScale .22s cubic-bezier(.2,.8,.3,1.1) both' }}>
        <div style={{ padding: '20px 24px 6px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19 }}>{title}</div>
        <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 24px' }}>{children}</div>
        <div style={{ display: 'flex', gap: 10, padding: '14px 24px 20px' }}>
          <button onClick={onClose} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 12 }}>Cancel</button>
          <button onClick={onSave} className="sk-btn sk-btn--clay" style={{ flex: 2, padding: 12 }}>{saveLabel || 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function FinTxModal({ tx, donors, funds, onClose }) {
  const [date, setDate] = React.useState(tx.date || new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = React.useState(tx.amount != null ? String(tx.amount) : '');
  const [currency, setCurrency] = React.useState(tx.currency || 'GBP');
  const [method, setMethod] = React.useState(tx.method || 'cash');
  const [fundId, setFundId] = React.useState(tx.fundId || '');
  const [donorId, setDonorId] = React.useState(tx.donorId || '');
  const [giftAid, setGiftAid] = React.useState(!!tx.giftAid);
  const [note, setNote] = React.useState(tx.note || '');
  const gaOn = !!(window.useFinanceSettings ? window.useFinanceSettings().giftAid : false);
  const save = () => {
    if (!(Number(amount) > 0)) return;
    window.StewardFinance.saveTx({ id: tx.id, date, amount, currency, method, fundId, donorId, giftAid, note });
    onClose();
  };
  const sel = { ...finFld, appearance: 'auto' };
  return (
    <FinModalShell title={tx.id ? 'Edit entry' : 'Record giving'} onClose={onClose} onSave={save} saveLabel={tx.id ? 'Save' : 'Add entry'}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={finLbl}>DATE</div><input type="date" value={date} onChange={e => setDate(e.target.value)} style={finFld} /></div>
        <div style={{ flex: 1 }}><div style={finLbl}>AMOUNT</div><input type="number" inputMode="decimal" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={finFld} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1 }}><div style={finLbl}>CURRENCY</div><select value={currency} onChange={e => setCurrency(e.target.value)} style={sel}>{FIN_CCY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div style={{ flex: 1 }}><div style={finLbl}>METHOD</div><select value={method} onChange={e => setMethod(e.target.value)} style={sel}>{FIN_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1 }}><div style={finLbl}>DONOR</div><select value={donorId} onChange={e => setDonorId(e.target.value)} style={sel}><option value="">Anonymous</option>{donors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div style={{ flex: 1 }}><div style={finLbl}>FUND</div><select value={fundId} onChange={e => setFundId(e.target.value)} style={sel}><option value="">General</option>{funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
      </div>
      {gaOn ? (
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '14px 0 0', cursor: 'pointer' }}>
        <input type="checkbox" checked={giftAid} onChange={e => setGiftAid(e.target.checked)} style={{ marginTop: 2 }} />
        <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}><b>Gift Aid this donation</b> — only counts toward a claim when the donor has a declaration on file and it’s a GBP gift.</span>
      </label>
      ) : null}
      <div style={{ marginTop: 12 }}><div style={finLbl}>NOTE (OPTIONAL)</div><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Sunday offering" style={finFld} /></div>
    </FinModalShell>
  );
}

function FinDonorModal({ donor, onClose }) {
  const [name, setName] = React.useState(donor.name || '');
  const [title, setTitle] = React.useState(donor.title || '');
  const [firstName, setFirstName] = React.useState(donor.firstName || '');
  const [lastName, setLastName] = React.useState(donor.lastName || '');
  const [house, setHouse] = React.useState(donor.house || '');
  const [address, setAddress] = React.useState(donor.address || '');
  const [postcode, setPostcode] = React.useState(donor.postcode || '');
  const [email, setEmail] = React.useState(donor.email || '');
  const [refs, setRefs] = React.useState((donor.bankRefs || []).join(', '));
  const [declared, setDeclared] = React.useState(!!(donor.giftAid && donor.giftAid.declared));
  const [note, setNote] = React.useState(donor.note || '');
  const gaOn = !!(window.useFinanceSettings ? window.useFinanceSettings().giftAid : false);
  const save = () => {
    if (!name.trim()) return;
    const bankRefs = refs.split(',').map(s => s.trim()).filter(Boolean);
    window.StewardFinance.saveDonor({ id: donor.id, name, title, firstName, lastName, house, address, postcode, email, note, bankRefs, giftAid: { declared, date: donor.giftAid && donor.giftAid.date } });
    onClose();
  };
  return (
    <FinModalShell title={donor.id ? 'Edit donor' : 'Add donor'} onClose={onClose} onSave={save} saveLabel={donor.id ? 'Save' : 'Add donor'}>
      <div><div style={finLbl}>FULL NAME</div><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane Smith" style={finFld} /></div>
      <div style={{ marginTop: 12 }}><div style={finLbl}>HOME ADDRESS</div><input value={address} onChange={e => setAddress(e.target.value)} placeholder="House name/number and street" style={finFld} /></div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1 }}><div style={finLbl}>POSTAL CODE</div><input value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="Postal / ZIP code" style={finFld} /></div>
        <div style={{ flex: 1 }}><div style={finLbl}>EMAIL (OPTIONAL)</div><input value={email} onChange={e => setEmail(e.target.value)} placeholder="optional" style={finFld} /></div>
      </div>
      {declared && gaOn ? (
        <div style={{ marginTop: 14, padding: '12px 13px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="shield" size={14} color="var(--sage)" /> For the HMRC Gift Aid claim</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 72 }}><div style={finLbl}>TITLE</div><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Mr" style={finFld} /></div>
            <div style={{ flex: 1 }}><div style={finLbl}>FIRST NAME</div><input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jane" style={finFld} /></div>
            <div style={{ flex: 1 }}><div style={finLbl}>LAST NAME</div><input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Smith" style={finFld} /></div>
          </div>
          <div style={{ marginTop: 10 }}><div style={finLbl}>HOUSE NAME OR NUMBER</div><input value={house} onChange={e => setHouse(e.target.value)} placeholder="e.g. 12 or Rose Cottage" style={finFld} /></div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 7, lineHeight: 1.4 }}>HMRC needs a last name, house name/number and postcode for each claimed donor. Blank fields are flagged in the claim builder. (Left blank, first/last name are split from the full name.)</div>
        </div>
      ) : null}
      <div style={{ marginTop: 12 }}><div style={finLbl}>BANK REFERENCE(S)</div><input value={refs} onChange={e => setRefs(e.target.value)} placeholder="e.g. their name as it shows on transfers, or a giving code" style={finFld} /><div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.4 }}>How this donor appears on bank deposits — used to auto-match imported statements. The console also learns this automatically when you confirm a match. Separate several with commas.</div></div>
      {gaOn ? (
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '16px 0 0', cursor: 'pointer' }}>
        <input type="checkbox" checked={declared} onChange={e => setDeclared(e.target.checked)} style={{ marginTop: 2 }} />
        <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}><b>Gift Aid declaration on file</b> — this donor has confirmed they’re a UK taxpayer and want Gift Aid claimed on their giving. Keep the signed/recorded declaration with your church records.</span>
      </label>
      ) : null}
      <div style={{ marginTop: 12 }}><div style={finLbl}>NOTE (OPTIONAL)</div><input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" style={finFld} /></div>
      <div style={{ display: 'flex', gap: 9, padding: '11px 12px', borderRadius: 11, background: 'color-mix(in oklab, var(--gold) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--gold) 24%, transparent)', marginTop: 14 }}>
        <Icon name="lock" size={15} color="#8a6717" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>Stored encrypted to your church key. Hold this personal data under your church’s privacy policy.</div>
      </div>
    </FinModalShell>
  );
}

// ---- bank statement import: upload → map columns → review auto-matched donors → bulk import ----
function FinImportModal({ txs, donors, funds, onClose }) {
  const F = window.StewardFinance;
  const [step, setStep] = React.useState('upload');   // upload | review
  const [parsed, setParsed] = React.useState(null);
  const [mapping, setMapping] = React.useState({ date: 0, amount: 1, ref: 2 });
  const cur = (window.useFinanceSettings ? window.useFinanceSettings().baseCurrency : '') || 'GBP';
  const gaOn = !!(window.useFinanceSettings ? window.useFinanceSettings().giftAid : false);
  const [over, setOver] = React.useState({});         // importKey → { donorId, giftAid, skip }
  const [fundId, setFundId] = React.useState('');
  const [err, setErr] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const donorById = Object.fromEntries(donors.map(d => [d.id, d]));
  const existing = F ? F.existingImportKeys(txs) : new Set();

  const ingest = (text, nm) => {
    try {
      const p = F.parseCsv(text);
      if (!p.rows.length) { setErr('That file has no rows I can read. Is it a CSV statement?'); return; }
      const g = F.guessMapping(p.header);
      setParsed(p); setFileName(nm || ''); setErr('');
      setMapping({ date: g.date, amount: g.moneyIn >= 0 ? g.moneyIn : g.amount, ref: g.ref });
      setOver({}); setStep('review');
    } catch (e) { setErr('Couldn’t read that file.'); }
  };
  const onFile = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => ingest(String(r.result || ''), f.name); r.readAsText(f); };

  // build the credit rows from the current mapping, attach auto-match + dedupe + any manual override
  const rows = React.useMemo(() => {
    if (!parsed) return [];
    const built = F.buildRows(parsed, { date: mapping.date, amount: mapping.amount, moneyIn: -1, ref: mapping.ref });
    return built.map(r => {
      const auto = F.matchDonor(r.ref, donors);
      const o = over[r.importKey] || {};
      const donorId = o.donorId != null ? o.donorId : (auto ? auto.donorId : '');
      const d = donorById[donorId];
      const giftAid = o.giftAid != null ? o.giftAid : !!(d && d.giftAid && d.giftAid.declared);
      const dup = existing.has(r.importKey);
      const skip = o.skip != null ? o.skip : dup;
      return { ...r, donorId, giftAid, skip, dup, auto: auto ? auto.by : '' };
    });
  }, [parsed, mapping, over, donors, txs]);

  const setRow = (key, patch) => setOver(o => ({ ...o, [key]: { ...o[key], ...patch } }));
  const toImport = rows.filter(r => !r.skip);

  const doImport = async () => {
    const learn = {};   // donorId → Set(new normalised refs)
    for (const r of toImport) {
      await F.saveTx({ date: r.date, amount: r.amount, currency: cur, method: 'bank', fundId, donorId: r.donorId, giftAid: r.giftAid, note: r.ref, importKey: r.importKey });
      if (r.donorId) { const nr = F.normRef(r.ref); const d = donorById[r.donorId]; if (nr && d && !(d.bankRefs || []).includes(nr)) (learn[r.donorId] = learn[r.donorId] || new Set()).add(nr); }
    }
    for (const id of Object.keys(learn)) { const d = donorById[id]; if (d) await F.saveDonor({ ...d, bankRefs: [...(d.bankRefs || []), ...learn[id]] }); }
    onClose();
  };

  const colSel = (val, onCh) => (
    <select value={val} onChange={e => onCh(Number(e.target.value))} style={{ ...finFld, height: 38, appearance: 'auto' }}>
      {(parsed ? parsed.header : []).map((h, i) => <option key={i} value={i}>{h || ('Column ' + (i + 1))}</option>)}
    </select>
  );

  return (
    <FinModalShell title="Import a bank statement" onClose={onClose} onSave={step === 'review' ? doImport : null} saveLabel={'Import ' + toImport.length + ' ' + (toImport.length === 1 ? 'entry' : 'entries')}>
      {step === 'upload' ? (
        <React.Fragment>
          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 14px' }}>Download a <b>CSV statement</b> from your bank and drop it in. It’s read here on your device — only the giving (money in) is imported, matched to donors, and stored encrypted. Card/cash lines you can still add by hand.</p>
          <label style={{ display: 'block', border: '2px dashed var(--line)', borderRadius: 14, padding: '26px 18px', textAlign: 'center', cursor: 'pointer', background: 'var(--surface-2)' }}>
            <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} style={{ display: 'none' }} />
            <Icon name="globe" size={26} color="var(--ink-3)" />
            <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 8 }}>Choose a CSV statement</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>Most banks: Statements → Download → CSV</div>
          </label>
          {err ? <div style={{ fontSize: 13, color: 'var(--clay-ink)', marginTop: 12 }}>{err}</div> : null}
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 8 }}>{fileName ? fileName + ' · ' : ''}tell me which columns are which:</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}><div style={finLbl}>DATE</div>{colSel(mapping.date, v => setMapping(m => ({ ...m, date: v })))}</div>
            <div style={{ flex: 1 }}><div style={finLbl}>MONEY IN</div>{colSel(mapping.amount, v => setMapping(m => ({ ...m, amount: v })))}</div>
            <div style={{ flex: 1 }}><div style={finLbl}>REFERENCE / NAME</div>{colSel(mapping.ref, v => setMapping(m => ({ ...m, ref: v })))}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}><b>{toImport.length}</b> to import{rows.length - toImport.length ? ' · ' + (rows.length - toImport.length) + ' skipped' : ''}</div>
            <select value={fundId} onChange={e => setFundId(e.target.value)} style={{ ...finFld, height: 36, width: 'auto', marginLeft: 'auto', appearance: 'auto' }}><option value="">General fund</option>{funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </div>
          {rows.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '18px 0' }}>No money-in rows found — check the “Money in” column is right.</div> : (
            <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: '42vh', overflowY: 'auto' }}>
              {rows.map(r => (
                <div key={r.importKey} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 10, background: r.skip ? 'var(--surface-2)' : 'var(--surface)', border: '1px solid var(--line)', opacity: r.skip ? 0.55 : 1 }}>
                  <div style={{ width: 96, flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{finMoney(r.amount, 'GBP')}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.date}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.ref}>{r.ref || '—'}</div>
                    <select value={r.donorId} onChange={e => setRow(r.importKey, { donorId: e.target.value })} style={{ ...finFld, height: 32, fontSize: 12.5, marginTop: 3, appearance: 'auto' }}>
                      <option value="">Anonymous</option>
                      {donors.map(d => <option key={d.id} value={d.id}>{d.name}{gaOn && d.giftAid && d.giftAid.declared ? ' (Gift Aid)' : ''}</option>)}
                    </select>
                  </div>
                  {r.auto && r.donorId ? <span title={r.auto === 'ref' ? 'matched by reference' : 'matched by name'} style={{ flexShrink: 0 }}><SkPill tint="sage">{r.auto === 'ref' ? 'ref' : 'name'}</SkPill></span> : null}
                  {r.dup ? <span title="already imported" style={{ flexShrink: 0 }}><SkPill tint="ink">seen</SkPill></span> : null}
                  {gaOn ? <label title="Gift Aid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--ink-2)', flexShrink: 0, cursor: 'pointer' }}><input type="checkbox" checked={r.giftAid} onChange={e => setRow(r.importKey, { giftAid: e.target.checked })} /> GA</label> : null}
                  <button onClick={() => setRow(r.importKey, { skip: !r.skip })} title={r.skip ? 'Include' : 'Skip'} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name={r.skip ? 'plus' : 'x'} size={13} color="currentColor" /></button>
                </div>
              ))}
            </div>
          )}
        </React.Fragment>
      )}
    </FinModalShell>
  );
}

// ---- migration: import a donor roster (names, addresses, Gift-Aid) from another church app's CSV export ----
function FinDonorImportModal({ donors, onClose }) {
  const F = window.StewardFinance;
  const [step, setStep] = React.useState('upload');
  const [parsed, setParsed] = React.useState(null);
  const gaOn = !!(window.useFinanceSettings ? window.useFinanceSettings().giftAid : false);
  const [map, setMap] = React.useState({ name: -1, first: -1, last: -1, address: -1, postcode: -1, email: -1, giftAid: -1 });
  const [skip, setSkip] = React.useState({});
  const [err, setErr] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const existingNames = new Set((donors || []).map(d => (d.name || '').toLowerCase().trim()).filter(Boolean));
  const ingest = (text, nm) => {
    try {
      const p = F.parseCsv(text);
      if (!p.rows.length) { setErr('That file has no rows I can read. Is it a CSV?'); return; }
      setParsed(p); setFileName(nm || ''); setErr(''); setMap(F.guessDonorMapping(p.header)); setSkip({}); setStep('review');
    } catch (e) { setErr('Couldn’t read that file.'); }
  };
  const onFile = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => ingest(String(r.result || ''), f.name); r.readAsText(f); };
  const col = (i, row) => (i >= 0 && row[i] != null) ? String(row[i]).trim() : '';
  const rows = React.useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.map((row, i) => {
      const nm = col(map.name, row) || [col(map.first, row), col(map.last, row)].filter(Boolean).join(' ');
      const ga = col(map.giftAid, row).toLowerCase();
      return { i, name: nm, address: col(map.address, row), postcode: col(map.postcode, row), email: col(map.email, row), giftAid: /^(y|t|1|✓|declared|on)/.test(ga), dup: existingNames.has(nm.toLowerCase()) };
    });
  }, [parsed, map]);
  const isSkip = (r) => (skip[r.i] != null ? skip[r.i] : (!r.name || r.dup));
  const toImport = rows.filter(r => !isSkip(r));
  const doImport = async () => {
    for (const r of toImport) await F.saveDonor({ name: r.name, address: r.address, postcode: r.postcode, email: r.email, giftAid: { declared: r.giftAid, date: r.giftAid ? new Date().toISOString().slice(0, 10) : '' } });
    onClose();
  };
  const sel = (val, onCh) => (
    <select value={val} onChange={e => onCh(Number(e.target.value))} style={{ ...finFld, height: 36, appearance: 'auto' }}>
      <option value={-1}>(none)</option>
      {(parsed ? parsed.header : []).map((h, i) => <option key={i} value={i}>{h || ('Column ' + (i + 1))}</option>)}
    </select>
  );
  return (
    <FinModalShell title="Import donors" onClose={onClose} onSave={step === 'review' ? doImport : null} saveLabel={'Import ' + toImport.length + ' donor' + (toImport.length === 1 ? '' : 's')}>
      {step === 'upload' ? (
        <React.Fragment>
          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 14px' }}>Moving from another church platform? Export your <b>donors / contacts</b> as a CSV and drop it in — names, addresses and postal codes come straight over. It’s read on your device and stored <b>encrypted to your church key</b>.</p>
          <label style={{ display: 'block', border: '2px dashed var(--line)', borderRadius: 14, padding: '26px 18px', textAlign: 'center', cursor: 'pointer', background: 'var(--surface-2)' }}>
            <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} style={{ display: 'none' }} />
            <Icon name="users" size={26} color="var(--ink-3)" />
            <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 8 }}>Choose a CSV of donors</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>People / Contacts / Donors → Export → CSV</div>
          </label>
          {err ? <div style={{ fontSize: 13, color: 'var(--clay-ink)', marginTop: 12 }}>{err}</div> : null}
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 8 }}>{fileName ? fileName + ' · ' : ''}match the columns:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
            <div><div style={finLbl}>FULL NAME</div>{sel(map.name, v => setMap(m => ({ ...m, name: v })))}</div>
            {gaOn ? <div><div style={finLbl}>GIFT AID</div>{sel(map.giftAid, v => setMap(m => ({ ...m, giftAid: v })))}</div> : null}
            <div><div style={finLbl}>FIRST NAME</div>{sel(map.first, v => setMap(m => ({ ...m, first: v })))}</div>
            <div><div style={finLbl}>LAST NAME</div>{sel(map.last, v => setMap(m => ({ ...m, last: v })))}</div>
            <div><div style={finLbl}>ADDRESS</div>{sel(map.address, v => setMap(m => ({ ...m, address: v })))}</div>
            <div><div style={finLbl}>POSTCODE</div>{sel(map.postcode, v => setMap(m => ({ ...m, postcode: v })))}</div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 10 }}>Use <b>Full name</b>, or First + Last together. <b>{toImport.length}</b> to import{rows.length - toImport.length ? ' · ' + (rows.length - toImport.length) + ' skipped (blank, or already a donor)' : ''}.</div>
          <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '38vh', overflowY: 'auto' }}>
            {rows.map(r => { const sk = isSkip(r); return (
              <div key={r.i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 10, background: sk ? 'var(--surface-2)' : 'var(--surface)', border: '1px solid var(--line)', opacity: sk ? 0.55 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || '— no name —'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[r.postcode, r.email].filter(Boolean).join(' · ') || r.address || ''}</div>
                </div>
                {gaOn && r.giftAid ? <SkPill tint="gold">Gift Aid</SkPill> : null}
                {r.dup ? <SkPill tint="ink">already a donor</SkPill> : null}
                <button onClick={() => setSkip(s => ({ ...s, [r.i]: !sk }))} title={sk ? 'Include' : 'Skip'} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', flexShrink: 0 }}><Icon name={sk ? 'plus' : 'x'} size={13} color="currentColor" /></button>
              </div>
            ); })}
          </div>
        </React.Fragment>
      )}
    </FinModalShell>
  );
}
window.FinDonorImportModal = FinDonorImportModal;

// ---- Gift Aid claim builder: pick a period, validate, generate the HMRC schedule, mark claimed ----
function finUkTaxYear(d) {
  d = d || new Date(); const y = d.getFullYear();
  const start = (d.getMonth() > 2 || (d.getMonth() === 3 && d.getDate() >= 6)) ? y : y - 1;
  return { from: start + '-04-06', to: (start + 1) + '-04-05' };
}
function FinGiftAidClaim({ txs, donors, onEditDonor }) {
  const F = window.StewardFinance;
  const claims = window.useFinanceClaims ? window.useFinanceClaims() : [];
  const ty = finUkTaxYear();
  const [from, setFrom] = React.useState(ty.from);
  const [to, setTo] = React.useState(ty.to);
  const [done, setDone] = React.useState(null);
  const donorById = Object.fromEntries(donors.map(d => [d.id, d]));
  const eligible = F ? F.eligibleForClaim(txs, donors, { from, to }) : [];
  const sum = F ? F.claimSummary(eligible) : { total: 0, reclaimable: 0, donations: 0, donors: 0, invalid: 0 };
  const exportHmrc = () => finDownload('giftaid-claim-' + (to || 'all') + '.csv', F.exportHmrcCsv(eligible));
  const markClaimed = async () => {
    if (!eligible.length) return;
    const r = await F.recordClaim(eligible, { from, to });
    setDone(r);
  };
  const dInp = { ...finFld, height: 38, width: 'auto' };
  return (
    <React.Fragment>
      <div style={{ display: 'flex', gap: 9, padding: '11px 12px', borderRadius: 12, background: 'color-mix(in oklab, var(--sage) 8%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 22%, var(--line))', marginBottom: 12 }}>
        <Icon name="shield" size={16} color="var(--sage)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>Builds a claim from eligible giving (declared donors, GBP, not already claimed). Download the schedule, paste it into <b>HMRC’s official Gift Aid spreadsheet</b>, and upload it in <b>Charities Online</b> with your church’s Government Gateway login. Marking as claimed stops those donations being counted again.</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div><div style={finLbl}>FROM</div><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={dInp} /></div>
        <div><div style={finLbl}>TO</div><input type="date" value={to} onChange={e => setTo(e.target.value)} style={dInp} /></div>
        <button onClick={() => { const t = finUkTaxYear(); setFrom(t.from); setTo(t.to); }} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12, alignSelf: 'flex-end' }}>This tax year</button>
        <button onClick={() => { setFrom(''); setTo(''); }} className="sk-btn sk-btn--ghost" style={{ padding: '7px 11px', fontSize: 12, alignSelf: 'flex-end' }}>All unclaimed</button>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 130, padding: '12px 14px', borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)' }}>Eligible giving</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21 }}>£{sum.total.toFixed(2)}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{sum.donations} from {sum.donors} donor{sum.donors === 1 ? '' : 's'}</div>
        </div>
        <div style={{ flex: 1, minWidth: 130, padding: '12px 14px', borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)' }}>You can reclaim</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, color: '#8a6717' }}>£{sum.reclaimable.toFixed(2)}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>25% basic-rate top-up</div>
        </div>
      </div>

      {sum.invalid ? <div style={{ display: 'flex', gap: 9, padding: '10px 12px', borderRadius: 11, background: 'color-mix(in oklab, var(--clay) 9%, var(--surface))', border: '1px solid color-mix(in oklab, var(--clay) 26%, var(--line))', marginBottom: 12, fontSize: 12.5, color: 'var(--ink-2)' }}><Icon name="shield" size={15} color="var(--clay)" style={{ flexShrink: 0 }} /> {sum.invalid} donation{sum.invalid === 1 ? '' : 's'} {sum.invalid === 1 ? 'is' : 'are'} missing details HMRC needs — fix the donor below, or they’ll be rejected.</div> : null}

      <div style={{ display: 'flex', gap: 9, marginBottom: 14 }}>
        <button onClick={exportHmrc} disabled={!eligible.length} className="sk-btn sk-btn--ghost" style={{ flex: 1, padding: 11, fontSize: 13.5, opacity: eligible.length ? 1 : 0.5 }}><Icon name="share" size={15} color="currentColor" /> Download HMRC schedule</button>
        <button onClick={markClaimed} disabled={!eligible.length} className="sk-btn sk-btn--clay" style={{ flex: 1, padding: 11, fontSize: 13.5, opacity: eligible.length ? 1 : 0.5 }}><Icon name="check" size={15} color="#fff" /> Mark as claimed</button>
      </div>

      {done ? <div style={{ padding: '11px 13px', borderRadius: 11, background: 'color-mix(in oklab, var(--sage) 10%, var(--surface))', border: '1px solid color-mix(in oklab, var(--sage) 28%, transparent)', marginBottom: 14, fontSize: 13, color: 'var(--ink-2)' }}><b>Claim recorded</b> — {done.donations} donations, £{done.reclaimable.toFixed(2)} to reclaim. Those gifts won’t be offered again.</div> : null}

      <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {eligible.length === 0 ? <FinEmpty icon="gift" text="No eligible giving in this period. Gift-Aid a donation (in the ledger) and give the donor a declaration to include them here." />
          : eligible.map(({ tx, donor }) => {
            const probs = F.validateClaimRow(donor, tx);
            return (
              <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid ' + (probs.length ? 'color-mix(in oklab, var(--clay) 30%, var(--line))' : 'var(--line)') }}>
                <div style={{ width: 84, flexShrink: 0 }}><div style={{ fontWeight: 700, fontSize: 13.5 }}>£{Number(tx.amount).toFixed(2)}</div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{tx.date}</div></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{donor.name}</div>
                  {probs.length ? <div style={{ fontSize: 11.5, color: 'var(--clay-ink)' }}>missing: {probs.join(', ')}</div> : <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{donor.postcode}</div>}
                </div>
                {probs.length ? <button onClick={() => onEditDonor(donor)} className="sk-btn sk-btn--ghost" style={{ padding: '5px 10px', fontSize: 12, flexShrink: 0 }}>Fix</button> : <SkPill tint="sage">ready</SkPill>}
              </div>
            );
          })}
      </div>

      {claims.length ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--ink-3)', marginBottom: 8 }}>Claims history</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {claims.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <Icon name="check" size={15} color="var(--sage)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13 }}>£{Number(c.reclaimable || 0).toFixed(2)} reclaimed</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{c.date} · {c.donations} donations{c.from ? ' · ' + c.from + '→' + c.to : ''}</div></div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </React.Fragment>
  );
}
