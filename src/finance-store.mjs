// src/finance-store.mjs — the bridge between the pure ledger (finance-ledger.mjs) and persistence.
// It turns a book into a stream of small "finance docs" (each becomes one encrypted event on the church's
// relay), and rebuilds a book from those docs arriving in ANY order — detecting forks/gaps rather than
// silently corrupting the ledger. No crypto/relay here (that wiring lives in the console); this stays pure
// so the serialize↔rebuild round-trip and the fork/gap detection can be proven in node.
//
// A doc is a plain JSON object with a `t` (type): 'settings' | 'account' | 'fund' | 'journal'.
// On the relay each becomes an addressable event, e.g. d = `finance/journal:<seq>` with an encrypted body;
// the seq lives in the (unencrypted) d-tag so the relay can order/guard it without reading the entry.

import { createBook, addAccount, addFund, applyEntry, check } from './finance-ledger.mjs';

export function bookToDocs(book) {
  const docs = [{ t: 'settings', baseCurrency: book.baseCurrency, decimals: book.decimals, fiscalYearStart: book.fiscalYearStart }];
  for (const a of book.accounts.values()) docs.push({ t: 'account', id: a.id, code: a.code, name: a.name, type: a.type });
  for (const f of book.funds.values()) if (f.id !== 'general') docs.push({ t: 'fund', id: f.id, name: f.name, kind: f.kind });   // 'general' is implicit (createBook adds it)
  for (const e of book.journal) docs.push({ t: 'journal', seq: e.seq, date: e.date, memo: e.memo, postings: e.postings, by: e.by, ts: e.ts, reverses: e.reverses, importKey: e.importKey ?? null });
  return docs;
}

export function docFor(entryOrObj, t) { return { t, ...entryOrObj }; }   // small helper for the console publish path

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
