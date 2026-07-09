// features.js — extracted from features.html for strict CSP (no inline).
  // mini June calendar for the Calendar mockup
  (function () {
    var el = document.getElementById('miniCal');
    if (!el) return;
    var H = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], html = '';
    H.forEach(function (d) { html += '<div class="h">' + d + '</div>'; });
    var ev = { 14: 'var(--gold)', 22: 'var(--clay)', 25: 'var(--sage)' };
    for (var d = 1; d <= 30; d++) {
      var on = d === 15;
      var dot = (!on && ev[d]) ? '<span class="ev" style="background:' + ev[d] + '"></span>' : '';
      html += '<div class="c' + (on ? ' today' : '') + '">' + d + dot + '</div>';
    }
    el.innerHTML = html;
  })();
