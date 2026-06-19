# Security Policy

TrinityOne handles things that matter — a church's identity keys, private messages, children's safeguarding data, and giving records. We take that seriously and welcome responsible disclosure.

## Reporting a vulnerability

**Please email [31app@proton.me](mailto:31app@proton.me)** with:

- what you found and where (a file/URL/endpoint, or steps to reproduce),
- the impact you think it has, and
- anything we'd need to confirm it.

Please **do not** open a public GitHub issue for security problems, and please don't run tests against other churches' live relays or data.

We'll acknowledge your report, keep you posted while we investigate, and credit you when a fix ships (unless you'd prefer to stay anonymous). We're a small project, so please allow reasonable time to respond before any public disclosure.

## Scope

In scope:

- The member app and steward console (`*.jsx`, `index.html`, `steward.html`).
- The relay / gateway write & read policy (`scripts/gateway.mjs`) — membership gating, safeguarding enforcement, signature verification, the feed proxies.
- The identity / fellowship bundles (`src/identity.src.js`, `src/fellowship.src.js`).
- The encrypted backup format and the relay self-update signing.

Known and tracked (see `reference/SPINE.md` → Security audit):

- Identity keys live in page-scope storage on the web build — mitigated by a strict CSP, with an out-of-page signer (**Keykeeper**) planned. Reports that *bypass* the CSP are very much in scope.

## What we've already hardened

- **Strict CSP** on the production app shells (`script-src 'self'`, no `eval`).
- **SSRF guard** on the feed proxies (blocks localhost/LAN/CGNAT/cloud-metadata, re-checked per redirect).
- **Security headers** on the app and gateway (`X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options`).
- **Signature verification** on every relay event, plus per-connection rate limiting.
- **Safeguarding lists are owner-only** and enforced server-side.

Thank you for helping keep churches safe.
