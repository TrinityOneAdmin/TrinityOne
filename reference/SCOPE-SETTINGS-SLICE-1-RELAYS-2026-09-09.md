# Scope: slice 1 — Relays becomes several pages

First slice of `reference/DECISION-SETTINGS-LIST-AND-DETAIL-2026-09-09.md`. Console only. Nothing built
yet — this is the scope to agree before anyone writes code.

Relays is first because it is the worst card (over 1000px, measured) and because breaking one card into
several pages proves the whole idea cheaply. If it does not feel better here, the decision is wrong and we
have spent one slice finding out.

## What is in that one card today

Measured in `app/stew-dashboard.jsx` from line 3812. Eight distinct jobs, all expanded, all at once:

| # | Job | How often a church touches it |
|---|-----|-------------------------------|
| 1 | Which relays, are they answering, remove one | every visit — this is why you open the page |
| 2 | "One relay is a single point of failure" / "Backup on" | read once, acted on once |
| 3 | Add relay by address | rare |
| 4 | Auto-find relays for me | rare |
| 5 | Connect by name | rare |
| 6 | "A relay is refusing our posts — fix it" | only when something is wrong |
| 7 | Copy your history to another relay | once in a church's life, if ever |
| 8 | Keep your relays in sync | once |

Plus two neighbouring cards on the same tab: **Network** (belong to a group of churches) and **Run your
own relay box** (download the Suite).

**Only row 1 is everyday.** Seven of eight are read once or never, and they are what makes the page
1000px tall.

## The pages it becomes

- **Relays** — the list, health, remove, and the single-point-of-failure notice. The everyday page, and
  the only one most stewards ever open.
- **Add a relay** — by address, Auto-find, connect by name. One page, three ways in.
- **Move or copy history** — clone across, keep in sync.
- **Run your own box** — the Suite downloads and the install line. Already its own card; becomes a page.
- **Network** — unchanged, already separate.

"A relay is refusing our posts" is **not** a page. It is a fault, so it stays a banner on the Relays page
where the fault is visible, and it must remain reachable without hunting — the whole reason it exists is
that a steward is already confused when they need it.

## What must not break

1. **The phone layout is correct and must not change.** Confirmed twice by the owner. Everything here is
   behind the existing `@container` guard, and the phone keeps stacked cards.
2. **The relay row's facts stay exactly as they are** — Self-hosted / Shared, Answering / Offline, "Not in
   your network", "Refused our last change", and the relay's own words in the row tooltip. That work was
   device-verified this week; this slice moves it, it does not touch it.
3. **The refusal path stays whole.** `noteRelayRejection()` raises the banner AND arms the forced
   re-registration retry. Moving the panel must not orphan either.
4. **Deep links.** `setRegOpen(true)` is currently how the console jumps a steward to the registration
   repair. After this it must target a page. Anything else that navigates into Settings needs the same
   treatment — enumerate them before editing, per CLAUDE.md rule 2.
5. **CSP** — no inline script or handlers in anything served.

## How it gets tested

The existing `scripts/settings-cards-sit-in-authored-stacks.test.mjs` renders the real `DashSettings` and
asserts its shape. That test IS the guard here and will need to change with the layout — **it must be
updated to assert the new shape, never relaxed.** The rule it protects, that positions are authored and
not computed, survives the redesign unchanged.

New tests should cover, at the point of use and by running the code rather than matching text
(`app/*.jsx` ships unbundled — rule 3):

- every page in the list is reachable and renders its own panel;
- no page is orphaned — every panel that exists today appears on exactly one page;
- the refusal banner still appears on the Relays page, and still arms the retry;
- the phone still gets the roomy layout (the container query does not fire below the threshold).

## Deliberately NOT in this slice

- The other console sections.
- Extracting the shared CSS.
- The relay panel. It has the worse problem (`column-count`, so cards genuinely hop), but doing it second
  means it inherits a pattern that has already survived contact with a real page.

## DECIDED: the list replaces the four tabs

Owner, 2026-09-09: *"yeah, I think replace the 4 tabs."*

So Church / Features / Network & relays / Security stop being tabs across the top. The list of pages
takes their place, grouped the way the mockup groups them (Church, People, Infrastructure, Security).
A sidebar beside the existing sidebar was the alternative and is worse.

**This makes slice 1 bigger than "move some cards", and that is the right call anyway** — it changes the
page's frame, so it should happen once rather than be retrofitted after four sections have been built
against the old tabs. Consequences to handle in this slice:

- The tab strip and its `section` state are replaced by page selection. `DashSettings` currently takes
  `initialSection` and `onSectionConsumed`; both now address pages, not tabs.
- Every caller that navigates into a Settings tab has to point at a page instead. Enumerate them all
  before editing — CLAUDE.md rule 2, and this is exactly the "signature change has two caller lists"
  trap: the code that calls it AND the tests that slice it by name.
- `settings-cards-sit-in-authored-stacks.test.mjs` asserts `role="tabpanel"` and the tab-per-section
  shape. It must be rewritten to the new shape, not relaxed.
- On the phone the list is the first screen and a page opens on tap, which is what the mockup shows.
  Today's stacked-card layout is what a page uses once opened, so the approved phone layout survives.
