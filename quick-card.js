// Print button for the recovery quick-card. External (not inline onclick=) so it survives the strict CSP
// (script-src 'self', no unsafe-inline / no inline event handlers). SECURITY-AUDIT-2026-07-18.
document.addEventListener('DOMContentLoaded', function () {
  var b = document.getElementById('printBtn');
  if (b) b.addEventListener('click', function () { window.print(); });
});
