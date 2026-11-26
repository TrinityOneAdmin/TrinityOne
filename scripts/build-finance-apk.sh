#!/usr/bin/env bash
# Build "TrinityOne Finance" (trinityone-finance.apk, com.trinityone.finance): finance.html — the church books
# and nothing else, for a church's treasurer or finance helper — as its own Android app.
# It is the Steward console's build with the finance identity; every step (and the member project being put
# back on exit, success or failure) lives in the one shared script:
exec bash "$(dirname "$0")/build-steward-apk.sh" finance
