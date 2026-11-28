// finance-mode.js — the ONE switch that makes finance.html the "TrinityOne Finance" app.
// Loaded by finance.html BEFORE every other script, and by no other page. It is an external file on purpose:
// scripts/build-pages.sh aborts on an inline <script> and the strict CSP (script-src 'self') would block one.
// Read by app/steward-root.jsx (StewardRoot, initChurch, StewardWelcome), app/finance-shell.jsx and
// src/steward.src.js (requestSteward's sealed app hint). Nothing reads it as a permission: the relay decides
// what a helper key may do, never this flag.
window.TRINITY_APP = 'finance';
