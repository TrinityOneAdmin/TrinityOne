// welcome-churches.js — extracted from welcome-churches.html for strict CSP (no inline).
  // ── procedural faux-QR for the church joining card (matches the in-app style) ──
  (function () {
    const seed = 'GRACE-7K2';
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const rnd = (i) => { const x = Math.sin(h + i * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const N = 19, cells = [];
    const finder = (r, c) => r < 6 && c < 6;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const isF = finder(r, c) || finder(r, N - 1 - c) || finder(N - 1 - r, c);
      let on;
      if (isF) { const br = r < 6 ? r : N - 1 - r, bc = c < 6 ? c : N - 1 - c; on = br === 0 || br === 5 || bc === 0 || bc === 5 || (br >= 2 && br <= 3 && bc >= 2 && bc <= 3); }
      else on = rnd(r * N + c) > 0.55;
      if (on) cells.push('<rect x="' + c + '" y="' + r + '" width="1" height="1" rx="0.18"/>');
    }
    const el = document.getElementById('churchQR');
    if (el) el.innerHTML =
      '<svg viewBox="0 0 19 19" width="100%" height="100%"><rect width="19" height="19" fill="#fff"/>' +
      '<g fill="#1a1410">' + cells.join('') + '</g>' +
      '<circle cx="9.5" cy="9.5" r="2.6" fill="#fff"/>' +
      '<use href="#to-halo" x="7" y="7" width="5" height="5" style="color:var(--ink);--spark:var(--clay)"/></svg>';
  })();

  // ── copy the joining code ──
  document.querySelectorAll('.join-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.closest('.join-meta')?.querySelector('.join-code')?.textContent?.replace(/‑/g, '-').trim() || '';
      if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 6.5"/></svg> Copied';
      setTimeout(() => { btn.innerHTML = orig; }, 1600);
    });
  });

  // ── copy the relay-install command (was an inline onclick; refused under strict CSP) ──
  const _ric = document.getElementById('relayInstallCopyBtn');
  if (_ric) _ric.addEventListener('click', () => {
    const el = document.getElementById('relayInstallCmd');
    if (navigator.clipboard && el) navigator.clipboard.writeText(el.textContent).catch(() => {});
    _ric.textContent = 'Copied';
    setTimeout(() => { _ric.textContent = 'Copy'; }, 1400);
  });
