// DOES A CARE REQUEST'S THREAD NEED A STEWARD'S EYES? Asked once, here.
//
// Sim item 24 (SIM-VERIFY-2026-10-02), and two owner decisions of the same day:
//   "closed care threads come back when the person writes again" and
//   "a message in a set-up or closed care thread counts on the steward's Overview banner as needing attention".
//
// THE DEFECT: the console listed a request only while its status was 'open'. "Set up help" (or closing it) writes
// a status document, the request left the list, and with it went the only "Message" button the thread had — so a
// member who went on writing in that thread was heard by nobody. The member's phone showed the conversation as
// live; the steward's console had no door to it.
//
// THE RULE, in the words of the decision: a request needs attention when it is OPEN, or when it was set up or
// closed and the person has WRITTEN SINCE — and nobody on the team has answered that message.
//   · `statusTs`  — when the status document was written (unix seconds). 0 for a request nobody has acted on.
//   · `askerAt`   — the newest message the ASKER wrote in the thread, 0 if none.
//   · `teamAt`    — the newest message anybody ELSE wrote in the thread, 0 if none.
// "Answered" is part of the rule on purpose: without it a returned thread could never leave the list except by
// the person falling silent, and a steward who has replied would be shown the same row again.
//
// STRICTLY LATER, never equal: a message and a status stamped in the same second are treated as "the status came
// last". It errs towards NOT nagging, and a person who writes again an instant later comes straight back.
//
// ⚠ THE STAMPS ARE EACH WRITER'S OWN CLOCK (a phone's for the asker, the console's for the status). A phone whose
// clock runs behind can write a message that looks older than the status it follows. That is the parked
// "one universal clock fix" (memory: clock-issues-need-one-universal-fix); it is not worked around here.
//
// PURE, and shared by every place that asks: the console's list (app/stew-meals.jsx), its Overview banner
// (app/stew-dashboard.jsx), both fed by subscribeCareRequests in src/steward-meals.src.js.
export function careThreadAttention({ status, statusTs, askerAt, teamAt }) {
  const st = String(status || 'open');
  if (st === 'open') return { needs: true, returned: false };
  const returned = Number(askerAt) > Number(statusTs || 0) && Number(askerAt) > Number(teamAt || 0);
  return { needs: returned, returned };
}
