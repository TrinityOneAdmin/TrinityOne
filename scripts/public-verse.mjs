// public-verse.mjs — renders a standalone HTML page for a shared Bible verse.
//
// gateway.mjs serves this at GET /v?r=<ref>&t=<text>&v=<version>. The page is self-contained:
// no external script, no CDN, no image, no cookie, no font load — CSS is inline, every value is
// HTML-escaped before injection, and the CSP is as tight as the calendar feed's.
//
// WHY SERVER-SIDE TEMPLATING rather than a static page that reads location.search client-side:
// Open Graph tags (og:title, og:description) must be in the initial HTML for link previews
// (WhatsApp, iMessage, Facebook, Slack) to show the verse text. A JS-only page shows a blank
// preview, which defeats the purpose of a share link.

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildVersePage(ref, text, version) {
  const r = escHtml(String(ref || '').slice(0, 120));
  const t = escHtml(String(text || '').slice(0, 3000));
  const v = escHtml(String(version || '').slice(0, 30));
  const ogDesc = (t.length > 200 ? t.slice(0, 197) + '...' : t).replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const title = r ? r + ' — TrinityOne' : 'A verse — TrinityOne';

  return '<!DOCTYPE html>\n'
    + '<html lang="en">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>' + title + '</title>\n'
    + '<meta property="og:title" content="' + (r || 'A verse') + '">\n'
    + '<meta property="og:description" content="' + escHtml(ogDesc) + '">\n'
    + '<meta property="og:type" content="article">\n'
    + '<meta name="twitter:card" content="summary">\n'
    + '<style>\n'
    + '*{box-sizing:border-box;margin:0}\n'
    + 'body{min-height:100vh;display:flex;align-items:center;justify-content:center;'
    + 'background:#FBF6EC;font-family:-apple-system,"Segoe UI",Roboto,system-ui,sans-serif;'
    + 'padding:24px 16px;color:#221C16}\n'
    + '@media(prefers-color-scheme:dark){body{background:#1a1610}}\n'
    + '.w{max-width:480px;width:100%}\n'
    + '.card{border-radius:26px;'
    + 'background:linear-gradient(155deg,#C25A38,#9A3D24);color:#fff;'
    + 'box-shadow:0 2px 4px rgba(34,28,16,.08),0 12px 36px rgba(34,28,16,.12);'
    + 'padding:36px 30px;position:relative;overflow:hidden}\n'
    + '.bg{position:absolute;right:-16px;top:-16px;opacity:.14;width:120px;height:120px}\n'
    + '.bg svg{width:100%;height:100%}\n'
    + '.ic{margin-bottom:20px}\n'
    + '.ic svg{width:24px;height:24px}\n'
    + '.vt{font-family:Georgia,"Times New Roman",serif;font-size:22px;line-height:1.5;'
    + 'font-weight:500;margin-bottom:24px}\n'
    + '.rf{font-weight:700;font-size:13px;letter-spacing:.5px}\n'
    + '.ft{text-align:center;margin-top:24px;font-size:12px;color:#736958;'
    + 'font-weight:600;letter-spacing:.3px}\n'
    + '@media(prefers-color-scheme:dark){.ft{color:#a09080}}\n'
    + '</style>\n'
    + '</head>\n<body>\n'
    + '<div class="w">\n'
    + '  <div class="card">\n'
    + '    <div class="bg"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.3" '
    + 'stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z"/>'
    + '</svg></div>\n'
    + '    <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" '
    + 'stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z"/>'
    + '</svg></div>\n'
    + '    <p class="vt">“' + t + '”</p>\n'
    + '    <div class="rf">' + r + (v ? ' · ' + v : '') + '</div>\n'
    + '  </div>\n'
    + '  <div class="ft">Shared via TrinityOne</div>\n'
    + '</div>\n'
    + '</body>\n</html>\n';
}
