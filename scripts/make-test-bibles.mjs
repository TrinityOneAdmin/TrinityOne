// Writes the sample Bible files for the tester: node scripts/make-test-bibles.mjs <output dir>
// (default: /mnt/storage/projects/TrinityOne-internal/test-bibles). The files are NOT stored in the repo; this builds them from
// modules/eng-web.zip, modules/eng-kjv.zip and generated text (see scripts/install-bible-samples.mjs, which the test
// scripts/install-bible-samples.test.mjs installs through the real path so the folder cannot drift into broken files).
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSamples } from './install-bible-samples.mjs';

const out = process.argv[2] || '/mnt/storage/projects/TrinityOne-internal/test-bibles';
mkdirSync(out, { recursive: true });
const samples = await buildSamples();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
for (const s of samples) writeFileSync(`${out}/${s.file}`, s.bytes);
const row = (s) => `<tr><td><code>${esc(s.file)}</code><br><small>${(s.bytes.length / 1024).toFixed(1)} KB</small></td><td>${esc(s.format)}</td>
  <td>${esc(s.source)}<br><small>Licence: ${esc(s.licence)}</small></td><td>${esc(s.see)}</td></tr>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TrinityOne test Bibles</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#222}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ccc;padding:8px;vertical-align:top;text-align:left}th{background:#f3eee8}code{background:#f3f3f3;padding:1px 4px;border-radius:4px}
.bad th{background:#f6dcd8}pre{background:#f3f3f3;padding:10px;border-radius:6px;overflow:auto}@media(prefers-color-scheme:dark){body{background:#181614;color:#eee}td,th{border-color:#444}th{background:#2a2420}.bad th{background:#4a2420}code,pre{background:#2a2a2a}}</style></head><body>
<h1>TrinityOne test Bibles</h1>
<p>Small sample files for trying <b>Library &rarr; Bibles &rarr; Have a Bible file? Install it</b>, and <b>Open with TrinityOne</b> on Android. Every
good file is built from public-domain text or text written for this folder, and each is installed by an automated test
(<code>scripts/install-bible-samples.test.mjs</code>) so it is known to work. Regenerate with
<code>node scripts/make-test-bibles.mjs &lt;dir&gt;</code> from the repository.</p>
<h2>Put them on the phone</h2>
<pre>adb push /mnt/storage/projects/TrinityOne-internal/test-bibles/ /sdcard/Download/test-bibles/</pre>
<p>Then in TrinityOne: Library &rarr; Bibles &rarr; <b>Have a Bible file? Install it</b> &rarr; Downloads &rarr; test-bibles &rarr; pick a file. Or open the Files
app, tap a file in Download/test-bibles, and choose TrinityOne (confirm, then <b>Install</b>). The result screen names the kind
(Bible, commentary, dictionary, cross-references) and the name shown below.</p>
<h2>Files that should install</h2>
<table><tr><th>File</th><th>Format</th><th>Source</th><th>What you should see</th></tr>
${samples.filter(s => !s.bad).map(row).join('\n')}
</table>
<p><b>Installing the same file twice</b> says "You already have this &hellip;" and changes nothing. <b>After closing and reopening the app</b> every
module is still there. A name that matches a Bible TrinityOne itself offers (for example the real "World English Bible") gets
"(from a file)" added: that is deliberate, so a file can never pass itself off as a published Bible; these samples avoid such names.</p>
<p><b>"Read it now" on the partial Bibles.</b> 02 has only 3 John and 03 has only Ruth and 3 John, so they have no text where you were reading
(for example John 1). "Read it now" therefore opens the first passage the new Bible has (3 John 1, or Ruth 1) instead of leaving you on a page with
no text. If you then go to a chapter the Bible lacks, the reader says so (for example "John 1 isn't in &hellip;") and offers a button to the first chapter it has.</p>
<h2>Files that should be refused</h2>
<table class="bad"><tr><th>File</th><th>Format</th><th>Source</th><th>What you should see</th></tr>
${samples.filter(s => s.bad).map(row).join('\n')}
</table>
<p>Not included (cannot be a small file): the "too big" refusal needs a file over 50 MB.</p>
<p><small>Public-domain texts: the World English Bible and King James Version as published by eBible.org (https://ebible.org). Generated 2026-11-17 by scripts/make-test-bibles.mjs.</small></p>
</body></html>`;
writeFileSync(`${out}/README.html`, html);
console.log(`wrote ${samples.length} files and README.html to ${out}`);
