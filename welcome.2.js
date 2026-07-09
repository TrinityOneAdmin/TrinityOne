// welcome.2.js — extracted from welcome.html for strict CSP (no inline).
  (function () {
    var f = document.getElementById('subForm'); if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.getElementById('subMsg');
      var email = (f.email.value || '').trim(), website = (f.website.value || '').trim();
      msg.style.color = 'var(--ink-3)'; msg.textContent = 'Subscribing…';
      fetch('/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, website: website, src: 'welcome' }) })
        .then(function (r) { return r.json().then(function (s) { return { ok: r.ok, s: s }; }); })
        .then(function (x) {
          if (x.ok) { msg.style.color = 'var(--gold-soft)'; msg.textContent = '✓ You’re on the list — thank you!'; f.reset(); }
          else { msg.style.color = '#e8a0a0'; msg.textContent = '✗ ' + ((x.s && x.s.error) || 'Something went wrong — try again.'); }
        })
        .catch(function () { msg.style.color = '#e8a0a0'; msg.textContent = '✗ Network error — please try again.'; });
    });
  })();
