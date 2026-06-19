# Contributing to TrinityOne

Thanks for your interest — TrinityOne is built for the church, owned by no one, and contributions are welcome.

## Ground rules

- **Be kind.** This is a project for churches; keep discussion respectful and constructive.
- **License.** By contributing you agree your work is licensed under the project's [AGPL-3.0](LICENSE).
- **Security issues go to [SECURITY.md](SECURITY.md), not public issues.**

## Getting set up

```bash
npm install
node scripts/gateway.mjs 8000        # app + local relay on :8000
# member app:  http://localhost:8000        ·  console:  http://localhost:8000/steward.html
```

The app is plain `index.html` + in-browser-transpiled `*.jsx` (no bundler for the UI). Two pieces are esbuild-bundled from `src/` → `vendor/` (`build-identity.sh`, `build-fellowship.sh`, `build-steward-finance.sh`).

## Before you open a PR

- **Keep it consistent.** Match the surrounding code's style, naming, and comment density — read like the file you're editing.
- **No duplicate top-level names.** The `.jsx` files are classic scripts sharing one global scope per app; a duplicate `function`/`const` name across files loaded by the same page will blank the app. Check both `index.html` and `steward.html` script lists.
- **Sanity-check it loads.** Open both apps and confirm the console is error-free before pushing.
- **Don't commit secrets or build cruft** — see `.gitignore`. Never commit private keys, admin tokens, relay databases, or APKs.
- **Branches:** work on a `claude/`- or feature-prefixed branch; `main` is the release line.

## What's most useful

See [`reference/SPINE.md`](reference/SPINE.md) for the roadmap and the open security-audit items. Good first areas: accessibility, translations/i18n, additional Bible-module formats, and relay hardening.
