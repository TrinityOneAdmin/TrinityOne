# Plugin: Connect cards & forms

*Post-pilot. Branch `claude/plugins`. Digital welcome/"connect" cards, event sign-ups, surveys and
feedback — privacy-respecting, encrypted, no Google Forms.*

See [`README.md`](README.md) for the plugin seam. Low infra cost, high convenience — a good **entry
tier** upsell and often a church's first paid plugin.

---

## The idea

A church builds a simple form — the **newcomer "connect card"** ("new here? tell us about you"), a
**sign-up** (kids' camp, rota interest, meal train), a **survey/feedback** — shares it (in-app, or a
public link/QR for the not-yet-on-the-app), and reads responses in the console. The classic
"fill-this-in" church moment, done without handing member data to a third party.

## Why it's a fair paid plugin

Low marginal cost (it's mostly data), so it's an **entry-tier convenience** rather than a cost-driven
one — but high value (every church does connect cards), and it's the natural **on-ramp**: a church's
first paid add-on, bundling toward the others.

## Why it's a clean plugin

A form is **definition + responses as events** — no third-party code in the app, no heavy infra.
Responses with PII (names, contact, prayer needs) are **encrypted to the church key**, same model as
the Treasury/safeguarding data — the privacy story is the selling point vs Google Forms.

## Architecture

```
Forms (mostly core-shaped; the "service" is thin)
─────────────────────────────────────────────────
 Steward builds a form           → church-signed form def event (kind 30078, d=form:<id>)
   { title, fields[], audience }   fields: text | choice | scale | checkbox | date | contact | prayer
 Member / public submits         → encrypted response event (encrypted to the church key)
 Console reads + summarises       → responses table, export CSV, per-field summaries/charts
```

- **Form definition:** a church-signed `form:<id>` doc (kind-30078, like groups/funds). Carries fields,
  audience (members-only | public link), open/closed state.
- **Responses:** each submission is an event **encrypted to the church key** (NIP-44, same primitive as
  finance/safeguarding) → only the console can read them. For a **public** form (not-yet-members), the
  response is posted via the church's relay with an encrypt-to-church envelope and a light anti-spam
  gate (rate-limit / proof-of-work / a soft captcha) since the submitter may be anonymous.
- **Surfaces:**
  - *in-app* — a "Forms" card / a form rendered natively from its definition (preferred; no embed).
  - *public link/QR* — a lightweight hosted form page (served by the relay/gateway) for people without
    the app yet; **feeds migration** (a connect card is often someone's first touch → "join the church"
    follow-up). This page is first-party (our origin), so minimal CSP fuss.
- **Identity & grants:** members submit as themselves; public submitters are anonymous-to-pseudonymous.
  The console (church key) is the only reader. No external service needs the church key.
- **Connect card = special-cased form:** ship a polished default "Connect card" template (new-here flow)
  that can hand off to the existing **follow/join** flow — bridging `FORMS` with onboarding/migration.

## Build steps

1. **Form def + builder** in the console (field types: text, choice, scale, checkbox, date, contact,
   prayer-request); church-signed `form:<id>`.
2. **Native in-app renderer** + encrypted submit; **responses view** (table + CSV export + simple
   per-field summaries).
3. **Public form page** (gateway-served) for QR/link sharing + anti-spam; connect-card template wired to
   the join/onboarding flow.
4. **Notifications:** "new response" to stewards (existing push), optional auto-acknowledgement to the
   submitter (members only).

## Open questions / decisions

- **Public-form abuse:** anonymous submissions need spam control — rate-limit + soft PoW + optional
  "approve before it shows". Decide the default.
- **Prayer-request field** overlaps the existing prayer feature — let a form *create* a prayer request
  (route into the prayer flow) rather than duplicate it.
- **Retention:** PII responses are sensitive — give stewards easy delete + an auto-expire option (e.g.
  "delete responses after N days"), framed as good data hygiene.
- **Pricing:** entry tier (often the first paid plugin); maybe N free forms then a tier. Bundle toward
  Treasury/hosting.
- **Connect-card → membership:** how far to automate the "they filled the card → invite them" handoff
  (lean: one-tap "invite this person" from a response).

## Reuse / touchpoints

- Church-signed doc pattern (`group:`/`fund:` → `form:`), NIP-44 encrypt-to-church (finance/safeguarding
  primitive), the gateway (public form page + anti-spam), VAPID push (new-response alerts), the
  follow/join + migration flow (connect-card handoff — see `migration-onboarding` memory).
