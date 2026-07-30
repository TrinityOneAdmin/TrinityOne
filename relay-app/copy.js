// copy.js — one clipboard implementation for the whole relay app, shared by control.js and home.js.
//
// Extracted 2026-07-30 rather than copied: this codebase has already been bitten by two copies of one rule
// drifting apart (commit e26accf), and there were ALREADY two silent copy implementations in this app when the
// operator reported the church-list Copy button doing nothing. See scripts/relay-app-copy.test.mjs for the
// measured diagnosis.
(function () {
  // ── COPY ─────────────────────────────────────────────────────────────────────────────────────────────────
  // Reported 2026-07-30: the church-list Copy button did nothing. It copies the church's npub — the one string
  // an operator MUST get out of this panel to hand to members — and the row shows it clipped with
  // `text-overflow:ellipsis`, so when the button failed there was no way to read the rest either.
  //
  // The handler was fine. Driven under a stubbed clipboard it binds, runs, and copies the full 63 characters.
  // `navigator.clipboard` was the problem, in two ways the old one-liner could not survive:
  //
  //   1. OUTSIDE A SECURE CONTEXT `navigator.clipboard` is UNDEFINED. This panel is routinely opened over plain
  //      http:// on a LAN or Tailscale address, where that is exactly the case. `navigator.clipboard.writeText`
  //      then throws a SYNCHRONOUS TypeError, which the old `.catch()` never saw — it only catches rejections.
  //   2. In a webview the promise can simply REJECT (permission, or the document not focused) — and the old
  //      `.catch(()=>{})` swallowed that too.
  //
  // Either way the operator clicked and nothing happened, with nothing on screen and nothing in the log. That is
  // the silent-failure class this codebase keeps being bitten by, so the rule here is: try the modern API, fall
  // back to the one that works without a secure context, and if BOTH fail SAY SO and put the text somewhere it
  // can be copied by hand. Never resolve quietly having copied nothing.
  async function copyText(text) {
    const s = String(text == null ? '' : text);
    if (!s) return false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(s); return true; } } catch (e) {}
    // execCommand('copy') is deprecated but it is the ONLY path that works on http:// origins, which is where
    // this panel actually lives most of the time. Off-screen rather than hidden: display:none cannot be selected.
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, s.length);
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      if (ok) return true;
    } catch (e) {}
    return false;
  }

  // Flash feedback on the button without destroying it. The church-list button contains an SVG icon, not text —
  // the old code set `b.textContent = 'Copied'`, which would have replaced the icon with a word and then left it
  // reading "Copy" for ever. Only swap text on buttons that are actually text.
  function flashCopied(b, ok) {
    if (!b) return;
    const isText = b.children.length === 0;
    const prev = isText ? b.textContent : (b.getAttribute('title') || '');
    if (isText) b.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    b.setAttribute('title', ok ? 'Copied' : 'Could not copy — use Ctrl+C');
    b.classList.add(ok ? 'copied-ok' : 'copied-fail');
    setTimeout(() => { if (isText) b.textContent = prev || 'Copy'; b.setAttribute('title', prev || 'Copy'); b.classList.remove('copied-ok', 'copied-fail'); }, 1600);
  }

  // Last resort when the clipboard is unavailable: show the value, selected, so it can be copied by hand. This is
  // the part that matters for the church key — the row clips it, so without this the operator is simply stuck.
  function showCopyFallback(text, label) {
    const back = document.createElement('div');
    back.className = 'copyfb-back';
    back.innerHTML = '<div class="copyfb" role="dialog" aria-modal="true" aria-label="Copy manually">' +
      '<div class="copyfb-t">' + (label || 'Copy this') + '</div>' +
      '<div class="copyfb-h">This browser would not let the page write to the clipboard — that happens when the panel is opened over plain http. It is selected below: press Ctrl+C (⌘C on a Mac).</div>' +
      '<textarea class="copyfb-v" readonly rows="3"></textarea>' +
      '<div class="copyfb-a"><button class="btn btn-sm copyfb-close">Done</button></div></div>';
    const ta = back.querySelector('.copyfb-v');
    ta.value = String(text || '');
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    back.querySelector('.copyfb-close').onclick = close;
    back.onclick = (e) => { if (e.target === back) close(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
  }

  // One entry point for every Copy button in this panel.
  async function copyWithFeedback(text, btn, label) {
    const ok = await copyText(text);
    flashCopied(btn, ok);
    if (!ok) showCopyFallback(text, label);
    return ok;
  }

  window.RelayCopy = { copyText, flashCopied, showCopyFallback, copyWithFeedback };
})();
