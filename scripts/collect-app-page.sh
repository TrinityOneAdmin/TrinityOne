#!/usr/bin/env bash
# collect-app-page.sh <page> <out> — copy ONE app page and every local file it references into <out>, as a
# self-contained, Babel-free web bundle: <page> becomes <out>/index.html, app/*.jsx are pre-transpiled to .js.
#
# CALLERS (rule 2):
#   scripts/build-steward-apk.sh   steward.html / finance.html -> www/ (Capacitor APKs; release.sh calls it, and
#                                  scripts/build-finance-apk.sh is it with `finance`)
#   scripts/build-finance-desktop.sh  finance.html -> the Tauri desktop program's bundled frontend
# Extracted from build-steward-apk.sh on 2026-11-18 (T1Finance desktop plan step 1). The APK www/ it writes is
# byte-identical to what that script wrote before, plus one file since 2026-11-19: the .collect-app-page-output
# marker (see the refusal below); scripts/console-apk-build-steward-or-finance.test.mjs runs both.
#
# DERIVED FROM THE PAGE, NOT HAND-LISTED — because the hand list drifted, and shipped a dead app.
#
# This used to be an explicit `cp app/icons.jsx app/stew-modal.jsx …` naming every file. On 2026-08-17
# `app/error-boundary.jsx` was added to steward.html and not to that list, so the APK shipped without it,
# steward-root.js threw `ReferenceError: TrinityErrorBoundary is not defined` at mount, React never rendered,
# and the console sat on "Opening your console… Getting your church ready" for ever. Two days and 31 commits
# went by unnoticed: every console test runs HEADLESS against the repo root, where every file exists, so only
# the packaged app was broken and only a phone could show it. (The commit that caused it was called "a render
# crash stops being a silent white screen".) vendor/recovery.js, sw-register.js and the icons were missing
# too — the restore path and the launcher art.
#
# So the page is the source of truth: copy every local file it references, and FAIL if one is missing rather
# than shipping an app that dies at mount. Run from the repo root.
set -euo pipefail
PAGE="${1:?usage: $0 <page.html> <out-dir>}"
OUT="${2:?usage: $0 <page.html> <out-dir>}"
[ -f "$PAGE" ] || { echo "✖ $PAGE does not exist" >&2; exit 1; }

# <out> is DELETED and rebuilt, so refuse anything that is not plainly ours to delete: /, the repo root or any folder
# above it, $HOME or any folder above it, a file, and any existing non-empty folder that does not carry the marker
# this script writes into every output. (`build-finance-desktop.sh .` once meant `rm -rf` of the whole checkout.)
# A fixed build folder that predates the marker (www/, the desktop dist/) is cleared by its own build script.
MARK=".collect-app-page-output"
node -e '
const fs = require("fs"), path = require("path");
const [out, mark] = process.argv.slice(1);
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const abs = real(out), repo = real("."), home = process.env.HOME ? real(process.env.HOME) : null;
const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const no = (why) => { console.error("✖ refusing to use " + JSON.stringify(out) + " as the output folder: " + why); process.exit(1); };
if (abs === path.parse(abs).root) no("it is the filesystem root");
if (within(repo, abs)) no("it is the repo root, or a folder that contains it");
if (home && within(home, abs)) no("it is your home folder, or a folder that contains it");
if (!fs.existsSync(abs)) process.exit(0);
if (!fs.lstatSync(out).isDirectory() || fs.lstatSync(out).isSymbolicLink()) no("it exists and is not a plain folder");
const items = fs.readdirSync(abs);
if (items.length && !items.includes(mark)) no("it is a non-empty folder this script did not write (no " + mark + "). Delete it yourself if it is a stale build.");
' "$OUT" "$MARK"
rm -rf "$OUT"; mkdir -p "$OUT/vendor"
printf 'Written by scripts/collect-app-page.sh: this folder is a generated build output, deleted and rebuilt on every build.\n' > "$OUT/$MARK"
cp "$PAGE" "$OUT/index.html"
cp -r vendor/fonts "$OUT/vendor/"

echo "collecting the files $PAGE references…"
REFS=$(grep -oE '(href|src)="[^"]+"' "$PAGE" | sed 's/.*="//;s/"//' | grep -vE '^https?:|^#|^data:' | sort -u)
for f in $REFS; do
  # babel is deliberately dropped: the JSX below is pre-transpiled, and runtime Babel is unreliable in a packaged
  # webview (it is also what the strict, eval-free CSP exists to allow us to turn off).
  [ "$f" = "vendor/babel.min.js" ] && continue
  [ "$f" = "vendor/fonts/fonts.css" ] && continue   # came with vendor/fonts above
  if [ ! -f "$f" ]; then echo "✖ $PAGE references $f, which does not exist — fix the page or add the file" >&2; exit 1; fi
  mkdir -p "$OUT/$(dirname "$f")"
  cp "$f" "$OUT/$f"
done

# pre-transpile JSX -> JS (runtime Babel is unreliable in a packaged webview, and the strict CSP forbids eval)
echo "transpiling $PAGE JSX -> JS…"
for f in "$OUT"/app/*.jsx; do
  base="$(basename "$f" .jsx)"
  ./node_modules/.bin/esbuild "$f" --jsx=transform --log-level=error --outfile="$OUT/app/$base.js"
  rm "$f"
done
# Edited with node, NOT `sed -i` (GNU-only: macOS's BSD sed reads `-i -e` as a backup suffix "-e"); the desktop
# program is built on a Mac too. Same edit as the sed it replaced: drop every line naming babel.min.js, and point
# each <script type="text/babel" src="X.jsx"> at X.js — output byte-identical (checked against the sed build).
node -e '
const fs = require("fs"), f = process.argv[1];
const lines = fs.readFileSync(f, "utf8").split("\n").filter((l) => !/babel\.min\.js/.test(l))
  .map((l) => l.replace(/<script type="text\/babel" src="([^"]*)\.jsx">/g, "<script src=\"$1.js\">"));
fs.writeFileSync(f, lines.join("\n"));
' "$OUT/index.html"
