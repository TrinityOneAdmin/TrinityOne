// ONE COPY, BOTH BUNDLES. The member app and the steward console are built separately and share no local
// modules, so this logic would otherwise exist twice and drift — which is the same disease it was written to
// cure. Imported by src/fellowship.src.js (what the congregation sees) and src/steward.src.js (where the
// writes come from). Both surfaces MUST agree, or the people editing a rota see a different one from the
// people serving on it.

// ── which write wins when two people publish the same church document ────────────────────────────────────
// LAST WRITER WINS IS NOT A RULE HERE, IT IS AN ACCIDENT OF NETWORK ORDER.
//
// A church document keyed by id — a service, a rota, a roster, a run sheet, an event — may legitimately be
// written by more than one trusted author: the church key itself, and any steward it has empowered. These are
// addressable events, so the relay keeps ONE per author; it cannot collapse two authors into one. That leaves
// the choice to the client, and the client was not making one.
//
// SIMULATION ROUND 9, measured on the relay and on two live phones. The vicar published a rota for one Sunday
// with ten real people on it, sealed. The churchwarden — who could not see hers — published a parallel rota
// for the same service 62 seconds later. Both valid, both authorised. The second silently replaced the first
// everywhere. Four people had already pressed "Yes, I can serve"; their acceptances published correctly and
// their phones said "No dates scheduled for you yet".
//
// EVERY AUTHOR'S COPY IS KEPT, and the winner is derived. The first version of this fix stored only the
// winner and remembered the loser's name — which read as complete and was not: a DELETE is also a write, and
// deleting the copy you are holding then left nothing at all, even though the other author's rota was still
// sitting on the relay untouched. The obvious next thing anybody does after round 9 is tidy away the
// duplicate, and that would have wiped the real rota off every phone a second time, deterministically. An
// audit found it one line above the fix. Keeping the versions is what makes a delete recoverable.
//
// The winner is the newest by its author's own clock, ties broken by the lower pubkey — arbitrary, but the
// same on every phone. This deliberately does NOT decide who OUGHT to win; the app cannot know that and both
// writes were authorised. A congregation looking at one rota and disagreeing about what it says is worse than
// looking at the wrong one together.
// `trusted` decides whether a copy may be SHOWN at all — the church key, or a steward still on the church's
// signed roster. It is asked here, while choosing, rather than afterwards.
//
// OWNER, 2026-08-27: "the church's key should be primary owner of documents like rotas. Having it tied to an
// individual user is a risk." He is right, and this is the half that can be fixed where the document is read.
// Revoking a steward used to blank every document their copy happened to win: the newest copy was chosen
// first, THEN found to be from a revoked author, and dropped — while the church's own older copy sat unused
// in this very store. Gordon steps down and every rota, room and service he last touched goes blank on every
// phone, offline too, while the console (which filters by nothing) shows the office a church in perfect
// order. Choosing among trusted copies promotes the church's instead.
//
// A copy the church solely authored through a steward has nothing to fall back to; that needs the church key
// to ADOPT these documents, which is a separate change on the writing side.
export function _pickWinner(vers, trusted) {
  let best = null;
  for (const rec of vers.values()) {
    if (rec && rec._tomb) continue;                               // a withdrawal we are remembering, not a document
    if (trusted && !trusted(rec)) continue;                       // revoked author — never the one on show
    if (!best) { best = rec; continue; }
    const a = best.ts || 0, b = rec.ts || 0;
    if (b > a || (b === a && String(rec._by || '') < String(best._by || ''))) best = rec;
  }
  return best;
}
// Recompute what the screen sees from the versions we hold. `_alt` is DERIVED, never remembered: the first
// version of this kept it as a single slot that the winner's own next edit quietly erased, and that would
// have made a future "two people published this" banner lie in exactly the situation it exists for.
export function _reduceVersions(vers, byId, id, trusted) {
  const win = _pickWinner(vers, trusted);
  if (!win) { byId.delete(id); return null; }
  // Compare by the KEY we filed it under, not by the record's field. A record restored from an old cache has
  // no author field while its key is '', so filtering on `win._by` left the winner in its own list of
  // competitors — `_alt` came back as ["", <the winner>], which is nonsense a banner would have printed.
  const winKey = String(win._by || '');
  const others = [...vers.keys()].filter(k => k !== winKey && !(vers.get(k) || {})._tomb);
  byId.set(id, others.length ? { ...win, _alt: others.slice() } : win);
  return win;
}
// PAINTING FROM CACHE MUST SEED THE STORE, NOT JUST THE SCREEN.
// Both readers paint last-known documents instantly so a page does not flash empty. They wrote straight into
// the display map — which was harmless when a delete was keyed on the id, and became a bug the moment a
// delete had to find the author's copy: a tombstone for something painted from cache found nothing to
// withdraw and was ignored, so a group or rota deleted while you were away stayed on screen for ever.
//
// A cache written before this shipped has no author recorded. Those are seeded under '' and _forgetById
// treats an unknown author as bound by anybody's delete — which is exactly the old behaviour, so upgrading
// does not strand old entries.
export function _seedFromCache(versions, byId, items, trusted) {
  for (const it of (items || [])) {
    if (!it || it.id == null) continue;
    if (it._by) {
      // We know whose copy this is, so it can take part in the rule like any other write.
      let vers = versions.get(it.id); if (!vers) { vers = new Map(); versions.set(it.id, vers); }
      vers.set(String(it._by), it);
      _reduceVersions(vers, byId, it.id, trusted);
    } else {
      // AN OLD CACHE RECORDS NO AUTHOR, AND GUESSING ONE IS WORSE THAN ADMITTING WE DO NOT KNOW.
      // The first attempt filed these under '' so they could be compared like anything else. That made an
      // upgrading console strictly worse than before: an anonymous entry beat real copies on a tie (the empty
      // name sorts lowest), it invented a competitor out of itself, and — measured — a delete from the real
      // author was REFUSED whenever a second author's copy existed, which is the entire case this store was
      // written for. An upgraded console would have shown a deleted rota for ever.
      // So: paint it, and let it be superseded. The first live copy replaces it, and any delete clears it —
      // which is exactly what the old code did with these entries.
      byId.set(it.id, it);
    }
  }
}
export function _absorbById(versions, byId, id, rec, trusted) {
  let vers = versions.get(id); if (!vers) { vers = new Map(); versions.set(id, vers); }
  const by = String(rec._by || '');
  const had = vers.get(by);
  // A REMEMBERED WITHDRAWAL OUTRANKS A RE-DELIVERY AT THE SAME SECOND. `>` alone let a document whose
  // created_at equalled its own tombstone's walk back in, and a delete published in the same second as the
  // edit it removes is ordinary.
  if (had && had._tomb && (had.ts || 0) >= (rec.ts || 0)) return false;
  if (had && (had.ts || 0) > (rec.ts || 0)) return false;        // an author's own older copy, replayed late
  vers.set(by, rec);
  const win = _reduceVersions(vers, byId, id, trusted);
  return !!win && win._by === by;                                 // did THIS write become what people see?
}
// WHICH COPIES A TOMBSTONE NAMES. A delete may say, in `for` tags, whose version it means to withdraw.
// Absent — which is every tombstone written before 2026-08-28 — it means "my own", and nothing changes.
export function _tombstoneTargets(e) {
  return ((e && e.tags) || []).filter(t => t[0] === 'for').map(t => String(t[1] || '')).filter(Boolean);
}
// A DELETE BINDS ONLY ITS OWN AUTHOR'S COPY. Keyed purely on the id — which is what shipped — one steward
// tidying up their duplicate removed everybody's, including the copy they had no authority over and could not
// even see. Now it withdraws that author's version and the next-best is promoted, so the surviving rota comes
// back rather than the Sunday going blank.
//
// ...WITH ONE NAMED EXCEPTION: THE CHURCH'S OWN COPY. A delegated steward signs with their own key while
// acting in the church's context, so their delete withdrew a version that was never there — `vers.get(their
// key)` is empty, this returned false, and the church-authored group, rota or service stayed on every phone
// for ever. The console shows them the row vanish (it filters by nothing), so the steward is told it worked
// and the congregation still sees it. That is the worst shape this product has: silent, and only visible to
// somebody else.
//
// The narrow grant is deliberate. A trusted author may withdraw the CHURCH'S copy, and only the church's,
// and only when the tombstone says so in a `for` tag. It cannot name another steward's copy — that is round
// 9 exactly, one steward tidying their duplicate taking a colleague's rota with it — so the rule that fixed
// round 9 is untouched for every author but the church itself.
export function _forgetById(versions, byId, id, by, ts, trusted, opts) {
  const k0 = String(by || '');
  const cp = String((opts && opts.churchPub) || '');
  const named = (opts && opts.targets) || [];
  // WHO MAY BE SHOWN AND WHO MAY WITHDRAW ARE TWO DIFFERENT QUESTIONS, and conflating them is what the
  // 2026-08-29 audit caught. `trusted` answers the first and MUST be the same predicate this reader passes
  // to _absorbById/_seedFromCache — pass a stricter one here and a delete silently re-filters the display,
  // so the console dropped a group leader's event it had been showing a moment earlier while every phone
  // kept it. `opts.mayName` answers the second, and defaults to `trusted` only when a reader has not said
  // otherwise. Both fail closed: no predicate, no church-copy grant.
  //
  // They genuinely differ for group events: a leader the church empowered may POST one (so they must be
  // shown) and must never be able to WITHDRAW THE CHURCH'S copy of one.
  const _authority = (opts && typeof opts.mayName === 'function') ? opts.mayName : trusted;
  const mayName = typeof _authority === 'function' ? !!_authority({ _by: by }) : false;
  const keys = [k0];
  if (cp && mayName && named.some(t => t === cp) && !keys.includes(cp)) keys.push(cp);

  // A WITHDRAWAL IS REMEMBERED, NOT CONSUMED — and this is the half the first version got wrong.
  //
  // Before the `for` grant existed, forgetting was safe: a delete only ever bound its OWN author's copy, and
  // the relay keeps one event per (author, d-tag), so an author's document and that author's tombstone can
  // never both be in flight. Dropping the version was therefore final.
  //
  // The `for` grant broke that invariant. A delegated steward cannot sign as the church, so the CHURCH'S
  // copy is never retracted on the relay: the document and the tombstone now coexist for ever, and every
  // device has to re-derive the suppression from whatever order they happen to arrive in. Measured: the
  // church's copy came back on a replay, and a tombstone that arrived first never took effect at all —
  // so a rota deleted on Monday returned on Tuesday, or was gone on one phone and present on another.
  // Three routine triggers: the calendar hub replays its buffer in raw Map order, a second relay may hold
  // the document but have refused the steward's tombstone, and NIP-01's newest-first is what every relay
  // other than ours serves.
  //
  // So keep the withdrawal AS a version, under the key it binds. _pickWinner skips it, _absorbById refuses
  // to re-admit anything at or older than it, and the result no longer depends on arrival order. This is the
  // same shape as subscribeCareNeeds' `tombs` map ("so it works whichever order the events arrive in"),
  // which was already in this codebase and should have been reused the first time.
  const tomb = (k) => ({ _tomb: true, _by: k, ts: ts || 0 });

  const vers = versions.get(id);
  if (!vers) {
    // Painted from an old cache and nothing live has arrived yet: we do not know whose it is, so any delete
    // binds it — which is what the old code did, and refusing would leave it on screen for ever. Remember it
    // too, or the copy we just hid walks back in on the next replay.
    const had = byId.has(id);
    const fresh = new Map();
    for (const k of keys) fresh.set(k, tomb(k));
    versions.set(id, fresh);
    if (had) { byId.delete(id); return true; }
    return false;
  }

  let did = false;
  for (const k of keys) {
    const held = vers.get(k);
    if (held && !held._tomb && (held.ts || 0) > (ts || 0)) continue;   // a stale tombstone must not undo a newer edit
    if (held && held._tomb && (held.ts || 0) >= (ts || 0)) continue;   // we already hold a withdrawal at least this new
    if (held && !held._tomb) did = true;                               // something visible actually went
    vers.set(k, tomb(k));
  }
  _reduceVersions(vers, byId, id, trusted);
  return did;
}

// WHO IS TRUSTED CHANGES WHILE THE APP IS OPEN. A church's signed roster arrives after the documents do, and
// a steward can be revoked mid-session. Re-choose every winner when that happens, or the screen keeps showing
// a choice made under the old answer — a revoked steward's rota lingering, or the church's copy still hidden
// behind theirs long after the roster said otherwise.
export function _reduceAll(versions, byId, trusted) {
  for (const [id, vers] of versions) _reduceVersions(vers, byId, id, trusted);
}
