// THE MEMBER APP PINS text-size-adjust TO 100%, so iOS does not inflate the whole UI to the phone's
// Larger Text / Display Zoom accessibility setting.
// Run: node --test scripts/member-app-pins-text-size-adjust.test.mjs
//
// WHY THIS EXISTS (2026-11-19): three onboarded iPhone users — different models, all with larger text set
// (reading glasses) — saw the app "slightly zoomed in" and had to SCROLL to reach the bottom tab bar. The
// owner's phone, at default text size, never reproduced it. Cause: iOS WKWebView (and Safari) scale ALL web
// text to the device's Larger-Text / Display-Zoom setting unless `text-size-adjust` is pinned to 100%. The
// member app inlines its own design tokens in index.html and does NOT link brand.css — and brand.css is the
// only place that carried `html { -webkit-text-size-adjust: 100% }`. So the member build shipped WITHOUT it
// and inflated on every large-text member's phone (the chrome is laid out at fixed px, so inflation both
// looked like a zoom AND pushed the floating tab bar below the fold).
//
// POINT OF USE: the SHIPPED member document. sync-web.sh copies index.html into www/ verbatim except for
// rewriting <script> tags (it never touches the <style> block), and `cap sync` bundles www/ into the iOS/APK
// app — so the inline <style> in index.html IS what a member's webview parses. This asserts the real CSS
// rule is in that <style>, and (so the two cannot drift again) that it matches what brand.css has long had.
//
// NOT MEASURED HERE: iOS's actual inflation. It is an iOS-only WKWebView/Safari behaviour; headless Chromium
// does not reproduce it, so no browser test can prove the fix. The owner/parent must confirm on a handset (or
// the iOS Simulator with Larger Text turned up): with the pin, the app renders at its designed size and the
// tab bar stays on screen regardless of the device text setting. (CLAUDE.md rule 6.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;

// strip CSS/HTML block comments so the PROSE above the rule (which names "text-size-adjust") can never satisfy
// an assertion — only a real declaration can. This is the rule-3 / sabotage-scoping discipline: match the rule.
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

// the inline <style> blocks of index.html, comments removed
function memberInlineStyle() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  assert.ok(blocks.length, 'index.html has no inline <style> — the member app carries its own; re-anchor this test');
  return stripComments(blocks.join('\n'));
}

// does an `html { ... }` rule in this CSS set `prop` (optionally -webkit-prefixed) to 100%?
function htmlRulePins(cssText, prop) {
  // every `html ... { ... }` rule body (html may be grouped with commas, e.g. `html, body { }`)
  const rules = [...cssText.matchAll(/(^|[}{;])\s*([^{}]*\bhtml\b[^{}]*)\{([^}]*)\}/g)];
  const re = new RegExp(`(?:-webkit-)?${prop}\\s*:\\s*100%`, 'i');
  return rules.some(m => re.test(m[3]));
}

test('the member app index.html pins -webkit-text-size-adjust AND text-size-adjust to 100% on html', () => {
  const css = memberInlineStyle();
  // the webkit-prefixed form (the one iOS actually reads) and the standard form, both on an html rule, both 100%
  assert.ok(/-webkit-text-size-adjust\s*:\s*100%/i.test(css),
    'the member app does not pin -webkit-text-size-adjust:100% — iOS will inflate the whole UI to the phone\'s Larger Text setting');
  assert.ok(/[^-]text-size-adjust\s*:\s*100%/i.test(css) || /;text-size-adjust\s*:\s*100%/i.test(css) || /\{text-size-adjust\s*:\s*100%/i.test(css),
    'the member app does not pin the standard text-size-adjust:100% (needed off -webkit browsers)');
  assert.ok(htmlRulePins(css, 'text-size-adjust'),
    'text-size-adjust:100% is present but not on an `html { }` rule, so it does not cover the document root');
});

test('index.html does not drift from brand.css: if brand.css pins text-size-adjust, the member app must too', () => {
  const brand = stripComments(readFileSync(join(ROOT, 'brand.css'), 'utf8'));
  const brandPins = htmlRulePins(brand, 'text-size-adjust');
  // brand.css has carried this for ages; this test's premise is that the member app fell behind it. If brand.css
  // ever loses it, that is its own regression — flag it rather than silently passing.
  assert.ok(brandPins, 'brand.css no longer pins text-size-adjust:100% on html — the public site/steward app will now inflate too');
  assert.ok(htmlRulePins(memberInlineStyle(), 'text-size-adjust'),
    'brand.css pins text-size-adjust but the member app (index.html inline style) does not — the exact drift that shipped the zoom bug');
});
