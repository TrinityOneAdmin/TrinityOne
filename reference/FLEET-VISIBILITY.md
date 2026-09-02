# Watching the network without building an arrest list

Written 2026-09-01, answering: can we see how the network is doing — churches, relays, health — without
holding anything incriminating about the people using it?

**Yes, but the naive version of this is the most dangerous artefact anyone could build here**, and it would
be held by us, which makes us the target rather than the relays. This file is the constraint, decided before
anything is built, so the wrong thing is never collected by accident.

## The precedent already set in this codebase

`/status` is public for health, build and disk. **Per-church activity counts were deliberately moved behind
admin auth and recorded as seizure-sensitive** — an unauthenticated `/status` used to hand a stranger a
per-church breakdown. That call was right and it governs this one: *if a per-church count is too sensitive
to serve from one relay, an aggregate of them across the whole network is not less sensitive — it is the
same data with better indexing.*

## The rule

**Count things. Never name them. Never time them.**

| Safe to collect | Never collect |
|---|---|
| How many relays reported this period | Which churches exist, by key or name |
| Version spread — how many on each build | Per-church member counts (size identifies a church) |
| Update success / failure / rollback counts | IP addresses, hostnames, geography |
| How many relays report degraded storage or a full disk | Activity timing — **when a congregation meets is the sensitive fact under persecution** |
| Total churches, as one number, above a threshold | Anything per-church at all |
| Media-cap pressure, as a count of relays affected | A stable identifier that lets one relay be followed over time |

The middle row is the one people get wrong. A dashboard showing "activity by hour" looks harmless and tells
an adversary when a house church gathers.

## Seven design constraints

1. **Opt-in and push-only.** A relay operator chooses to report. We never poll, never scan, never probe. A
   church that says nothing is invisible to us, permanently, with no penalty.
2. **Aggregate before it leaves the building.** A relay sends *"healthy, version 0.9.71, N churches"* — never
   a list. The reduction happens on their machine, not ours.
3. **No stable relay identity.** A rotating per-period token, so reports can be counted but one machine
   cannot be followed across periods. This costs us accurate churn figures. Accept that.
4. **Suppress small buckets.** Do not display anything derived from fewer than five reporters. With three
   pilot churches, that means the dashboard shows nothing — correctly.
5. **Short retention.** Keep aggregates, discard reports. What we do not hold cannot be compelled from us.
6. **Publish the schema.** A church should be able to read exactly what its relay would send, in plain
   language, before switching it on. If we would not show them the payload, we should not collect it.
7. **No central service anyone depends on.** Reporting must never be load-bearing. If the endpoint vanishes,
   every relay carries on unchanged.

## The honest tension

**You cannot both prove a report is genuine and keep it anonymous, without machinery we do not have.** A
signature proves a real relay sent it — and a signature is an identity. Options, none free:

- **Unsigned + rate-limited.** Anyone can send noise; figures are indicative, not trustworthy. Fine at pilot
  scale, and the honest default.
- **Signed with a rotating key.** Better, more to build, and rotation schedules leak structure.
- **Blind signatures / anonymous credentials.** Correct, and disproportionate for counting churches.

Start unsigned, say plainly on the dashboard that the numbers are indicative, and do not let anyone treat
them as revenue-grade telemetry.

## When to build it

**Not now.** At three churches, the dashboard is a phone call. The value starts somewhere around twenty
reporters, when you can no longer hold the picture in your head. Deciding the constraint now costs nothing
and prevents the usual failure: building it at scale, in a hurry, collecting whatever was easy.

**What to do now instead:** when the update channel work happens, make the update check **not** carry a
church identifier, so we never have to un-collect it later.

## What this buys, honestly

A dashboard built this way answers: *is the fleet healthy, is anyone stuck on an old build, did the last
release roll back anywhere, are relays running out of disk.* Those are the questions that actually change
what we do.

It cannot answer: *which church is struggling.* By design. That question is answered by asking them, and
the pilot exists partly to establish whether they will tell us.
