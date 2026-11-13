#!/usr/bin/env bash
# TrinityOne relay data move -- the ROOT helper (relay storage plan step 6, section 2 "R2"). Started by
# trinityone-move.path -> trinityone-move.service when the relay drops <data folder>/.move-request or
# .remove-old-request (the panel's "Where this relay keeps its data" card). The relay is sandboxed and can only write a
# request file; everything that needs root happens here, and the request is treated as HOSTILE:
#
#   MOVE        1. read the request without following a link, delete it (it is one-shot: never re-created)
#               2. STOP THE RELAY UNIT OURSELVES. The unit has Restart=always, so the relay's own exit 0 after writing a
#                  request would be restarted three seconds later, onto the folder we are about to move
#               3. judge the drive ourselves (relay-move-server.mjs validate): fstab mount, mounted, local filesystem,
#                  nothing under the app or a system folder, no link on the way, root-owned parents
#               4. make the target folder (root, 0700, owned by the service user) and run scripts/relay-move.mjs AS THE
#                  SERVICE USER against a scratch copy of the journal -- so a compromised relay can read and write
#                  nothing it could not already, and cannot forge the root journal
#               5. check the scratch journal names the folders WE chose, then copy it into the root journal
#               6. record the new folder (relay.env + systemd drop-ins), fix ownership and 0700/0600
#               7. beginCheck BEFORE the relay starts (exact row counts: nothing has run on the new folder yet)
#               8. start the relay; prove its identity with a signature over a nonce of our choosing (/relay-identity,
#                  rule 10 -- never the bare /status string); compare; keep the move or ROLL BACK
#   REMOVE OLD  delete the recorded old copy / leftover, and only that; re-check at the moment of deletion that it is not,
#               and does not hold or sit inside, the live folder. The MOVED-TO note stays as a tombstone.
#
# Every refusal is written into the root-owned journal (/var/lib/trinityone/move-state.json, 0644 so the relay can
# show it in GET /storage). Nothing here ever writes a request file.
set -uo pipefail
umask 022
DIR="${TRINITYONE_DIR:-/opt/trinityone}"
SVC="${TRINITYONE_SVC:-trinityone-relay}"
PORT="${TRINITYONE_PORT:-8000}"
SVC_USER="${TRINITYONE_USER:-trinityone}"
ETC="${TRINITYONE_ETC:-/etc/trinityone}"
STATE_DIR="${TRINITYONE_STATE_DIR:-/var/lib/trinityone}"
FSTAB="${TRINITYONE_FSTAB:-/etc/fstab}"
MOUNTINFO="${TRINITYONE_MOUNTINFO:-/proc/self/mountinfo}"
ROOT_UID="${TRINITYONE_ROOT_UID:-0}"
CHECK_FROM="${TRINITYONE_OWNER_CHECK_FROM:-/}"      # a test sets this; a real box never does
NODE="${TRINITYONE_NODE:-$(command -v node || echo node)}"
PROVE_TRIES="${PROVE_TRIES:-60}"                    # x PROVE_SLEEP seconds: how long the new relay has to come up
PROVE_SLEEP="${PROVE_SLEEP:-2}"
SRV="$DIR/scripts/relay-move-server.mjs"; MV="$DIR/scripts/relay-move.mjs"; APPLY="$DIR/scripts/relay-datadir-apply.sh"
RELAY_ENV="$ETC/relay.env"
STATE="$STATE_DIR/move-state.json"; WORK="$STATE_DIR/work"; REQ="$STATE_DIR/request.json"
LOGF="$STATE_DIR/move.log"
PENDING="$STATE_DIR/pending-move.json"        # root-written: which move the mover was started on (boot recovery reads it)
LOCK="$STATE_DIR/update-move.lock"; LOCK_WAIT="${TRINITYONE_LOCK_WAIT:-1800}"
MODE="${1:-}"                                   # "" = act on a request; --recover-only = boot; --finish-check = after the relay started

mkdir -p "$STATE_DIR" "$WORK"
chmod 0755 "$STATE_DIR"
log() { printf '%s  %s\n' "$(date -Is)" "$*" | tee -a "$LOGF" >&2; }
srv() { "$NODE" "$SRV" "$@"; }
jget() {   # jget <key>   (JSON on stdin) -> the value, or nothing
  "$NODE" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v===undefined||v===null?"":(typeof v==="object"?JSON.stringify(v):String(v)))}catch{}})' "$1"
}
datadir() {
  local d=""
  [ -r "$RELAY_ENV" ] && d="$(sed -n 's/^TRINITY_DATA_DIR=//p' "$RELAY_ENV" 2>/dev/null | head -n1)"
  case "$d" in /*) printf '%s' "$d";; *) printf '%s' "$DIR/relay";; esac
}
apply() { TRINITYONE_ETC="$ETC" TRINITYONE_STATE_DIR="$STATE_DIR" TRINITYONE_SVC="$SVC" bash "$APPLY" "$@"; }
relay_active() { systemctl is-active --quiet "$SVC"; }
STOPPED_BY_US=0; LEAVE_STOPPED=0; TUN_WAS=0
start_relay() {
  systemctl start "$SVC" && STOPPED_BY_US=0
  if [ "$TUN_WAS" = 1 ]; then systemctl start "$SVC-tunnel" >/dev/null 2>&1 || true; fi   # it Requires= the relay, so it went down with it
}
stop_relay() { STOPPED_BY_US=1; systemctl stop "$SVC" || log "systemctl stop $SVC reported an error"; }
# whatever happens below, never leave the relay stopped by accident (a relay we mean to leave stopped sets LEAVE_STOPPED)
trap 'if [ "$STOPPED_BY_US" = 1 ] && [ "$LEAVE_STOPPED" = 0 ] && ! relay_active; then log "starting the relay again on the way out"; start_relay; fi' EXIT

# Ownership by chown -R (it does not follow links). The 0600s are done AS THE SERVICE USER and only on a regular file
# (audit C M3): root's chmod follows a link the running relay planted, so a relay could make root chmod a file of its choice.
fix_perms() {   # fix_perms <folder>
  local d="$1" f files=()
  chown -R "$SVC_USER:$SVC_USER" "$d" 2>/dev/null || true
  if [ -d "$d" ] && [ ! -L "$d" ]; then chmod 0700 -- "$d" 2>/dev/null || true; fi
  for f in admin.json relay-key.json vapid.json release-key.pem; do files+=("$d/$f"); done
  runuser -u "$SVC_USER" -- bash -c 'for f; do if [ -f "$f" ] && [ ! -L "$f" ]; then chmod 0600 -- "$f"; fi; done' _ "${files[@]}" 2>/dev/null || true
  return 0
}

DATA="$(datadir)"
# ONE LOCK FOR "Update now" AND A MOVE (audit C M2): relay-update.sh takes the same file. A move waits for a running
# update; an update that finds a move running refuses. Without it the update's restart could start the relay on the old
# folder in the middle of a copy and the move would "stand" with the live relay writing into a folder marked MOVED-TO.
exec 9>"$LOCK"
# BOOT RECOVERY NEVER WAITS (audit N2): it is ordered Before= the relay, so a wait here holds the relay back. If another root job
# already has the lock, that job is a move helper (which recovers an interrupted move itself, at its start) or an update (which
# touches no move state); either way recovery has nothing to add right now.
# --finish-check is killed by its unit at 900 s, so it waits for the lock less than that (600 s) whatever LOCK_WAIT says
FLOCK_ARGS=(-w "$LOCK_WAIT"); [ "$MODE" = --recover-only ] && FLOCK_ARGS=(-n); [ "$MODE" = --finish-check ] && FLOCK_ARGS=(-w "${TRINITYONE_FINISH_LOCK_WAIT:-600}")
if ! flock "${FLOCK_ARGS[@]}" 9 2>/dev/null; then
  log "another root job holds $LOCK${MODE:+ (mode $MODE: not waiting)}"
  if [ -z "$MODE" ]; then
    # consume whatever was asked, say why in the journal, touch nothing else
    for f in .move-request .remove-old-request; do
      if [ -e "$DATA/$f" ] || [ -L "$DATA/$f" ]; then srv take-request --file "$DATA/$f" --out "$REQ" >/dev/null 2>&1; rm -f "$REQ"; fi
    done
    srv refuse --state "$STATE" --code update-in-progress --from "$DATA" >/dev/null
  fi
  exit 0
fi
chown "$SVC_USER:$SVC_USER" "$WORK" 2>/dev/null || true; chmod 0700 "$WORK"
systemctl is-active --quiet "$SVC-tunnel" 2>/dev/null && TUN_WAS=1

# ROLL BACK a move whose check failed (or whose record could not be written). The relay is stopped, the mover's own
# rollback puts the folders back (and refuses to leave two startable copies), relay.env follows, the relay starts.
rollback_flow() {   # rollback_flow <why>
  log "ROLLING BACK the move: $1"
  relay_active && stop_relay
  local r d; r="$(srv rollback --state "$STATE")"; log "rollback: $r"
  d="$(printf '%s' "$r" | jget dataDir)"
  if [ -n "$d" ]; then
    apply "$d" || log "could not record $d in relay.env -- check $RELAY_ENV by hand"
    DATA="$d"; fix_perms "$d"; start_relay
  else
    LEAVE_STOPPED=1
    log "the rollback could not finish, so the relay is LEFT STOPPED rather than started on a folder that may not be the right one; see $STATE"
  fi
}

# The step-8 check. beginCheck runs BEFORE the relay starts; the identity is proven after, by signature.
# verify_started: the relay is up on <cur>: prove it is the same relay, compare, keep the move or roll back.
verify_started() {   # verify_started <folder> <pub>
  local cur="$1" pub="$2" r
  r="$(srv prove --port "$PORT" --pub "$pub" --tries "$PROVE_TRIES" --interval "$PROVE_SLEEP")" || { rollback_flow "the relay on the new folder could not prove it is the same relay ($r)"; return; }
  r="$(srv compare --state "$STATE" --pub "$pub")" || { rollback_flow "the new folder does not hold what the old one did ($r)"; return; }
  fix_perms "$cur"
  r="$(srv pass --state "$STATE")"; log "move stands: $r"
}
finish_check() {
  local cur pub r
  # the unit must be down while the exact counts are taken (audit C M2: nothing may have written before beginCheck)
  if relay_active; then log "the relay unit is running before the check; stopping it first"; stop_relay; fi
  r="$(srv begin-check --state "$STATE")" || { log "begin-check failed: $r"; rollback_flow "the copy did not pass the check before the relay started ($r)"; return; }
  cur="$(srv pointer --state "$STATE" | jget dataDir)"; pub="$(srv current-pub --dir "$cur" | jget pub)"
  fix_perms "$cur"                       # begin-check opened the database as root
  start_relay                            # <- AFTER begin-check: the relay must never write before the exact counts are on record
  verify_started "$cur" "$pub"
}

# BOOT RECOVERY (audit C M1), run by trinityone-move-recover.service BEFORE the relay unit starts. It never starts or stops
# the relay (the unit is ordered after it; starting it from here would deadlock). A helper killed mid-copy leaves the
# journal 'copying' (the card would say "under way" for ever and the gateway would refuse every new request), and a
# helper killed between the mover's switch and the relay.env write leaves the old folder marked MOVED-TO, so the relay
# would refuse it (exit 78) and stay down. The pending-move file says which move the scratch journal belongs to.
recover_boot() {
  local r d a
  if [ -f "$PENDING" ]; then
    log "boot: a move was under way when this box stopped -- reading what the mover left"
    r="$(srv absorb-pending --state "$STATE" --work "$WORK" --pending "$PENDING")"; log "boot: absorb: $r"
    rm -f "$PENDING"
  fi
  if [ -f "$STATE" ] && [ "$(srv active --state "$STATE" | jget active)" = true ]; then
    log "boot: a data move was interrupted -- recovering before the relay starts"
    r="$(srv recover --state "$STATE")" || { log "boot: recovery refused: $r (the relay will refuse to start; see $STATE)"; return 0; }
    d="$(printf '%s' "$r" | jget dataDir)"; a="$(printf '%s' "$r" | jget action)"
    [ -n "$d" ] && [ "$d" != "$(datadir)" ] && { apply "$d" || log "boot: could not record $d in relay.env"; }
    if [ "$a" = check ] && [ -n "$d" ]; then
      r="$(srv begin-check --state "$STATE")" && fix_perms "$d" || log "boot: begin-check failed: $r (trinityone-move-finish rolls the move back)"
    fi
  fi
  return 0
}
# After the relay is up: if boot recovery left a check to finish, finish it (prove, compare, keep or roll back).
finish_after_boot() {
  local cur pub
  [ -f "$STATE" ] && [ "$(srv active --state "$STATE" | jget state)" = checking ] || return 0
  # Only a relay that IS running is checked. A relay an admin disabled must not be started by this unit, and (H-1) the unit has no
  # Requisite= on the relay: a rollback stops the relay from inside this script, which must not kill this script.
  relay_active || { log "after boot: the relay is not running, so there is nothing to check (and it is not started from here)"; return 0; }
  cur="$(srv pointer --state "$STATE" | jget dataDir)"; pub="$(srv current-pub --dir "$cur" | jget pub)"
  log "after boot: finishing the check of a recovered move"
  verify_started "$cur" "$pub"
}
case "$MODE" in
  --recover-only) recover_boot; exit 0;;
  --finish-check) finish_after_boot; exit 0;;
esac

# An earlier run killed part-way: put the folders in a state the relay can start from, before anything else.
recover_interrupted() {
  local r a d
  log "a data move was interrupted -- recovering"
  relay_active && stop_relay
  r="$(srv recover --state "$STATE")" || { log "recovery refused: $r -- leaving the relay stopped"; LEAVE_STOPPED=1; return 1; }
  d="$(printf '%s' "$r" | jget dataDir)"; a="$(printf '%s' "$r" | jget action)"
  [ -n "$d" ] && [ "$d" != "$DATA" ] && { apply "$d" || log "could not record $d in relay.env"; DATA="$d"; }
  if [ "$a" = check ]; then finish_check; else start_relay; fi
  return 0
}
if [ -f "$STATE" ] && [ "$(srv active --state "$STATE" | jget active)" = true ]; then recover_interrupted; DATA="$(datadir)"; fi

# ── REMOVE OLD COPY ───────────────────────────────────────────────────────────────────────────────────────────
handle_remove_old() {
  local r
  if ! r="$(srv take-request --file "$DATA/.remove-old-request" --out "$REQ")"; then
    log "remove-old request unreadable: $r"; srv refuse --state "$STATE" --code "$(printf '%s' "$r" | jget code)" >/dev/null; return
  fi
  r="$(srv remove-old --state "$STATE" --request "$REQ" --live "$DATA" --run-as-user "$SVC_USER")"; local rc=$?
  rm -f "$REQ"
  log "remove-old: $r"
  [ "$rc" != 0 ] && [ "$(printf '%s' "$r" | jget code)" = not-recorded ] && srv refuse --state "$STATE" --code remove-not-recorded >/dev/null
  return 0
}
if [ -e "$DATA/.remove-old-request" ] || [ -L "$DATA/.remove-old-request" ]; then handle_remove_old; fi

# ── MOVE ──────────────────────────────────────────────────────────────────────────────────────────────────────
refuse_and_restart() {   # refuse_and_restart <code> [detail]
  log "move refused: $1 ${2:-}"
  srv refuse --state "$STATE" --code "$1" ${2:+--detail "$2"} --from "$DATA" >/dev/null
  start_relay
}
handle_move() {
  local r drive target out rc code detail ab created=0 stamp
  if ! r="$(srv take-request --file "$DATA/.move-request" --out "$REQ")"; then
    log "move request unreadable: $r"; srv refuse --state "$STATE" --code "$(printf '%s' "$r" | jget code)" --from "$DATA" >/dev/null
    relay_active || { STOPPED_BY_US=1; start_relay; }; return
  fi
  stop_relay
  if relay_active; then log "the relay unit would not stop; not touching its folder"; STOPPED_BY_US=0; srv refuse --state "$STATE" --code could-not-stop --from "$DATA" >/dev/null; return; fi

  r="$(srv validate --request "$REQ" --fstab "$FSTAB" --mountinfo "$MOUNTINFO" --data-dir "$DATA" --code-dir "$DIR" --root-uid "$ROOT_UID" --check-from "$CHECK_FROM")" \
    || { rm -f "$REQ"; refuse_and_restart "$(printf '%s' "$r" | jget code)" "$(printf '%s' "$r" | jget detail)"; return; }
  rm -f "$REQ"
  drive="$(printf '%s' "$r" | jget drive)"; target="$(printf '%s' "$r" | jget target)"
  "$NODE" -e 'require("node:sqlite")' >/dev/null 2>&1 || { refuse_and_restart node-too-old "this box's Node cannot open the relay database the way the mover needs (Node 22.13 or newer)"; return; }

  # the target folder: ours, 0700, the service user's. The parents are root-owned, so only root can make it.
  if [ ! -e "$target" ]; then mkdir -m 0700 "$target" || { refuse_and_restart target-unwritable; return; }; created=1; fi
  chown "$SVC_USER:$SVC_USER" "$target" 2>/dev/null || true; chmod 0700 "$target"
  # SAME VOLUME = ONE ATOMIC RENAME (owner, plan 8a item 5). The service user cannot rename its own folder (the parents are
  # root-owned), so for that case ONLY the mover runs as root. A cross-volume copy still runs as the service user.
  # Either way the journal is the scratch one and is checked before it is believed.
  AS_USER=(runuser -u "$SVC_USER" --)
  if [ "$(stat -c %d "$target")" = "$(stat -c %d "$DATA")" ]; then AS_USER=(); log "same volume: the rename runs as root, nothing else does"; fi
  srv seed --state "$STATE" --work "$WORK" --from "$DATA" >/dev/null && chown -R "$SVC_USER:$SVC_USER" "$WORK" 2>/dev/null
  printf '{"from":"%s","target":"%s"}\n' "$DATA" "$target" > "$PENDING"; chmod 0600 "$PENDING"   # boot recovery reads this
  out="$(${AS_USER[@]+"${AS_USER[@]}"} "$NODE" "$MV" move --from "$DATA" --drive "$drive" --pointer "$WORK/state.json" --port "$PORT" --mode server)"; rc=$?
  log "mover (exit $rc): $out"
  ab="$(srv absorb --state "$STATE" --work "$WORK" --from "$DATA" --target "$target")"; local abrc=$?
  rm -f "$PENDING"
  if [ "$abrc" != 0 ]; then
    # the scratch journal is not believable: undo what the mover may have written, keep the old folder as it was
    log "the mover's journal was not accepted ($ab) -- putting the old folder back as it was"
    rm -f "$DATA/MOVED-TO"
    if [ -e "$target/relay-key.json" ]; then
      stamp="$(date +%s)"; printf 'This folder was set aside after a relay data move was not accepted. The relay data is in %s. Do not start a relay on this folder.\n' "$DATA" > "$target/MOVED-TO"
      mv "$target" "$target-failed-$stamp" 2>/dev/null
    elif [ "$created" = 1 ]; then rmdir "$target" 2>/dev/null; fi
    refuse_and_restart journal-not-accepted; return
  fi
  if [ "$rc" != 0 ]; then
    code="$(printf '%s' "$out" | jget code)"; detail="$(printf '%s' "$out" | jget detail)"
    if [ "$(srv active --state "$STATE" | jget active)" = true ]; then recover_interrupted; DATA="$(datadir)"; fi
    [ "$created" = 1 ] && rmdir "$target" 2>/dev/null
    log "move did not happen: ${code:-unknown} ${detail:-}"
    srv refuse --state "$STATE" --code "${code:-move-failed}" ${detail:+--detail "$detail"} --from "$DATA" >/dev/null
    relay_active || start_relay
    return
  fi

  # the data is on the new drive and the journal says 'switched'. Record the folder where systemd and the scripts read it.
  if ! apply "$target"; then rollback_flow "could not record the new folder in $RELAY_ENV"; return; fi
  DATA="$target"; fix_perms "$target"
  finish_check
}
if [ -e "$DATA/.move-request" ] || [ -L "$DATA/.move-request" ]; then handle_move; fi
exit 0
