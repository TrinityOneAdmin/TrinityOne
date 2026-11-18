// join.js — extracted from join.html so it runs under strict CSP (no inline scripts).
(function(){
  var q = new URLSearchParams(location.search);
  var follow = q.get('follow') || '';
  var name = q.get('name') || '';
  var relay = q.get('relay') || '';
  var church = q.get('c') || '';
  // THE IPHONE APP, DURING THE PILOT, COMES THROUGH APPLE'S TESTFLIGHT (public links already given to pilot
  // churches; the same links /install shows an iPhone).
  var TESTFLIGHT_APP = 'https://testflight.apple.com/join/u5CZnMp9';
  var TESTFLIGHT_STORE = 'https://apps.apple.com/app/testflight/id899247664';
  var APK = './trinityone.apk';   // SECURITY-AUDIT-2026-06-24 L12: relative path so the download resolves on whichever host served the join page (Pages, gateway, or church relay) — not pinned to the dev box's Tailnet hostname.

  // the instant path: open the web app with the join context (key minted on-device, name pre-filled, church followed)
  //
  // `index.html`, NOT `/`. JOURNEY AUDIT 2026-08-05, measured against the live hosts. Both domains serve the
  // whole repo, and they differ in exactly one place — what `/` resolves to:
  //     app.trinityone.church/  → the app        trinityone.church/  → welcome.html, the brochure
  //     app.trinityone.church/index.html → the app   trinityone.church/index.html → the app
  // joinUrl() builds the invite from `location.origin` whenever that origin is public, and the Steward console
  // is served from BOTH domains (trinityone.church/steward.html returns the console). So a steward who opens
  // the console on the marketing domain hands out https://trinityone.church/join?follow=… — and this button
  // sent the member to https://trinityone.church/?follow=…, which renders the sales page and drops the church
  // on the floor. It fails the way that costs most: the invite page says "Join <church>" and "Hi, <name>", the
  // button looks right, and tapping it silently lands them on a brochure with no error and nothing to retry.
  // index.html is the app on EVERY host by construction — marketing, app, and any church's own relay — which
  // is the same reasoning the APK path above already relies on.
  var app = 'index.html?follow=' + encodeURIComponent(follow);
  if (name)  app += '&name=' + encodeURIComponent(name);
  if (relay && /^wss:\/\//i.test(relay)) app += '&relay=' + encodeURIComponent(relay);   // SECURITY-AUDIT-2026-07-06 L9: only forward an ENCRYPTED (wss://) relay from a public join link — never a cleartext/hostile one

  // URLSearchParams.get() ALREADY percent-decodes — decoding again double-decodes (a name with a literal '%' throws;
  // encoded chars render wrong). Use the values as-is.
  if (name)   { try { document.getElementById('pill').textContent = 'Hi, ' + name; } catch(e){} }
  // NAME THE CHURCH ONLY IF IT LOOKS LIKE A NAME. `?c=` used to be printed verbatim, so a mistyped or
  // truncated link rendered "Join npub1bogus" — a raw key-shaped string shown to a member as their church's
  // name. Anything key-shaped, or anything long enough to be a paste of the wrong thing, is not a name.
  // BUILT AT RUNTIME, NOT WRITTEN AS A LITERAL. `\p{L}` with the /u flag is a PARSE-time construct: on a
  // browser that predates it (Chrome under 64 — an Android 7 phone whose WebView was never updated, which is
  // squarely the kind of phone this is for) the whole of join.js fails to parse and the page does nothing at
  // all. Not "the name is not shown" — no join page behaviour whatsoever, silently. Built through RegExp the
  // same failure is a catchable throw, and the fallback still accepts Latin, Greek, Cyrillic, Arabic, Hebrew
  // and CJK names; it is broader than the strict version rather than narrower, which is the safe direction
  // for a check whose only job is to refuse things shaped like keys.
  var NAMEY;
  try { NAMEY = new RegExp("^[\\p{L}\\p{N} .,'’&()\\-]{2,48}$", 'u'); }
  catch (e) { NAMEY = /^[0-9A-Za-zÀ-ʯͰ-῿Ⰰ-퟿豈-﷏ﷰ-￯ .,'’&()\-]{2,48}$/; }
  if (church && NAMEY.test(church) && !/^npub1|^nsec1|^[0-9a-f]{40,}$/i.test(church)) {
    try { document.getElementById('head').textContent = 'Join ' + church; } catch(e){}
  }
  // NO INVITE AT ALL. The page said "You're invited / Join a church" to a visitor who has no invitation and
  // nothing to join with, then offered a button that opens the app with an empty church — generic onboarding,
  // with nothing anywhere explaining that a code from their church is the missing piece.
  if (!follow && !church) {
    try {
      document.getElementById('pill').textContent = 'Joining a church';
      document.getElementById('head').textContent = 'You need an invitation';
      var sub = document.getElementById('sub');
      if (sub) sub.textContent = 'Churches on TrinityOne are private, so you join with a link or code from yours — usually from a steward, a printed slip, or a QR code at the door. Ask whoever invited you.';
    } catch(e){}
  }

  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);

  document.getElementById('openNow').href = app;

  var getApp = document.getElementById('getApp');
  var note = document.getElementById('note');
  // The church code as text, under the note. `follow` comes from the URL, so it goes in by textContent only.
  function showCode(lead) {
    if (!follow) return;
    var code = document.createElement('p');
    code.className = 'joincode';
    code.appendChild(document.createTextNode(lead));
    code.appendChild(document.createElement('br'));
    var val = document.createElement('code');
    val.id = 'joincodeval';
    val.textContent = follow;
    code.appendChild(val);
    note.parentNode.insertBefore(code, note.nextSibling);
  }
  if (isAndroid) {
    getApp.classList.remove('hide');
    getApp.href = APK;
    getApp.setAttribute('download','');
    document.getElementById('getAppLabel').innerHTML = 'Get the Android app';
    // AUDIT-2026-07-24. Two honest additions, both about the biggest drop-off on this page:
    //   1. Android WILL ask permission to install an app from the browser. People who aren't warned read that
    //      prompt as "this is unsafe" and stop. Saying it first turns a scare into an expected step.
    //   2. The app now claims this link (app-link + assetlinks.json), so after installing, re-tapping the invite
    //      carries the church straight in. But that only works if the link still exists — so show the code as
    //      text too, for the person who installs and then can't find the message again.
    note.innerHTML = 'Tapping <b>Open now</b> joins you instantly in your browser — nothing to install.'
      + '<br><br>Prefer an app icon? Tap <b>Get the Android app</b>. Android will ask you to allow installing '
      + 'from your browser — that’s normal, and you only do it once. When it’s installed, tap this invite '
      + 'link again and it opens straight in the app, already joined.';
    // the fallback for someone who installs the app and then loses the invite message
    showCode('Lost this link after installing? Open the app and paste this church code:');
  } else if (isIOS) {
    // THE IPHONE APP COMES THROUGH TESTFLIGHT, and an invite link does not open it yet — so the church code
    // shown below is how an iPhone member joins inside the app. Built with createElement/textContent: nothing
    // from the URL goes near innerHTML.
    getApp.classList.remove('hide');
    getApp.href = TESTFLIGHT_APP;
    document.getElementById('getAppLabel').textContent = 'Get the iPhone app';
    note.textContent = '';
    var b = function (t) { var e = document.createElement('b'); e.textContent = t; return e; };
    var store = document.createElement('a');
    store.href = TESTFLIGHT_STORE;
    store.textContent = 'TestFlight from the App Store';
    note.appendChild(document.createTextNode('For the iPhone app: get '));
    note.appendChild(store);
    note.appendChild(document.createTextNode(', tap '));
    note.appendChild(b('Get the iPhone app'));
    note.appendChild(document.createTextNode(' and install it. Then open TrinityOne and paste or scan your church code.'));
    showCode('Your church code:');
  } else {
    note.innerHTML = 'Tap <b>Open now</b> to begin in your browser. On a phone you can add it to your Home Screen like an app.';
  }
})();