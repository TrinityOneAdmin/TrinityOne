// THE APP MUST NOT OVERCLAIM A PROTECTION.
// Run: node --test scripts/encryption-claims-honest.test.mjs
//
// Found by driving the real console against a real relay on 2026-08-20, not by reading code. The Kids
// check-in screen said, in the pilot build of that morning:
//
//     "Records are encrypted to your church key — only this console sees who's present."
//
// Both halves had just stopped being true. Records are sealed under the SAFEGUARDING key, and every console
// holding that capability opens them. The Finance help page and the Manna screen carried the same shape of
// claim: "encrypted to the church's own key ... only this console can open it", said of books a delegated
// treasurer can now read in full.
//
// The threat model this app is built for is lawful compulsion and device seizure, where a steward decides
// what to write down based on who they believe can read it. A sentence that overstates the protection is not
// a cosmetic error — it is the app giving bad security advice at the moment someone acts on it.
//
// So: any screen that tells a person who can read something must name a CAPABILITY, not "the church key",
// and must not claim exclusivity that delegation has removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const files = {
  'app/stew-dashboard.jsx': readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'),
  'app/help-data.jsx':      readFileSync(new URL('../app/help-data.jsx', import.meta.url), 'utf8'),
  'app/stew-manna.jsx':     readFileSync(new URL('../app/stew-manna.jsx', import.meta.url), 'utf8'),
};

test('no screen claims a delegatable record is readable by "only this console"', () => {
  for (const [name, raw] of Object.entries(files)) {
    const src = stripComments(raw);
    assert.doesNotMatch(src, /only this console (?:can open|sees)/i,
      `${name} still tells the reader that only this console can open records that a delegated steward can ` +
      'now read in full. Whoever wrote that sentence was right when they wrote it; delegation made it false, ' +
      'and nothing failed when it did.');
  }
});

test('the check-in blurb names the SAFEGUARDING key, not the church key', () => {
  const src = stripComments(files['app/stew-dashboard.jsx']);
  const note = (src.match(/Check children in and give the parent[\s\S]{0,400}?DismissibleNote>/) || [''])[0];
  assert.ok(note, 're-anchor: the kids check-in intro note is gone');
  assert.match(note, /safeguarding key/i,
    'the check-in note does not say which key seals the register, so a steward cannot tell who can read a ' +
    'child\'s name, room and pickup code');
  assert.doesNotMatch(note, /encrypted to your church key/i,
    'the check-in note still says "encrypted to your church key". It is the safeguarding key, and saying ' +
    'otherwise hides that a safeguarding delegate reads every record.');
  assert.match(note, /Safeguarding<\/b> to|given <b>Safeguarding/i,
    'the note does not tell the reader that people granted Safeguarding can open these records');
});

test('the Finance help page says a Finance grant hands over the books', () => {
  const src = stripComments(files['app/help-data.jsx']);
  const callout = (src.match(/The books are your church’s private bookkeeping[\s\S]{0,500}?'/) || [''])[0];
  assert.ok(callout, 're-anchor: the Finance books callout is gone');
  assert.match(callout, /Finance<\/b> to|given <b>Finance/i,
    'the Finance help text does not say that anyone granted Finance can read the whole ledger — which is ' +
    'exactly what granting it now does');
});

test('Manna says out loud that it shares the Finance key', () => {
  // Manna is locked off for the pilot, but its records name people the church is helping financially —
  // more sensitive than donor records, by its own module header. Anyone told "encrypted to your church key"
  // would reasonably conclude a treasurer cannot read them. A treasurer can.
  const src = stripComments(files['app/stew-manna.jsx']);
  assert.match(src, /shares the <b>Finance<\/b> key|shares the Finance key/i,
    'the Manna screen does not disclose that it rides the Finance capability key, so an owner granting ' +
    'Finance to a treasurer is also handing over every benevolence record without being told');
  assert.doesNotMatch(src, /encrypted to your church key/i,
    'Manna still claims its records are sealed to the church key alone');
});
