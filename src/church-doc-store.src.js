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
export function _pickWinner(vers) {
  let best = null;
  for (const rec of vers.values()) {
    if (!best) { best = rec; continue; }
    const a = best.ts || 0, b = rec.ts || 0;
    if (b > a || (b === a && String(rec._by || '') < String(best._by || ''))) best = rec;
  }
  return best;
}
// Recompute what the screen sees from the versions we hold. `_alt` is DERIVED, never remembered: the first
// version of this kept it as a single slot that the winner's own next edit quietly erased, and that would
// have made a future "two people published this" banner lie in exactly the situation it exists for.
export function _reduceVersions(vers, byId, id) {
  const win = _pickWinner(vers);
  if (!win) { byId.delete(id); return null; }
  const others = [...vers.keys()].filter(k => k !== win._by);
  byId.set(id, others.length ? { ...win, _alt: others.slice() } : win);
  return win;
}
export function _absorbById(versions, byId, id, rec) {
  let vers = versions.get(id); if (!vers) { vers = new Map(); versions.set(id, vers); }
  const by = String(rec._by || '');
  const had = vers.get(by);
  if (had && (had.ts || 0) > (rec.ts || 0)) return false;        // an author's own older copy, replayed late
  vers.set(by, rec);
  const win = _reduceVersions(vers, byId, id);
  return !!win && win._by === by;                                 // did THIS write become what people see?
}
// A DELETE BINDS ONLY ITS OWN AUTHOR'S COPY. Keyed purely on the id — which is what shipped — one steward
// tidying up their duplicate removed everybody's, including the copy they had no authority over and could not
// even see. Now it withdraws that author's version and the next-best is promoted, so the surviving rota comes
// back rather than the Sunday going blank.
export function _forgetById(versions, byId, id, by, ts) {
  const vers = versions.get(id); if (!vers) return false;
  const k = String(by || '');
  const had = vers.get(k);
  if (!had) return false;                                         // nothing of theirs to withdraw
  if ((had.ts || 0) > (ts || 0)) return false;                    // a stale tombstone must not undo a newer edit
  vers.delete(k);
  if (!vers.size) versions.delete(id);
  _reduceVersions(vers, byId, id);
  return true;
}
