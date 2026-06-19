# The Finance module — a guide for treasurers

*Last updated 2026-06-19. Covers the opt-in Finance module: ledger, donor records, bank-statement
import, year-end statements, and the optional UK Gift Aid add-on.*

This is for whoever looks after the church's giving — the treasurer, or a steward acting as one. It
explains what the Finance module does, how to use it month to month, and — just as importantly —
where its boundaries are.

> **The one thing to hold onto:** the rest of TrinityOne is anonymity-first (no email, no phone, no
> central database of members). **Finance is the deliberate exception** — keeping a giving ledger means
> keeping named donor records. So this module keeps real personal data, and it's walled off
> accordingly: **every record is encrypted to your church's key**, the relay only ever stores
> unreadable ciphertext, and only this console can open it. Turn it on only if you're handling giving,
> and handle that data under your local data-protection rules.

---

## Turning it on

It's **off by default**. A steward enables it in **Settings → "Finance & giving records"**. Once on, a
**Finance** tab appears in the console sidebar. Switching it off again hides the tab (your records stay
safely stored, just out of the way).

**UK Gift Aid** is a separate, optional add-on under the same setting — **off by default**, and only
relevant to churches that reclaim UK Gift Aid. Turn it on for donor declarations, per-gift
eligibility, the reclaim estimate, and the HMRC claim builder. With it off, the module is fully
nationality-agnostic: just donor records, funds, the ledger and year-end statements.

---

## The parts

The Finance tab has **Ledger**, **Donors** and **Funds** — plus a **Gift Aid** view when the optional UK Gift Aid add-on is on.

### 1. Ledger — every gift
The running record of giving. **Record giving** to add an entry by hand (cash, bank, card or
Lightning), with the amount, date, fund and donor (plus a Gift-Aid flag when that add-on is on). The
summary tiles show your total recorded, donors and funds — or, with UK Gift Aid on, the Gift-Aid-eligible
total and the estimated 25% reclaim.

### 2. Donors — who gave
A donor is a named person you can attach giving to. Each donor holds their **name, address and postal
code**, an optional email, and any **bank references** (see import below). With **UK Gift Aid** on,
each donor also records whether a **declaration** is on file; when it is, an extra "for the HMRC claim"
section appears for their **title, first/last name and house name/number** (these default by splitting
the full name; correct them if needed — HMRC is fussy).

### 3. Funds — what it was for
Optional categories (General, Building, Missions…) so you can split giving by purpose.

### 4. Gift Aid — the claim
Builds an HMRC claim from your records (see its own section below).

---

## Bringing in bank giving

Most giving arrives as **standing orders and bank transfers**, so the module imports your bank
statement and matches each deposit to a donor.

1. Download a **CSV statement** from your bank (Statements → Download → CSV).
2. In the Ledger, tap **Import statement** and choose the file. It's read **on your device** — nothing
   is uploaded.
3. The console guesses which columns are the date, the money-in and the reference, and lists only the
   **credits** (money coming in — card payments and direct debits going out are ignored).
4. **It matches each deposit to a donor automatically** — first by any **bank reference** it has
   learned, then by the **payer's name on the statement line** (most banks show it for standing
   orders/transfers). You confirm or correct each one.
5. Gift Aid is auto-ticked for donors who have a declaration. Lines you've imported before are marked
   "seen" and skipped, so re-importing the same statement won't double-count.
6. When you confirm a match, the console **remembers that reference for that donor** — so next month
   it's an exact, automatic match.

Cash and cheques (which show nothing useful on a statement) you still add by hand in the Ledger.

---

## Claiming Gift Aid

The **Gift Aid** tab turns your records into a claim for **HMRC Charities Online**.

1. Pick a period (it defaults to the current **UK tax year**, 6 April–5 April; "All unclaimed" is one
   tap away).
2. It gathers every **eligible** gift — a GBP donation, Gift-Aid-flagged, from a donor with a
   declaration, **not already claimed**. You see the total and the **25% you can reclaim**.
3. Any donor **missing details HMRC requires** (last name, house name/number, postcode) is flagged in
   red with a **Fix** button — sort those first, or HMRC will reject them.
4. **Download HMRC schedule** gives you a file in HMRC's exact column order.
5. **Mark as claimed** records the batch and stops those gifts ever being offered in a future claim. A
   **claims history** keeps a record of what you've reclaimed.

### Submitting it to HMRC — the last step is yours
TrinityOne deliberately stops short of sending the claim to HMRC for you. To submit, you:
1. Sign in to **HMRC Charities Online** with your charity's **Government Gateway** login.
2. Download HMRC's **official Gift Aid schedule spreadsheet** there.
3. Paste the rows from the file TrinityOne gave you under its headings, and upload it.

This boundary is on purpose: electronic API submission is a registered-software, credentialed process,
and the gov.uk login must stay with your church.

---

## Exporting

- **Export CSV** (Ledger) — your whole giving ledger, for your own records or to hand to an accountant.
- **Gift Aid CSV** (Ledger) — the declared-donor giving, as a quick schedule.
- **Download HMRC schedule** (Gift Aid tab) — the claim, in HMRC's column order.

These also let you feed the data into Xero or other accounting software.

---

## What this is **not** — please read

- **It is not full accounting software.** It records *giving* (money in) and Gift Aid. It doesn't track
  expenses, run a full ledger/P&L, or replace Xero/QuickBooks.
- **It does not submit to HMRC for you.** It prepares a compliant claim; you upload it on gov.uk.
- **It does not collect Gift Aid declarations for you.** It records *that* a donor has declared. **Keep
  the actual signed/recorded declaration** with your church records — HMRC can ask to see it.
- **It is not a substitute for your data-protection duties.** You're holding real personal data
  (names, addresses). Hold it under your church's privacy/GDPR policy: keep it accurate, keep it only
  as long as needed, and tell donors how it's used.
- **GASDS, aggregated small-donation lines, and Lightning auto-capture aren't in this version** — note
  them for the future; for now, Lightning gifts are entered by hand like cash.

If in doubt about an HMRC rule, check gov.uk's Gift Aid guidance or ask your accountant — TrinityOne
helps you assemble and format the claim, it doesn't give tax advice.

---

## A note on safety

Everything in Finance is encrypted to your church key and rides on the same self-custodial model as the
rest of TrinityOne: there's **no company holding your donor data**, and it restores with your church's
recovery key like everything else. The flip side: that key is the only thing that can read it, so keep
the church's recovery phrase safe (see the steward setup guide).
