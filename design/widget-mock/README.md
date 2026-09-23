# Church calendar widget — design mock

**This is a mock, not shipping code.** `calendar-widget-mock.html` is a single, self-contained file for
the owner to look at and choose a direction from. Nothing in it reads a real feed, talks to a real relay,
or belongs in a build. It exists to make phase 3 of
`/mnt/storage/projects/TrinityOne-internal/reference/DESIGN-embeddable-church-info.md` visible before
anyone writes the real thing, per the owner's 2026-09-23 go-ahead ("lets also start the widgets... if its
easy that should be fine").

Phase 1 (the real `.ics` feed, `scripts/public-calendar.mjs` + the relay's `/public/<npub>/calendar.ics`
route) is built on `feat/church-website-feeds`, not yet on `main`. This mock's sample data is shaped to
match what that builder actually produces — see "What's real" below — but the mock does not import it,
call it, or open a socket to anything. Open the HTML file straight off disk.

## The three variants

All three render the same invented week for the same invented church (St Aidan's, a small English parish)
so they're a fair comparison, stacked one below the other in the file with the surrounding "church
website" mocked up as plain, generic site-builder chrome — deliberately NOT in TrinityOne's own look —
so the widget itself can be judged sitting inside somebody else's page, which is the actual use case.

1. **List (default)** — the next several events, soonest first. What most churches will use; a plain
   list needs no explanation and degrades to something sane at any width.
2. **Month grid** — a calendar month with a coloured dot per event on the day it falls, a legend, and a
   distinct diamond marker for a one-off (no `recur`) versus a round dot for a repeating one.
3. **Compact ("this week")** — three lines for a footer or a narrow sidebar column.

## What's real: the feed fields used, and what was left out on purpose

Read against `scripts/public-calendar.mjs` (the builder, on `feat/church-website-feeds`) and
`scripts/the-public-calendar-file-says-what-it-means.test.mjs`. A served `pubevent:` carries exactly:
`id`, `date`, `time`, `where`, `blurb`, `recur` (`weekly` / `fortnightly` / `monthly` / none), `day`; the
file also carries the church's display name once, as `X-WR-CALNAME`.

**Rendered in the mock**, because the real feed carries them:
- **title** → `SUMMARY`
- **date + time** → `DTSTART` (title, date, time are the three fields the design's "how much of each
  event" setting can never hide — see the open question below)
- **where** → `LOCATION` ("The Vestry", "Church Hall", "St Aidan's Church")
- **blurb** → `DESCRIPTION` — shown on exactly one event (Harvest Supper), because
  `public-calendar.mjs`'s own comment says most churches leave this blank and a mock where every row has
  a paragraph would misrepresent that
- **recur** → shown as a small "Weekly" / "Fortnightly" / "Monthly" badge in the List variant and as a
  round-vs-diamond dot in the Month grid; nothing badges a one-off, since it has no `recur` value to name
- **church display name** (`X-WR-CALNAME`) → the widget's own heading, "St Aidan's — What's On"

**Deliberately left out, because the real feed never carries them** (design doc, "What it must never
do" and "What is in the bytes"): the event's `id`, any URL or hostname, the church's relay address or
npub, an attendee/RSVP, a group id, an image, an accent colour, a "N events" count anywhere (the design
explicitly forbids a count — it is a side channel for an opted-out event), a subscribe/copy-address
button (that belongs to the console's Settings page, not a visitor-facing page), and an "add to my
calendar" action (the design lists this only as an *unbuilt* phase-3 display setting, not a decision —
see below).

**The sample list is curated for readability, not a literal feed dump.** A real feed lists every
occurrence of every recurring series with no editorial filtering; this mock's List variant skips a
couple of repeat occurrences of the same weekly meeting so the eight rows shown are varied rather than
three-quarters "Midweek Prayer" again. Don't read the specific eight as an assertion about how many rows
a real widget shows by default — see the first open question below.

## The no-third-party rule, and why

Every byte in `calendar-widget-mock.html` is inline: CSS in one `<style>` block, no external stylesheet,
no webfont file, no CDN script, no analytics, no cookies, no external image. The font stacks are system
fonts standing in for brand.css's Sora/Newsreader, not a Google Fonts substitute — a real embed would
self-host the actual font files from the same base as the widget script (same rule the rest of this
site already follows for `welcome.html`'s `vendor/fonts/fonts.css`), never a CDN; this mock goes one step
further and loads nothing at all, including our own files, because the whole point is that it opens from
a bare filesystem path with nothing else present to check.

This isn't a mock convenience — it's the actual constraint. TrinityOne's first audience is the
persecuted church and the developing-world congregation on a thin connection, not a comfortable American
church website (`positioning-not-cushy-american`); a widget that quietly pulled a font from Google or a
script from a CDN would expose every visitor to that church's website to a third party's server, which
is exactly the "which machines get the data" boundary this whole design exists to hold (design doc,
"What it must never do"; `CLAUDE.md` rule 10 makes the same point about relays). "It does not track
anyone" has to stay a fact about the bytes, not a promise about intent.

## Under a strict CSP, the shipped widget needs an external script

This mock renders everything as static HTML — there is no JavaScript in the file at all, because a still
mock doesn't need to fetch or parse anything. **The real widget is not that simple**: it has to fetch the
`.ics` file, parse it, and render actual upcoming occurrences of each `RRULE`, which means it runs code.
This repo serves every page under a strict CSP with no `'unsafe-inline'` (`strict-csp-no-inline-scripts`)
— any inline `<script>` in a served `.html` is silently refused by the browser, and the page looks fine
while doing nothing. So the shipped widget will need its logic in a separate `.js` file, referenced with
a plain `<script src="...">`, served from the same base as everything else. Don't take this mock's lack
of a `<script>` tag as evidence the real thing won't need one.

## Open questions this mock could not answer (the owner's decisions, not guesses)

- **How many events does each variant show by default?** The design doc lists "how many events" under
  phase-3 display settings and says only that it's unbuilt — it does not pick a number. This mock shows
  8 in the List variant and 3 in Compact, purely for a legible screenshot.
- **Does a widget offer an "add to my calendar" action?** The design mentions this as one of the
  *possible* phase-3 display settings a steward could someday be given, but never decides it exists.
  This mock has no such button. If it's wanted, a follow-on question is what it would link to — the
  whole feed (which is the address a church may not want casually re-shared) or just that one event's
  `…/e/<id>.ics` — and whether offering it on the page is itself a small leak of "this church uses
  TrinityOne" beyond what the church chose when it turned sharing on.
- **Does the widget expose the raw feed address at all** (a "subscribe" link a visitor could copy into
  their own calendar app), or does that stay a console-only, steward-facing action? Not decided; this
  mock has neither.
- **What does the widget show when the feed is empty or unreachable?** No design decision exists for
  this yet. A church with genuinely nothing on for weeks is a real case (a church "may deliberately have
  no group rooms for its children" is the closest existing precedent in this codebase for "empty is not
  broken" — `CLAUDE.md` rule 7) and is different from the feed being unreachable (network trouble, or a
  church that switched sharing off after the widget script was already pasted in). This mock only shows
  the populated case.
- **Timezone handling, on the WIDGET side specifically.** `public-calendar.mjs`'s own comments establish
  that the feed's times are floating — no zone, wall-clock in the church's own place, same as a
  noticeboard. That answers what the FEED does. It does not answer what the WIDGET should do for a
  visitor whose browser reports a different timezone than the church's: say nothing (as this mock does,
  which risks a visitor abroad misreading "7:30pm" as their own local time), or add a short "(church
  local time)" caption. Not decided.
- **Does the Month grid variant need month navigation that actually works** (this mock's `‹ October
  2026 ›` is inert text, not a real control), or does a church only ever want "this month," making
  navigation something to leave out entirely rather than half-build? Not decided.

## Not a test

No test accompanies this mock (rule 8: nothing was removed, nothing was added under test — this is a
static design artefact, and CLAUDE.md rule 3 already forbids asserting behaviour by matching text in an
unbundled file, which is exactly the wrong way to "test" a look-and-feel mock like this one). If any part
of this mock becomes real, the real build gets the point-of-use tests rule 1 requires; this file gets
none because it has no behaviour to break.
