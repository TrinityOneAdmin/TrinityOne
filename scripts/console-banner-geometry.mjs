// Turn a rendered miniReact tree into real HTML, so a browser can lay out the boxes the components
// actually evaluated. Shared by the probe and the test beside it; one copy, because two would drift.
//
// Only the STYLE OBJECTS and the tree shape come from the components — the colours do not matter to a
// geometry measurement, and the CSS custom properties the console defines elsewhere are stubbed below with
// values that affect layout (fonts) and nothing else.
const UNITLESS = new Set(['zIndex', 'flex', 'flexGrow', 'flexShrink', 'opacity', 'fontWeight', 'lineHeight', 'order']);
const kebab = (k) => k.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^webkit-/, '-webkit-');

export function styleString(style) {
  return Object.entries(style || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => kebab(k) + ':' + (typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v))
    .join(';');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const VOID = new Set(['br', 'hr', 'img', 'input']);

export function toHtml(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  if (Array.isArray(node)) return node.map(toHtml).join('');
  // a function component: miniReact keeps its rendered output as its only child
  if (typeof node.type === 'function') return (node.kids || []).map(toHtml).join('');
  if (node.type === 'Fragment') return (node.kids || []).map(toHtml).join('');
  const p = node.props || {};
  const attrs = [];
  if (p.style) attrs.push('style="' + esc(styleString(p.style)) + '"');
  for (const k of ['role', 'aria-label', 'aria-live', 'title', 'id', 'className'])
    if (p[k]) attrs.push((k === 'className' ? 'class' : k) + '="' + esc(p[k]) + '"');
  if (p['data-probe']) attrs.push('data-probe="' + esc(p['data-probe']) + '"');
  const tag = String(node.type);
  const open = '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>';
  if (VOID.has(tag)) return open;
  return open + (node.kids || []).map(toHtml).join('') + '</' + tag + '>';
}

// The console's own reset, trimmed to what changes a box: the page fills the viewport, nothing has a default
// margin, and the font stack is a real one so a line of text has a real height.
export const PAGE_CSS = `
:root{--paper:#faf7f2;--surface:#fff;--surface-2:#f4efe8;--line:#e3dbd0;--ink:#2a2118;--ink-2:#5b5044;
--ink-3:#8c8175;--clay:#c06a4a;--clay-ink:#8f4526;--clay-soft:#f6e6de;--sage:#7d9471;--sage-ink:#4d6243;
--on-clay:#fff;--shadow-lg:0 12px 32px rgba(0,0,0,.14);
--font-ui:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--font-display:var(--font-ui);--mono:monospace}
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;font-family:var(--font-ui);background:var(--paper);color:var(--ink)}
button{font:inherit}
`;

export function page(bodyHtml) {
  // ⚠ THE VIEWPORT META IS LOAD-BEARING, AND IT IS THE ONE steward.html SHIPS. Without it a mobile-emulated
  // Chromium lays the page out at its 980px fallback width, so a measurement taken "at 360x730" is silently
  // taken at 980x1988 instead — every box lands somewhere real and somewhere else, which is the worst kind
  // of wrong number.
  return '<!doctype html><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0" />'
    + '<style>' + PAGE_CSS + '</style><body>' + bodyHtml + '</body>';
}
