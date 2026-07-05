# Refactor plan — addressing the code-review feedback

External review flagged: (1) the repo root is spammed with files, (2) several files exceed 1,000 lines, (3) comments are long, (4) it needs more modularity/hierarchy, (5) it isn't DRY. All fair. This is the plan to address each — what's already done, and what's staged (and why).

## The one constraint that shapes everything

The `.jsx` files are **classic scripts sharing one global scope** (see [`../ARCHITECTURE.md`](../ARCHITECTURE.md)). Splitting or moving them can silently blank the packaged app if a name collides or a load-order breaks — and that only reliably shows up on an **on-device boot-check** (CDP over adb). So:

- **Build-verifiable changes** (docs, `.mjs`/`.src.js` engines, tests) can be done any time — a bundle/`node --check`/test proves them.
- **Classic-script changes** (`.jsx` splits/moves, the hook factory) are **staged for a session with the phone attached**, where the boot-check is the gate.

This is why the risky items below are *planned, not yet done* — not because they're unclear, but because they shouldn't land unverified.

---

## ✅ Done (this pass — safe, build-verifiable)

- **Docs out of root into `docs/`** — `guides/`, `design/`, `ops/`, `security/`. Root `.md` went from **20 → 4** (only `README`, `ARCHITECTURE`, `CONTRIBUTING`, `SECURITY` — the GitHub-convention files — remain). Every markdown/HTML link updated and verified with a link-checker (0 broken). Code comments that name a doc still resolve (the filename is unchanged), so no `vendor/` rebuilds were needed.
- **[`../ARCHITECTURE.md`](../ARCHITECTURE.md)** — a top-to-bottom map so the repo stops feeling like a pile (directly answers "struggled to get my head around it").
- **[`README.md`](README.md) (this index)** — every doc, categorised, one line each.

---

## P1 — Root code-file organization (the rest of the "index spam")

Root still has **44 `.jsx` + 19 `.html`**. Group them into folders:

```
screens/     screens-*.jsx, app.jsx, ui.jsx, data.jsx, identity*.jsx, help-*.jsx   (member app)
steward/     stew-*.jsx, steward-root.jsx                                          (console)
pages/       welcome.html, pilot-features.html, migrate.html, landing-*.html …     (static/marketing)
```

**Risk:** `index.html` / `steward.html` reference every file by relative path, and `sync-web.sh` / `build-steward-apk.sh` copy them by name. **Approach:** one atomic pass per app — move files, update the HTML `<script src>` list *and* the build-script copy lists in lockstep, then transpile + dup-global scan + **APK boot-check**. Do member and steward separately so a break is easy to bisect.

## P2 — Split the >1,000-line files

| File | Lines | Kind | Split into | Verify |
|---|---|---|---|---|
| `stew-dashboard.jsx` | 4070 | classic | one file per section (`stew-dash-overview/groups/rota/calendar/rooms/members/settings`.jsx) + the settings panels | boot-check |
| `src/steward.src.js` | 1595 | engine | by concern: identity, publish, subscribe, per-feature CRUD | build + light boot-check |
| `screens-chat.jsx` | 1462 | classic | chat list / thread / composer / search | boot-check |
| `src/fellowship.src.js` | 1387 | engine | transport / subscriptions / church-feed | build + light boot-check |
| `app.jsx` | 1339 | classic | shell / routing / boot / context | boot-check |
| `scripts/gateway.mjs` | 1336 | **.mjs** | `doc-model.mjs` (kinds/d-tags), `accept.mjs`, `can-read.mjs`, `serve.mjs` (HTTP), `req.mjs` (WS) | **`node --check` + relay smoke — no device needed** |
| `stew-schedule.jsx` | 1022 | classic | calendar / rooms / run-sheets | boot-check |

**Start with `gateway.mjs`** — it's the highest-value split *and* the only one fully verifiable without the phone. Then the engines. Then the `.jsx` with the phone attached.

## P3 — DRY

- **The poster child:** `steward-root.jsx` has **~32 near-identical hooks** — every one is `const idv = useStewardIdv(); const [x,setX] = useSt(init); useStE(() => Steward.subscribeX(setX), [idv]); return x;`. Collapse to a factory:
  ```js
  const makeSub = (sub, init) => () => {
    const idv = useStewardIdv(); const [v, setV] = useSt(init);
    useStE(() => (window.Steward[sub] ? window.Steward[sub](setV) : undefined), [idv]); return v;
  };
  window.useStewardGroups = makeSub('subscribeGroups', []);   // …×32
  ```
  ~250 lines → ~50. (Classic-script → boot-check.)
- **Shared UI helpers:** money-format, the modal shell, field styles, and the `encPublish`/`encSubscribe` doc-CRUD shape are copied across `stew-*.jsx`. Lift into `ui.jsx` / a small `stew-ui.jsx`.

## Comment style

Not a separate pass — do it *as files are touched* above. Rule of thumb: **keep the "why" and the non-obvious; cut anything that just restates the code or over-explains.** The goal is comments that earn their line, not zero comments.

## Verification protocol (the gate for every refactor)

1. `node --test scripts/*.test.mjs` — engine/ledger tests stay green.
2. esbuild-transpile every touched `.jsx` — catches syntax.
3. **Dup-global scan** — no colliding top-level names across classic scripts.
4. `node --check` + relay smoke — for `gateway.mjs`.
5. **On-device APK boot-check (CDP)** — the hard gate for *any* classic-script change.

## Suggested order

1. `gateway.mjs` split (no device). 2. Engine splits (`steward`, `fellowship`). 3. The DRY hook factory + shared UI helpers (with phone). 4. `stew-dashboard.jsx` split (biggest win, with phone). 5. Remaining `.jsx` splits. 6. Root folder move, per app.

Each is an independent, revertable commit — nothing here is big-bang.
