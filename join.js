// join.js — extracted from join.html so it runs under strict CSP (no inline scripts).
(function(){
  var q = new URLSearchParams(location.search);
  var follow = q.get('follow') || '';
  var name = q.get('name') || '';
  var relay = q.get('relay') || '';
  var church = q.get('c') || '';
  var APK = './trinityone.apk';   // SECURITY-AUDIT-2026-06-24 L12: relative path so the download resolves on whichever host served the join page (Pages, gateway, or church relay) — not pinned to the dev box's Tailnet hostname.

  // the instant path: open the web app with the join context (key minted on-device, name pre-filled, church followed)
  var app = '/?follow=' + encodeURIComponent(follow);
  if (name)  app += '&name=' + encodeURIComponent(name);
  if (relay && /^wss:\/\//i.test(relay)) app += '&relay=' + encodeURIComponent(relay);   // SECURITY-AUDIT-2026-07-06 L9: only forward an ENCRYPTED (wss://) relay from a public join link — never a cleartext/hostile one

  // URLSearchParams.get() ALREADY percent-decodes — decoding again double-decodes (a name with a literal '%' throws;
  // encoded chars render wrong). Use the values as-is.
  if (name)   { try { document.getElementById('pill').textContent = 'Hi, ' + name; } catch(e){} }
  if (church) { try { document.getElementById('head').textContent = 'Join ' + church; } catch(e){} }

  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);

  document.getElementById('openNow').href = app;

  var getApp = document.getElementById('getApp');
  var note = document.getElementById('note');
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
    if (follow) {
      var code = document.createElement('p');
      code.className = 'joincode';
      code.innerHTML = 'Lost this link after installing? Open the app and paste this church code:<br>'
        + '<code id="joincodeval"></code>';
      note.parentNode.insertBefore(code, note.nextSibling);
      try { document.getElementById('joincodeval').textContent = follow; } catch(e){}
    }
  } else if (isIOS) {
    note.innerHTML = 'Tap <b>Open now</b>, then Share <span aria-hidden="true">⬆️</span> → <b>Add to Home Screen</b> to keep TrinityOne like an app. (An App Store version is on the way.)';
  } else {
    note.innerHTML = 'Tap <b>Open now</b> to begin in your browser. On a phone you can add it to your Home Screen like an app.';
  }
})();