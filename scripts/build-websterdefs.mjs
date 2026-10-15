// build-websterdefs.mjs — turn Webster's Revised Unabridged Dictionary (1913) into a TrinityOne "word definitions" module.
//
// Source: GCIDE 0.53 (the GNU Collaborative International Dictionary of English), https://ftp.gnu.org/gnu/gcide/gcide-0.53.tar.xz,
// files CIDE.A … CIDE.Z. GCIDE is Webster's 1913 text plus later additions; every sense there carries a
// <source> tag, and this builder keeps ONLY senses tagged "1913 Webster" (public domain). Newer senses
// (WordNet-derived, Wiktionary-derived) are dropped, so the module is 1913 text only.
//
// Same shape and same trimming as build-worddefs.mjs (it imports that script's vocabulary + morphology code):
//   { meta:{ abbr:"W1913", name, license, kind:"worddef" },
//     defs:{ "<headword>": [["n"|"v"|"adj"|"adv", "gloss"], …] },
//     forms:{ "<inflected>": "<headword>" } }
// Only words in the shipped Bibles are kept, at most MAX_SENSES senses each, glosses cut at MAX_GLOSS characters.
//
// Run: node scripts/build-websterdefs.mjs                (downloads GCIDE, unpacks into a fresh temp dir)
//      node scripts/build-websterdefs.mjs <cideDir>      (uses a local directory holding CIDE.A … CIDE.Z)
// The downloaded files are untrusted data: they are only ever read as text, never executed.
import { writeFileSync, readFileSync, readdirSync, mkdtempSync, writeFileSync as wf, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { harvestVocab, makeMorphy, MAX_SENSES } from './build-worddefs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'modules', 'worddefs-webster.json');
const SRC_URL = 'https://ftp.gnu.org/gnu/gcide/gcide-0.53.tar.xz';
export const MAX_GLOSS = 200;
export const LICENSE = 'Webster’s Revised Unabridged Dictionary (1913) — public domain. Text from the GNU Collaborative International '
  + 'Dictionary of English (GCIDE), 1913 Webster entries only.';

// GCIDE writes accents as "<eacute/" (no closing >). The common ones become their letter; any other is dropped.
const ENT = { ldquo: '“', rdquo: '”', ae: 'æ', oe: 'œ', eacute: 'é', egrave: 'è', br: ' ', hand: '', amac: 'a', acr: 'a', icr: 'i', ecr: 'e',
  emac: 'e', imac: 'i', adot: 'a', etil: 'e', omac: 'o', ucr: 'u', ocr: 'o', aum: 'ä', osl: 'ø', esl: 'e', ycr: 'y', umac: 'u', oum: 'ö',
  ait: 'a', eum: 'ë', edh: 'ð' };
function clean(s) {
  return s.replace(/<as>[\s\S]*?<\/as>/g, ' ')              // "as, to love one's children" — an example, not the meaning
    .replace(/<(\w+)\//g, (_, n) => ENT[n] ?? '')
    .replace(/<[^<>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').replace(/\s+([,;.])/g, '$1').replace(/[;,]+\.?$/, m => (m.endsWith('.') ? '.' : '')).replace(/[;,\s]+$/, '').trim();
}
export function trimGloss(s) {
  let g = s;
  if (g.length > MAX_GLOSS) { g = g.slice(0, MAX_GLOSS).replace(/\s+\S*$/, '') + '…'; }
  return g;
}
const POS = (p) => {
  const t = String(p).trim().toLowerCase();
  if (/^v\b/.test(t)) return 'v';
  if (/^n\b/.test(t)) return 'n';
  if (/^(a|adj)\b/.test(t)) return 'adj';
  if (/^adv\b/.test(t)) return 'adv';
  return null;
};

// CIDE text -> Map<lowercase single-word headword, [[pos, gloss], …]> in Webster's own order (all 1913 senses; callers cap).
export function parseCide(text) {
  const out = new Map();
  const parts = String(text).split('<ent>');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const end = chunk.indexOf('</ent>'); if (end < 0) continue;
    const head = clean(chunk.slice(0, end)).toLowerCase();
    if (!/^[a-z]+$/.test(head)) continue;                       // single plain words only (a Bible reader taps one word)
    const body = chunk.slice(end + 6);
    let pos = null;
    const pm = /<pos>([^<]*)<\/pos>/.exec(body.slice(0, body.search(/<def>/) < 0 ? body.length : body.search(/<def>/)));
    if (pm) pos = POS(pm[1]);
    // every <def>…</def>, each followed by its own source tag before the next <def>
    const defRe = /<def>([\s\S]*?)<\/def>([\s\S]*?)(?=<def>|$)/g;
    let m;
    while ((m = defRe.exec(body))) {
      // a later <pos> inside the entry (a second part of speech) is found between defs, but ours is entry-level; keep it simple
      if (!/<source>1913 Webster<\/source>/.test(m[2])) continue;
      const g = clean(m[1]);
      if (g.length < 8 || /^See\b/.test(g) || /^(Defn:|Same as)/.test(g)) continue;
      if (!out.has(head)) out.set(head, []);
      out.get(head).push([pos || 'n', g, /\[(Obs|R|Archaic)\b/.test(m[1]) || /\[(Obs|R)\.\]/.test(g)]);
    }
  }
  return out;
}

export const IRREGULAR = { saith: 'say', begat: 'beget', begot: 'beget', begotten: 'beget', spake: 'speak', sware: 'swear' };

// parsed: Map from parseCide (merged over all CIDE.* files); vocab: Set of lowercase words.
export function build(parsed, vocab) {
  // makeMorphy wants WordNet-shaped lookups. Webster has no part-of-speech index we trust, so everything is filed as a "noun/verb"
  // entry: lemma() then applies WordNet's ending rules and the KJV (-eth/-est/thou) rules against Webster's own headwords.
  const empty = new Map();
  const index = { noun: parsed, verb: empty, adj: empty, adv: empty };
  // Webster files "Saith" / "Begat" as separate headwords that only say "imp. of Beget"; point them at the real word.
  const exc = { noun: new Map(Object.entries(IRREGULAR).map(([k, v]) => [k, [v]])), verb: empty, adj: empty, adv: empty };
  const lemma = makeMorphy(index, exc);
  const forms = {}, heads = new Set();
  for (const w of vocab) {
    const h = lemma(w); if (!h) continue;
    heads.add(h); if (h !== w) forms[w] = h;
  }
  const defs = {};
  for (const h of heads) {
    const all = parsed.get(h) || [];
    // current-sounding senses first; [Obs.]/[R.] ones only fill remaining places
    const ordered = all.filter(s => !s[2]).concat(all.filter(s => s[2]));
    const seen = new Set(), senses = [];
    for (const [pos, g] of ordered) {
      const t = trimGloss(g);
      if (seen.has(t)) continue;
      seen.add(t); senses.push([pos, t]);
      if (senses.length >= MAX_SENSES) break;
    }
    if (senses.length) defs[h] = senses;
  }
  for (const w of Object.keys(forms)) if (!defs[forms[w]]) delete forms[w];
  return { meta: { abbr: 'W1913', name: 'Word Definitions (Webster 1913)', license: LICENSE, kind: 'worddef' }, defs, forms };
}

export function parseAll(dir) {
  const merged = new Map();
  for (const f of readdirSync(dir).filter(f => /^CIDE\.[A-Z]$/.test(f)).sort()) {
    for (const [h, s] of parseCide(readFileSync(join(dir, f), 'latin1'))) merged.set(h, (merged.get(h) || []).concat(s));
  }
  return merged;
}

async function cideDir(arg) {
  if (arg) return { dir: arg, cleanup: () => {} };
  process.stderr.write('downloading ' + SRC_URL + ' …\n');
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error('download failed: ' + res.status);
  const tmp = mkdtempSync(join(tmpdir(), 'trin-gcide-'));
  const tarball = join(tmp, 'gcide.tar.xz');
  wf(tarball, new Uint8Array(await res.arrayBuffer()));
  execFileSync('tar', ['xJf', tarball, '-C', tmp, '--wildcards', '*/CIDE.?']);
  const sub = readdirSync(tmp).find(n => /^gcide/.test(n) && !n.endsWith('.xz'));
  return { dir: join(tmp, sub), cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { dir, cleanup } = await cideDir(process.argv[2]);
  try {
    const parsed = parseAll(dir);
    if (parsed.size < 20000) throw new Error('GCIDE parse looks wrong: only ' + parsed.size + ' headwords');
    const vocab = harvestVocab(join(ROOT, 'modules'));
    const mod = build(parsed, vocab);
    const json = JSON.stringify(mod);
    writeFileSync(OUT, json);
    const covered = [...vocab].filter(w => mod.defs[w] || mod.forms[w]).length;
    process.stderr.write(
      `wrote ${OUT}\n  Webster headwords parsed: ${parsed.size}   Bible words: ${vocab.size}   covered: ${covered}   headwords: ${Object.keys(mod.defs).length}   forms: ${Object.keys(mod.forms).length}\n` +
      `  size: ${(Buffer.byteLength(json) / (1024 * 1024)).toFixed(2)} MB   sha256: ${createHash('sha256').update(json).digest('hex')}\n`);
  } finally { cleanup(); }
}
