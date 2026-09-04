# `bank-statement-sample.csv` — what each line is there to prove

Shaped like a UK bank export (Lloyds/Barclays style): day-first dates, a `Type` column, separate **Money In**
and **Money Out**, thousands commas, quoted fields. `guessColumns` picks it up with no help — verified:
`{date:0, description:1, amount:-1, moneyIn:3, moneyOut:4}`, 15 lines, 0 unparseable dates,
£1,943.81 in and £1,362.27 out.

Import it twice, and pull the network halfway through the first attempt. What each line is for:

| line | why it is there |
|---|---|
| `STANDING ORDER GIVING` £20.00 **twice on 01/09** | **The regression case.** Two identical payments in one day is ordinary for a church, and they share a de-dup fingerprint (date + amount + description). An earlier version of the import dropped the second and reported success — £20 missing with nothing on screen. Both must appear. |
| `J & M PATTERSON, REGULAR GIVING` | An embedded comma inside a quoted field — the CSV parser's job, and a real payee format. |
| `SUMUP … SETTLEMENT` ×2 | Card-reader settlements: same payer, different days and amounts. Must NOT be treated as duplicates. |
| `CASH BANKING BRANCH 20-45-77` | Digits and dashes in a description; must not confuse the money columns. |
| `HMRC GIFT AID REPAYMENT` `1,284.31` | Thousands comma in a money field, and the largest single receipt. |
| `WICKES … ROOF REPAIR PART 1` / `PART 2` | **A known limitation, deliberately exposed.** Same date, same £248.00, and the descriptions are identical for the first 40 characters — which is all `lineKey` keeps. So these two DIFFERENT transactions share a fingerprint. Within one import both post. On a **re-import** both are skipped even if only one had gone in, so a real payment can be missed. Not a regression; worth a decision. |
| `BRITISH GAS`, `ECCLESIASTICAL INS`, `TERMINAL RENTAL` | Ordinary direct debits — the money-out path and category suggestions. |
| `REFUND - HALL HIRE CANCELLED` | Money OUT that reads like income. Tests that direction comes from the column, not the words. |
| `TRANSFER TO MISSION FUND` | Should be categorised to a fund, not treated as an expense. |

## What to do with it

1. **Import the lot.** Expect 15 lines offered, none pre-flagged as already imported, and both £20 standing
   orders present.
2. **Import the same file again.** Expect every line flagged "already imported" and nothing posted.
3. **The one that matters:** import it with the relay unreachable partway through — flight mode after the
   first few. Some lines will fail. Then reconnect and press **Try again**. Nothing should double up, and
   nothing should be missing. Reconcile the totals against the last `Balance` column: £4,744.09.
