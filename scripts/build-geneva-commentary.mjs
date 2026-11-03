// build-geneva-commentary.mjs — host the 1599 Geneva Bible marginal notes as a MySword commentary module.
//
// The app ALREADY runs MySword commentary SQLite in the browser (engine.js buildCommentaryFromDb, reached by
// installModule's non-JSON branch). So the Geneva notes ship as a zipped `.cmt.mybible`, exactly like the
// four commentaries already in catalog.json — NOT as a new JSON commentary (a kind:"comment" JSON has no
// loader and would register as a dictionary).
//
// ONE change to the source DB: the file's Details table has NO licence column, so the commentary panel would
// show no credit (engine.js detailsOf reads Details.License/Licence/Copyright; applyMeta does NOT plumb the
// catalogue's `license` through to the panel — verified against the shipped Aquifer/Matthew-Henry/JFB entries,
// where the credit comes from the DB, not the catalogue). The OSN module shows its credit precisely because
// its DB carries a License column. So this adds a License column with the public-domain credit, which is the
// mechanism that already works, then zips the DB.
//
// The catalogue `license` string is still set (for the Library download card), but the panel credit comes
// from this DB column.
//
// REBUILD ⇒ RE-PIN: this zip's sha256 is pinned in catalog.json. The zip mtime is fixed for determinism, but a
// rebuild on a different sqlite/node version can still change the DB page layout (and thus the hash), so after
// ANY rebuild recompute the hash and update the catalog.json `sha256` for geneva-notes, or install will refuse it.
//
// Run: node scripts/build-geneva-commentary.mjs [path-to.cmt.mybible]
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync } from 'fflate';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'modules', 'geneva-notes.cmt.mybible.zip');
const INNER = 'geneva-notes.cmt.mybible';
const DEFAULT_DB = '/home/adminl/.claude/uploads/dbb39eae-bec7-4836-abd7-1953ec08fb37/1043e2d9-geneva-notes-1599.cmt.mybible';
const LICENSE = 'Marginal notes of the 1599 Geneva Bible, modern spelling (Ikram Hawramani ebook) — public domain';

const src = process.argv[2] || DEFAULT_DB;
const work = join(tmpdir(), 'geneva-notes-build-' + process.pid + '.cmt.mybible');
copyFileSync(src, work);

const db = new DatabaseSync(work);
// add the licence column the engine reads (detailsOf: Details.License), if the source lacks it.
const cols = db.prepare('PRAGMA table_info(Details)').all().map(c => c.name.toLowerCase());
if (!cols.includes('license')) db.exec('ALTER TABLE Details ADD COLUMN License TEXT');
db.prepare('UPDATE Details SET License = ?').run(LICENSE);
db.close();

const bytes = readFileSync(work);
// fixed mtime so a rebuild is reproducible (the sha256 pin stays stable).
const zip = zipSync({ [INNER]: [new Uint8Array(bytes), { mtime: new Date('2026-11-03T00:00:00Z'), level: 9 }] });

mkdirSync(join(ROOT, 'modules'), { recursive: true });
writeFileSync(OUT, zip);
const sha = createHash('sha256').update(zip).digest('hex');
const mb = (zip.length / (1024 * 1024)).toFixed(1);
process.stderr.write(
  `wrote ${OUT}\n` +
  `  inner: ${INNER}   zip size: ${mb} MB\n` +
  `  sha256: ${sha}\n`);
