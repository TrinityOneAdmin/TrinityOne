// build-worddefs.mjs — turn WordNet 3.0 into a TrinityOne "word definitions" module.
//
// Source: WordNet 3.0 database files (https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz — data.*, index.*,
// index.sense, *.exc). Licence: the Princeton WordNet licence (free use/redistribution with the notice kept).
//
// Why a module of our own: the Strong's lexicon only answers on tagged Bibles (KJV/AKJV/WEB-S). BSB, and any
// untagged translation, has no word -> definition path. This gives every English word in the shipped Bibles a
// plain-English meaning, download-on-demand like the cross-references.
//
// Size lever: only words that actually appear in the shipped Bibles (modules/engbsb, eng-kjv, eng-web, eng-asv)
// are kept, at most 3 senses each, glosses stripped of WordNet's quoted example sentences.
//
// Output: modules/worddefs-wordnet.json — installed through installModule(format:"JSON", kind:"worddef").
//   { meta:{ abbr:"WN", name, license, kind:"worddef" },
//     defs:{ "<headword>": [["n"|"v"|"adj"|"adv", "gloss"], …] },     // best-attested sense first
//     forms:{ "<inflected>": "<headword>" } }                         // loved->love, goeth->go, thee->you
//
// Run: node scripts/build-worddefs.mjs              (downloads WordNet)
//      node scripts/build-worddefs.mjs <dictDir>    (uses a local WordNet "dict" directory)
import { unzipSync, gunzipSync } from 'fflate';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'modules', 'worddefs-wordnet.json');
const SRC_URL = 'https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz';
export const MAX_SENSES = 3;
const MAX_GLOSS = 170;
export const LICENSE = 'WordNet 3.0 \u00a9 2006 Princeton University. All rights reserved. WordNet is used under the Princeton WordNet licence '
  + '(wordnet.princeton.edu/license-and-commercial-use); the university\u2019s name is not used to endorse this app.';

const POSES = [['noun', 'n'], ['verb', 'v'], ['adj', 'adj'], ['adv', 'adv']];
// When WordNet has no frequency to separate two senses, an adjective/verb reading beats a noun one (holy, grace).
const TIE_ORDER = { adj: 0, v: 1, n: 2, adv: 3 };

// ---- WordNet file parsing -------------------------------------------------------------------------------
// data.X: "offset lexfile ss_type w_cnt(hex) word lexid … p_cnt ptrs… | gloss". Licence lines start with spaces.
export function parseData(text) {
  const out = new Map();   // offset -> { words:[original-case], gloss }
  for (const line of text.split('\n')) {
    if (!line || line[0] === ' ') continue;
    const bar = line.indexOf(' | ');
    if (bar < 0) continue;
    const t = line.slice(0, bar).split(' ');
    const n = parseInt(t[3], 16);
    const words = [];
    for (let i = 0; i < n; i++) words.push(String(t[4 + 2 * i]).replace(/\((?:a|p|ip)\)$/, ''));
    out.set(t[0], { words, gloss: cleanGloss(line.slice(bar + 3)) });
  }
  return out;
}
// Keep the definition, drop the quoted example sentences ("; \"...\"") and any stray quotes.
export function cleanGloss(g) {
  let s = String(g).split(/;\s*"/)[0].replace(/"/g, '').replace(/[;\s]+$/, '').trim();
  if (s.length > MAX_GLOSS) { s = s.slice(0, MAX_GLOSS); s = s.replace(/\s+\S*$/, '') + '\u2026'; }
  return s;
}
// index.X: "lemma pos synset_cnt p_cnt ptr_symbol… sense_cnt tagsense_cnt offset…" (offsets most-used first).
export function parseIndex(text) {
  const out = new Map();   // lemma -> [offset…]
  for (const line of text.split('\n')) {
    if (!line || line[0] === ' ') continue;
    const t = line.split(' ');
    const syn = parseInt(t[2], 10), p = parseInt(t[3], 10);
    out.set(t[0], t.slice(4 + p + 2, 4 + p + 2 + syn));
  }
  return out;
}
// index.sense: "lemma%1:09:00:: offset sense_number tag_cnt" -> "lemma|pos|offset" -> tag_cnt (how often it is the sense in text)
export function parseSenseTags(text) {
  const out = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    const [key, off, , tag] = line.split(' ');
    const m = /^(.*?)%(\d):/.exec(key); if (!m) continue;
    const pos = { 1: 'noun', 2: 'verb', 3: 'adj', 4: 'adv', 5: 'adj' }[m[2]];
    out.set(m[1] + '|' + pos + '|' + off, parseInt(tag, 10) || 0);
  }
  return out;
}
export function parseExc(text) {
  const out = new Map();
  for (const line of String(text || '').split('\n')) { const t = line.trim().split(/\s+/); if (t.length >= 2) out.set(t[0], t.slice(1)); }
  return out;
}

// ---- morphy: inflected form -> WordNet lemma(s) ---------------------------------------------------------
const RULES = {
  noun: [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']],
  verb: [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', '']],
  adj:  [['er', ''], ['est', ''], ['er', 'e'], ['est', 'e']],
  adv:  [],
};
// Biblical English: -eth / -est / -edst / -th endings and the thou-forms. Pointers are for words WordNet
// does not know at all (WordNet has no pronouns, so thou/thee/thy are stopwords at lookup); a word that IS a lemma never goes through this table.
export const KJV_POINTERS = {
  hath: 'have', hast: 'have', hadst: 'have',
  doth: 'do', dost: 'do', didst: 'do', art: 'be', wast: 'be', wert: 'be', shalt: 'shall', wilt: 'will',
  canst: 'can', saith: 'say', wouldest: 'would', shouldest: 'should', couldest: 'could', mayest: 'may',
};
const KJV_ENDINGS = [['edst', 'ed'], ['edst', 'e'], ['est', 'e'], ['est', ''], ['eth', 'e'], ['eth', ''], ['th', 'e'], ['th', ''], ['st', '']];

export function makeMorphy(index, exc) {
  const has = w => POSES.some(([p]) => index[p].has(w));
  function candidates(w) {   // lemmas reachable from w by the WordNet rules, in preference order
    const out = [];
    for (const [p] of POSES) {
      const ex = exc[p].get(w); if (ex) for (const e of ex) out.push(e);
      for (const [suf, rep] of RULES[p]) {
        if (w.length > suf.length && w.endsWith(suf)) {
          const stem = w.slice(0, -suf.length) + rep; out.push(stem);
          // stopped -> stop, bigger -> big: undouble a final consonant pair left after stripping ed/ing/er/est
          if (/(ed|ing|er|est)$/.test(suf) && rep === '' && /([bdgklmnprt])\1$/.test(stem)) out.push(stem.slice(0, -1));
        }
      }
    }
    if (w.length > 4 && w.endsWith('ily')) out.push(w.slice(0, -3) + 'y');
    if (w.length > 4 && w.endsWith('ly')) out.push(w.slice(0, -2));
    return out;
  }
  const hasNV = w => index.noun.has(w) || index.verb.has(w);
  function nvCandidates(w) { return candidates(w).filter(c => c !== w && hasNV(c)); }
  return function lemma(w) {
    // A plural WordNet files as an exception wins even when the plural is also a word (men -> man).
    for (const e of exc.noun.get(w) || []) if (hasNV(e) && e !== w) return e;
    if (hasNV(w)) return w;
    // loved / stopped are adjectives in WordNet but the reader means the verb: prefer the noun/verb reduction.
    const nv = nvCandidates(w); if (nv.length) return nv[0];
    if (has(w)) return w;
    for (const c of candidates(w)) if (c !== w && has(c)) return c;
    if (KJV_POINTERS[w] && has(KJV_POINTERS[w])) return KJV_POINTERS[w];
    for (const [suf, rep] of KJV_ENDINGS) {
      if (w.length > suf.length + 1 && w.endsWith(suf)) {
        const stem = w.slice(0, -suf.length) + rep;
        if (has(stem)) return stem;
        if (/([bdgklmnprt])\1$/.test(stem) && has(stem.slice(0, -1))) return stem.slice(0, -1);   // sinneth -> sin
        for (const c of candidates(stem)) if (has(c)) return c;
      }
    }
    return null;
  };
}

// ---- the build ------------------------------------------------------------------------------------------
// files: { 'data.noun': text, 'index.noun': text, …, 'index.sense': text, 'noun.exc': text, … }; vocab: Set of lowercase words
export function build(files, vocab) {
  const data = {}, index = {}, exc = {};
  for (const [p] of POSES) {
    data[p] = parseData(files['data.' + p] || ''); index[p] = parseIndex(files['index.' + p] || ''); exc[p] = parseExc(files[p + '.exc']);
  }
  const tags = parseSenseTags(files['index.sense']);
  const lemma = makeMorphy(index, exc);

  const forms = {}, heads = new Set();
  for (const w of vocab) {
    const h = lemma(w);
    if (!h) continue;
    heads.add(h);
    if (h !== w) forms[w] = h;
  }
  const defs = {};
  for (const h of heads) {
    const cands = [];
    for (const [p, label] of POSES) {
      const offs = index[p].get(h) || [];
      offs.forEach(off => {
        const syn = data[p].get(off); if (!syn) return;
        // proper nouns (Paul, Jordan): WordNet files them under the lowercase lemma too. v1 skips a sense whose
        // word is capitalised, so only the common-noun meaning of a word survives.
        const own = syn.words.find(x => x.toLowerCase() === h);
        if (own && own[0] !== own[0].toLowerCase()) return;
        cands.push({ pos: label, gloss: syn.gloss, tag: tags.get(h + '|' + p + '|' + off) || 0, order: cands.length });
      });
    }
    cands.sort((a, b) => (b.tag - a.tag) || (TIE_ORDER[a.pos] - TIE_ORDER[b.pos]) || (a.order - b.order));
    const seen = new Set(), senses = [];
    for (const c of cands) {
      if (!c.gloss || seen.has(c.gloss)) continue;
      seen.add(c.gloss); senses.push([c.pos, c.gloss]);
      if (senses.length >= MAX_SENSES) break;
    }
    if (senses.length) defs[h] = senses;
  }
  for (const w of Object.keys(forms)) if (!defs[forms[w]]) delete forms[w];   // a pointer to nothing is dead weight
  return {
    meta: { abbr: 'WN', name: 'Word Definitions (WordNet)', license: LICENSE, kind: 'worddef' },
    defs, forms,
  };
}

// ---- vocabulary from the shipped Bibles ------------------------------------------------------------------
// USFM text -> words: drop footnotes/cross-refs, Strong's attributes and every marker; keep only lines that carry
// verse text (headings, titles and introductions are not scripture).
export function usfmWords(usfm) {
  const t = String(usfm).replace(/\\(f|x|fe)\s[\s\S]*?\\\1\*/g, ' ');
  const out = [];
  for (const line of t.split('\n')) {
    if (/^\\(id|ide|h|toc\d|mt\d?|s\d?|r|ms\d?|mr|d|sp|ip|is\d?|imt\d?|ie|rem|cl|cp|sts|b)\b/.test(line)) continue;
    const txt = line.replace(/\|[^\\]*?(?=\\)/g, '').replace(/\\[a-z0-9+]+\*?/gi, ' ').replace(/\[|\]|\u2018|\u2019|\u201c|\u201d/g, ' ');
    for (const m of txt.toLowerCase().match(/[a-z]+(?:['\u2019][a-z]+)?/g) || []) out.push(m.replace(/['\u2019]s$/, '').replace(/['\u2019]/g, ''));
  }
  return out;
}
export function harvestVocab(modulesDir) {
  const vocab = new Set();
  for (const z of ['engbsb', 'eng-kjv', 'eng-web', 'eng-asv']) {
    const u = unzipSync(new Uint8Array(readFileSync(join(modulesDir, z + '.zip'))));
    for (const k of Object.keys(u)) if (/\.usfm$/i.test(k)) for (const w of usfmWords(new TextDecoder().decode(u[k]))) if (w.length > 1) vocab.add(w);
  }
  return vocab;
}

// ---- acquiring WordNet -----------------------------------------------------------------------------------
function tarFiles(buf) {   // minimal ustar reader: name -> text, for the regular files we need
  const out = {};
  for (let o = 0; o + 512 <= buf.length;) {
    const name = new TextDecoder().decode(buf.subarray(o, o + 100)).replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(new TextDecoder().decode(buf.subarray(o + 124, o + 136)).replace(/\0.*$/, '').trim() || '0', 8);
    const base = name.split('/').pop();
    if (/^(data|index)\.(noun|verb|adj|adv|sense)$|^(noun|verb|adj|adv)\.exc$/.test(base)) out[base] = new TextDecoder().decode(buf.subarray(o + 512, o + 512 + size));
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
async function wordnetFiles(dictDir) {
  if (dictDir) {
    const out = {};
    for (const f of readdirSync(dictDir)) if (/^(data|index)\.|\.exc$/.test(f)) out[f] = readFileSync(join(dictDir, f), 'utf8');
    return out;
  }
  process.stderr.write('downloading ' + SRC_URL + ' …\n');
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error('download failed: ' + res.status);
  return tarFiles(gunzipSync(new Uint8Array(await res.arrayBuffer())));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = await wordnetFiles(process.argv[2]);
  for (const need of ['data.noun', 'index.noun', 'noun.exc', 'verb.exc']) if (!files[need]) throw new Error('WordNet file missing: ' + need);
  const vocab = harvestVocab(join(ROOT, 'modules'));
  const mod = build(files, vocab);
  const json = JSON.stringify(mod);
  writeFileSync(OUT, json);
  const covered = [...vocab].filter(w => mod.defs[w] || mod.forms[w]).length;
  process.stderr.write(
    `wrote ${OUT}\n  Bible words: ${vocab.size}   covered: ${covered}   headwords: ${Object.keys(mod.defs).length}   forms: ${Object.keys(mod.forms).length}\n` +
    `  size: ${(Buffer.byteLength(json) / (1024 * 1024)).toFixed(2)} MB   sha256: ${createHash('sha256').update(json).digest('hex')}\n`);
}
