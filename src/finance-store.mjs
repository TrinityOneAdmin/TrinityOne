// src/finance-store.mjs — the bridge between the pure ledger (finance-ledger.mjs) and persistence.
// It turns a book into a stream of small "finance docs" (each becomes one encrypted event on the church's
// relay), and rebuilds a book from those docs arriving in ANY order — detecting forks/gaps rather than
// silently corrupting the ledger. No crypto/relay here (that wiring lives in the console); this stays pure
// so the serialize↔rebuild round-trip and the fork/gap detection can be proven in node.
//
// A doc is a plain JSON object with a `t` (type): 'settings' | 'account' | 'fund' | 'journal'.
// Receipt attachments (finance/attachment:<id>) are SIDE BLOBS, not part of the book model: bookToDocs never
// emits them and rebuildBook ignores every `t` it does not recognise, so an attachment doc arriving in the
// stream leaves the ledger untouched. A journal entry only carries attachmentRefs (the ids); the image bytes
// are fetched lazily by the UI (app/stew-finance.jsx), never folded into the replayed book.
// On the relay each becomes an addressable event, e.g. d = `finance/journal:<seq>` with an encrypted body;
// the seq lives in the (unencrypted) d-tag so the relay can order/guard it without reading the entry.

import { createBook, addAccount, addFund, applyEntry, check } from './finance-ledger.mjs';

export function bookToDocs(book) {
  // `multiCurrency` (Phase 8) is OMITTED when false/absent so a silent-£ settings doc is BYTE-IDENTICAL to a
  // pre-Phase-8 one (the "existing suite unchanged" gate). rebuildBook feeds this doc straight to createBook,
  // which reads the flag back. The journal docs already carry any posting currency/origAmount/rate verbatim
  // (postings: e.postings), so no other doc shape changes.
  const docs = [{ t: 'settings', baseCurrency: book.baseCurrency, decimals: book.decimals, fiscalYearStart: book.fiscalYearStart, ...(book.multiCurrency ? { multiCurrency: true } : {}) }];
  for (const a of book.accounts.values()) docs.push({ t: 'account', id: a.id, code: a.code, name: a.name, type: a.type, archived: !!a.archived });
  for (const f of book.funds.values()) if (f.id !== 'general') docs.push({ t: 'fund', id: f.id, name: f.name, kind: f.kind });   // 'general' is implicit (createBook adds it)
  for (const e of book.journal) docs.push({ t: 'journal', seq: e.seq, date: e.date, memo: e.memo, postings: e.postings, by: e.by, ts: e.ts, reverses: e.reverses, importKey: e.importKey ?? null, attachmentRefs: e.attachmentRefs ?? [], invoice: e.invoice ?? null, bill: e.bill ?? null });
  return docs;
}

export function docFor(entryOrObj, t) { return { t, ...entryOrObj }; }   // small helper for the console publish path

// A cheap fingerprint of only the BOOK docs (settings/account/fund/journal) in a finance delivery. The console
// subscribes to the WHOLE finance/ namespace, so a delivery that changed only a SIDE doc (donor/contact/invoice/
// bill/budget/template/reconcile/attachment — every one of which rebuildBook() IGNORES) still arrives here; the
// console compares this signature across deliveries and SKIPS a full rebuildBook()+check() (several journal
// walks) when it is unchanged, because the book would rebuild identically.
//
// Soundness rests on the journal being APPEND-ONLY with IMMUTABLE entries: the relay accepts finance/journal:<seq>
// only at exactly the next seq (gateway rejects gaps, forks AND edits — scripts/gateway.mjs), a reversal APPENDS
// a new seq, and the client's dropFrom() only discards a REFUSED (never-published) tail — so no delivered journal
// doc is ever removed or re-bodied. Journal count + max seq therefore capture every journal change; the seq sum
// is folded in as well so a partial/gapped delivery that happened to share count+maxSeq still differs.
// settings/account/fund are REPLACEABLE (a rename/retype/archive changes content, not count), so their content is
// folded in full — they are few, so this stays far cheaper than the replay+check() it guards.
export function bookDocSignature(docs) {
  let jCount = 0, jMax = 0, jSum = 0;
  let settings = '';
  const accounts = [], funds = [];
  for (const d of (docs || [])) {
    if (!d) continue;
    if (d.t === 'journal') { const s = Number(d.seq) || 0; jCount++; if (s > jMax) jMax = s; jSum += s; }
    else if (d.t === 'settings') settings = JSON.stringify({ baseCurrency: d.baseCurrency, decimals: d.decimals, fiscalYearStart: d.fiscalYearStart, multiCurrency: !!d.multiCurrency });
    else if (d.t === 'account') accounts.push(d.id + '\u0000' + d.code + '\u0000' + d.name + '\u0000' + d.type + '\u0000' + (d.archived ? 1 : 0));
    else if (d.t === 'fund') funds.push(d.id + '\u0000' + d.name + '\u0000' + d.kind);
  }
  accounts.sort(); funds.sort();   // order-independent: the relay may deliver docs in any order
  return 'j' + jCount + ':' + jMax + ':' + jSum + '|s' + settings + '|a' + accounts.join('\u0001') + '|f' + funds.join('\u0001');
}

// Rebuild a book from docs in ANY order. Returns { book, ok, errors }.
// The journal is replayed in seq order; applyEntry enforces contiguity, so a GAP (missing seq) or a FORK
// (a repeated seq) surfaces as an error instead of a quietly-wrong ledger. A final check() re-proves the book.
export function rebuildBook(docs) {
  const errors = [];
  const settings = docs.find(d => d && d.t === 'settings') || {};
  const book = createBook(settings);
  for (const d of docs) if (d && d.t === 'account') { try { addAccount(book, d); } catch (e) { errors.push('account: ' + e.message); } }
  for (const d of docs) if (d && d.t === 'fund') { try { addFund(book, d); } catch (e) { errors.push('fund: ' + e.message); } }
  const journal = docs.filter(d => d && d.t === 'journal').slice().sort((a, b) => a.seq - b.seq);
  for (const j of journal) { try { applyEntry(book, j); } catch (e) { errors.push(e.message); } }
  const chk = check(book);
  return { book, ok: errors.length === 0 && chk.ok, errors: errors.concat(chk.errors) };
}
