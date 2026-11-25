// THE STEWARD-ROSTER READ, LIFTED FROM THE SHIPPED BUNDLE, FOR SCREEN TESTS. Not a test: imported by
// scripts/finance-post-to-members-needs-content.test.mjs and scripts/finance-app-shows-only-the-books.test.mjs.
//
// What a delegate's console knows about its own capabilities comes from ONE engine path: subscribeStewards reads the
// church's steward roster, sets _stewardCaps, and hands the screens a list stamped (_stampFor) with a token that only a
// settled fresh read marks genuine; myStewardCaps() answers from _stewardCaps; listIsFresh(list) answers from the
// stamp. T1Finance audit F3 found a screen trusting the EMPTY end-of-stored-events delivery (oneose) as "roster
// known". So the screens' tests drive the REAL functions, out of vendor/steward.js under their bundle names, with only
// the network replaced: `relay.event(e)` delivers a roster event, `relay.eose()` the end of stored events, and
// `relay.settle()` the fresh read's genuine settle (_freshDocRead's onFresh).
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const fn = (name) => fnBody(VENDOR, VENDOR.indexOf('\n  function ' + name + '(') + 3, name);
const method = (sig, name) => 'function ' + fnBody(VENDOR, VENDOR.indexOf('\n    ' + sig) + 5, name);
const SRC = [fn('_listTag'), fn('_stampFor'), fn('_freshTok'), fn('_tokIsFresh'), fn('_listIsFresh'), fn('_capsOf'),
  method('subscribeStewards(onList) {', 'subscribeStewards'), method('myStewardCaps() {', 'myStewardCaps')].join('\n');

export const STEWARDS_D = 'trinityone/stewards:';

// actingChurch: the church a delegate acts for ('' = the church key's own console); pub: the church being read (in
// delegated mode the engine's `pub` IS that church); churchPub: this console's own key (what the roster grants caps to).
export function rosterEngine({ actingChurch, pub, churchPub }) {
  const relay = { handlers: null, onFresh: null };
  const make = new Function('H', `
    let actingChurch = ${JSON.stringify(actingChurch)}, pub = ${JSON.stringify(pub)}, churchPub = ${JSON.stringify(churchPub)}, _keyReadEpoch = 0;
    let _stewardCaps = {}, _stewardNames = {}, _stewardNamesCt = '', _stewardSince = {};
    let _careRoster = new Set(), _careRosterKnown = false, _careRosterSeen = false;
    const STEWARDS_D = ${JSON.stringify(STEWARDS_D)}, NET = 'trinityone';
    const _authFuture = () => false, _byChurch = (e) => e.pubkey === pub, _openChurchDoc = () => null;
    const _stewardRosterChanged = () => {}, _webQueueSync = () => {}, _keysReadSignal = () => {}, _isRelayAuthed = () => false;
    const _justRemoved = new Map(), _dropJustRemoved = (list) => list;
    const relays = () => ['wss://relay.example'];
    const pool = { subscribeMany: (_r, _f, h) => { H.handlers = h; return { close() {} }; } };
    const _freshDocRead = (_cp, _ds, _onev, onFresh) => { H.onFresh = onFresh; return () => {}; };
    ${SRC}
    return { subscribeStewards, myStewardCaps, listIsFresh: _listIsFresh };`);
  const api = make(relay);
  return {
    ...api,
    relay: {
      event: (e) => relay.handlers.onevent(e),
      eose: () => relay.handlers.oneose(),
      settle: () => relay.onFresh('eose'),
    },
  };
}

// a church-signed roster event as the relay would deliver it (only the fields subscribeStewards reads)
export function rosterEvent(church, pubkeys, caps, at = 1795000000) {
  const doc = { pubkeys };
  if (caps) doc.caps = caps;
  return { kind: 30078, pubkey: church, created_at: at, tags: [['d', STEWARDS_D + church], ['t', 'trinityone']], content: JSON.stringify(doc) };
}
