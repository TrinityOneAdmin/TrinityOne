#!/usr/bin/env bash
# Generate apks.html — a self-serve index of the branch APKs sitting in the repo root
# (which the gateway serves). Re-run after building an APK and the page refreshes:
#   bash scripts/build-apk-index.sh
# Reachable over Tailscale at  https://<gateway-host>/apks.html
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="apks.html"

# friendly metadata per APK stem: "Title|branch|description". Unknown APKs still list
# (filename + size + date), so new branches appear automatically — add a line to taste.
meta() {
  case "$1" in
    trinityone)                 echo "TrinityOne — member (Pilot)|main|The member app: Scripture, community, library. Pilot build (0.9.x). The main APK to test.";;
    trinityone-steward)         echo "TrinityOne — Steward (Pilot)|main|The steward console: create & manage a church on a phone. Separate app ID (com.trinityone.steward), installs alongside the member build.";;
    trinityone-all)             echo "All features (everything)|claude/all-features|Notifications + DM dot + settings + currency, ecash-at-rest security, name-clash, and the full CCEL library incl. a Church Fathers shelf. The one member APK to test.";;
    trinityone-steward-all)     echo "Steward console (all)|claude/all-features|Steward console with QR handoff + responsive mobile layout. Separate app ID (com.trinityone.steward), installs alongside the member build.";;
      trinityone-test-bundle)     echo "Test bundle (4 branches)|claude/test-bundle|Notifications + settings + currency, security hardening (ecash-at-rest), name-clash disambiguation, and the CCEL Christian library (books download on demand). The main build to test.";;
    trinityone-steward-app)     echo "Steward console|claude/steward-app|The Steward app — create & manage a church on a phone. Separate app ID (com.trinityone.steward), installs alongside a member build.";;
    trinityone-steward-handoff) echo "Steward + handoff|claude/steward-handoff|Steward console with multiple-stewards & handoff. Separate app ID, installs alongside a member build.";;
    trinityone-search)   echo "Search + BSB|claude/catalogue-search|Catalogue search from the Search screen (1,000+ translations). No Bibles embedded — BSB auto-downloads on first launch.";;
    trinityone-giving)   echo "Giving wallet|claude/giving|In-app self-custodial Cashu wallet — top up, hold a small balance, give in one tap. Bundles Bibles the old way.";;
    trinityone-debug)    echo "Main (latest release)|main|The current released build.";;
    trinityone-audio)    echo "Audio Bible|claude/audio|Listen-tab audio work.";;
    trinityone-schedule) echo "Release schedule|claude/release-schedule|Steward drip / scheduled publishing.";;
    trinityone-people)   echo "People|claude/people|Member directory work.";;
    lumen-debug)         echo "Lumen (legacy)|—|Older build, kept for reference.";;
    *)                   echo "${1}|—|Branch build.";;
  esac
}

esc() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }

# newest first
mapfile -t APKS < <(ls -1t *.apk 2>/dev/null || true)

{
cat <<'HEAD'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>TrinityOne · Builds</title>
<style>
  :root{ --ink:#221C16; --ink2:#6B6052; --ink3:#A89E8E; --paper:#F4EEE2; --surface:#FFFDF8;
         --line:rgba(34,28,22,.12); --clay:#C25A38; --clay-deep:#9C4327; --gold:#C8962E; --sage:#5E8C6A; }
  *{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body{ margin:0; font-family:'Sora',system-ui,-apple-system,sans-serif; color:var(--ink);
        background:radial-gradient(120% 80% at 50% 0%, #F7EFDF, #E4DBC9); min-height:100vh; padding:28px 16px 60px; }
  .wrap{ max-width:680px; margin:0 auto; }
  header{ display:flex; align-items:center; gap:13px; margin:6px 2px 22px; }
  .mark{ width:44px; height:44px; border-radius:13px; background:linear-gradient(155deg,var(--clay),var(--clay-deep));
         display:flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:20px; box-shadow:0 8px 22px rgba(34,28,16,.18); }
  h1{ font-size:23px; font-weight:800; margin:0; letter-spacing:-.4px; }
  .sub{ font-size:13px; color:var(--ink2); margin-top:2px; }
  .note{ font-size:12.5px; color:var(--ink2); background:var(--surface); border:1px solid var(--line); border-radius:14px;
         padding:12px 15px; margin-bottom:18px; line-height:1.5; }
  .card{ display:block; text-decoration:none; color:inherit; background:var(--surface); border:1px solid var(--line);
         border-radius:18px; padding:16px 17px; margin-bottom:13px; box-shadow:0 1px 2px rgba(34,28,16,.05),0 8px 20px rgba(34,28,16,.06);
         transition:transform .12s ease, box-shadow .12s ease; }
  .card:active{ transform:scale(.99); }
  .row{ display:flex; align-items:center; gap:12px; }
  .ic{ width:42px; height:42px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
       background:color-mix(in oklab, var(--gold) 16%, var(--surface)); color:var(--gold); font-size:20px; font-weight:800; }
  .ttl{ font-size:16.5px; font-weight:800; line-height:1.15; }
  .br{ display:inline-block; font-family:ui-monospace,monospace; font-size:11px; font-weight:700; color:var(--clay);
       background:color-mix(in oklab,var(--clay) 12%,var(--surface)); border:1px solid color-mix(in oklab,var(--clay) 24%,transparent);
       border-radius:999px; padding:2px 9px; margin-top:5px; }
  .desc{ font-size:13px; color:var(--ink2); line-height:1.5; margin:9px 0 0; }
  .meta{ font-size:11.5px; color:var(--ink3); font-weight:600; margin-top:9px; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .sha{ font-family:ui-monospace,monospace; font-size:10.5px; color:var(--ink3); background:color-mix(in oklab,var(--ink) 4%,var(--surface));
        border:1px solid var(--line); border-radius:6px; padding:3px 7px; word-break:break-all; user-select:all; }
  details.sha-block{ margin-top:8px; font-size:11.5px; color:var(--ink2); }
  details.sha-block > summary{ cursor:pointer; color:var(--clay); font-weight:700; outline:none; }
  details.sha-block code{ font-family:ui-monospace,monospace; font-size:11px; background:color-mix(in oklab,var(--ink) 5%,var(--surface)); border-radius:5px; padding:1px 5px; }
  .dl{ margin-left:auto; flex-shrink:0; display:inline-flex; align-items:center; gap:6px; background:var(--clay); color:#fff;
       font-weight:700; font-size:13.5px; padding:9px 15px; border-radius:999px; }
  footer{ text-align:center; color:var(--ink3); font-size:11.5px; margin-top:26px; line-height:1.6; }
</style>
</head>
<body><div class="wrap">
  <header>
    <div class="mark">T1</div>
    <div><h1>TrinityOne · Builds</h1><div class="sub">Branch APKs — tap to download &amp; install</div></div>
  </header>
  <div class="note">The <b>member</b> builds share one app ID, so installing one replaces another (test them one at a time). The <b>Steward</b> builds use a separate app ID and install alongside a member build. Allow “install unknown apps” for your browser the first time.</div>
HEAD

for f in "${APKS[@]}"; do
  [ -f "$f" ] || continue
  stem="${f%.apk}"
  IFS='|' read -r title branch desc <<<"$(meta "$stem")"
  bytes=$(stat -c%s "$f" 2>/dev/null || echo 0)
  human=$(numfmt --to=iec --suffix=B "$bytes" 2>/dev/null || echo "${bytes}B")
  when=$(date -d "@$(stat -c%Y "$f" 2>/dev/null || echo 0)" "+%b %-d, %H:%M" 2>/dev/null || echo "")
  # SECURITY-AUDIT-2026-06-24 M10: publish per-file SHA-256 alongside the download so a user
  # installing from any mirror (Tailscale Funnel, friend church's relay, sneakernet, install-anywhere)
  # can verify the bytes against this canonical page. Run sha256sum on the downloaded file and
  # the hash MUST match. Without this, a swap on any mirror goes undetected.
  sha=$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)
  initial=$(printf '%s' "$title" | cut -c1 | tr '[:lower:]' '[:upper:]')
  printf '  <a class="card" href="%s">\n' "$(printf '%s' "$f" | esc)"
  printf '    <div class="row">\n'
  printf '      <div class="ic">%s</div>\n' "$(printf '%s' "$initial" | esc)"
  printf '      <div style="min-width:0"><div class="ttl">%s</div><div class="br">%s</div></div>\n' "$(printf '%s' "$title" | esc)" "$(printf '%s' "$branch" | esc)"
  printf '      <span class="dl">↓ %s</span>\n' "$human"
  printf '    </div>\n'
  printf '    <p class="desc">%s</p>\n' "$(printf '%s' "$desc" | esc)"
  printf '    <div class="meta">%s · built %s</div>\n' "$(printf '%s' "$f" | esc)" "$(printf '%s' "$when" | esc)"
  printf '    <details class="sha-block"><summary>Verify (SHA-256)</summary><div style="margin-top:6px">After downloading, run <code>sha256sum %s</code> — the result must match the hash below:</div><div class="sha" style="margin-top:6px">%s</div></details>\n' "$(printf '%s' "$f" | esc)" "$(printf '%s' "$sha" | esc)"
  printf '  </a>\n'
done

cat <<FOOT
  <footer>Generated $(date "+%b %-d %H:%M") · scripts/build-apk-index.sh · debug builds, served over Tailscale</footer>
</div></body></html>
FOOT
} > "$OUT"

echo "wrote $OUT (${#APKS[@]} APKs)"
