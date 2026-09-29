# SpendSense Gmail sync (Apps Script)

Keeps `Invoices_Raw` updated automatically by scanning Gmail for known
transaction sources, instead of a manual pull. Runs entirely inside Google's
infrastructure — no service-account credentials needed, since the script
uses your own Gmail/Sheets access.

## Setup

1. Open the SpendSense Google Sheet.
2. **Extensions → Apps Script.**
3. Delete the default `Code.gs` content and paste in this folder's `Code.gs`.
4. Save the project (any name).
5. From the function dropdown at the top, select `runSpendSenseSync` and click
   **Run**. The first run prompts you to authorize Gmail + Sheets access —
   accept it. This also does a first backfill pass over your existing mail.
6. Select `createDailyTrigger` and click **Run** once. This installs a daily
   trigger (7am, script's timezone) so `runSpendSenseSync` keeps running
   without you opening the editor again.

Only mail from 1 Jan 2026 onward is scanned (`DATE_FILTER`) — a fixed start
date, not a rolling window, so historical months don't silently drop off as
time passes. Each run also caps how many
threads per source it processes (`MAX_THREADS_PER_SOURCE`) and stops
starting new sources once most of the 6-minute execution budget is used, so
a large backlog gets worked through over several runs instead of timing out.

## Amazon orders live in a different account

`processAmazonOrders` reads order-confirmation emails from
`auto-confirm@amazon.in`, but those land in a *different* Google account
than the one that normally runs this script. It's harmless to leave the
function in the shared source list either way — it just finds nothing when
run from an account that never receives these emails. To actually itemize
Amazon orders:

1. Share this Sheet with that other Google account — Editor access.
2. From *that* account's own browser session, open the same Sheet →
   **Extensions → Apps Script**, and run `runSpendSenseSync` once. Being a
   container-bound script, it authorizes under whichever account runs it —
   no credential sharing needed.
3. Run `createDailyTrigger` from that account too, so it keeps syncing.

Until that's set up, Amazon card charges (on ICICI, Axis My Zone, Axis Neo
Rupay, or Scapia) are routed to `Needs_Review` rather than silently skipped
or auto-recorded — recording them as lump-sum "shopping" would double-count
once the itemized version starts flowing in, but skipping them silently
risks losing that spend entirely if this second-account sync never gets set
up. Once it's running, you can safely delete the "possible duplicate"
Needs_Review rows for the dates it's now covering.

The parser's regex was verified against 5 real order emails pulled via
`debugDumpAmazonFailures` (a manually-forwarded sample looked completely
different — `[image: ...]` markup, "Total ₹X" on one line — but that turned
out to be a rendering artifact of forwarding itself, not the real
`getPlainBody()` shape: the actual format has no image markup, items as
`* <name>` bullets, and "Total" and the amount on separate lines). If a
parsing fix ever needs to be re-verified the same way, `resetAmazonNeedsReview`
un-flags just the Amazon "didn't match parser format" rows (run from that
account) so only those retry, without touching the rest of the backlog.

## What it does

- **Instamart grocery orders** → itemized rows (with real quantity, e.g. "2 x
  Milk") in the grocery categories (fruits, vegetables, meat_seafood, dairy_eggs,
  rice, oils, grains, pulses, spices, sugar, tea_coffee, bakery, instant_food,
  snacks, personal_care, household), categorized by keyword matching on the item name.
- **Swiggy restaurant orders** → one `dining_out` row per order (grand total
  paid, quantity 1).
- **ICICI, Axis My Zone, and Axis Neo Rupay card alerts** → itemized per
  transaction, categorized by merchant name (Amazon → shopping,
  Anthropic/Netflix/Spotify → subscriptions, Rapido/Uber/metro/RedBus/IRCTC →
  transport, Starbucks → dining_out, MakeMyTrip → travel, known billers →
  utilities). Unrecognized merchants go to `Needs_Review` instead of being
  guessed at. All four cards (ICICI, both Axis cards, Scapia) turned out to
  send real per-transaction alerts once the right subject line was found —
  none of them actually needed a lump-sum fallback category. My Zone's
  transactions in particular are all Swiggy/Instamart/Bundl Technologies
  (its auto-pay method for that account), which are already itemized via
  the dedicated Instamart/Swiggy sources — those merchants are skipped
  entirely on this card to avoid double-counting, not flagged or guessed at.
- **Axis UPI bill payments** and **Scapia card transactions** →
  categorized the same way as ICICI/Axis card merchants. Scapia's bill
  *settlements* ("Your repayment is successful") are excluded the same way
  Axis's "CreditCard Payment" debits are — they'd double-count the
  transactions already recorded from this same source.
- **RedBus tickets** and **IRCTC bookings** → `transport`.
- **JioFiber broadband recharges** → `utilities`, from Jio's own recharge
  confirmation email (not a bank alert) — same pattern as RedBus/IRCTC.
- **Recurring HDFC Life insurance premium** and **HDFC Bank home loan EMI**
  → `other`, matched by their fixed ACH narration prefix (`KNOWN_RECURRING_DEBITS`
  in `processAxisRecurringDebits`). Each entry there is a real narration
  confirmed against actual alert emails, not a guess.
- **Known fixed-amount IMPS/P2A transfers** (`KNOWN_IMPS_TRANSFERS` in
  `processIgnoredAndFlaggedNoise`) — currently a ₹27,000 car loan payment
  (Axis → ICICI) and a ₹67,870 SIP funding transfer (Axis → SBI, which then
  funds a mutual fund SIP on the SBI side — see the note on SBI below).
  Matched on exact amount since the transfer narration carries no
  merchant/purpose text; any other IMPS/P2A amount still goes to
  `Needs_Review`.
- **Axis savings account UPI transactions** (`processAxisSavingsUpiTransactions`)
  — a distinct alert format ("INR X was debited from your A/c...") that sat
  completely unhandled until a real Money Manager cashbook export surfaced
  how much spend it was hiding (daily food, small vendor payments). Every
  one of these goes to `Needs_Review`, split into P2A (person-to-person) vs
  P2M (merchant) in the reason text, rather than guessing a category — a
  real check against actual data found the "merchant" name in UPI/P2M often
  renders as a personal name (e.g. a restaurant's owner's own UPI ID), not
  a business name, so there's no reliable keyword to categorize by.
- **Salary credits** (`processSalaryCredits`) → a new `Income_Raw` sheet tab
  (`Date | Source | Description | Amount`), not `Invoices_Raw` — this is money
  in, not spend. Axis sends the same "Credit transaction alert" subject for
  *every* credit to the savings account (small P2P transfers, refunds,
  interest, salary — all identical subject lines), so the salary one is
  identified by its narration, verified against real emails to always end in
  `/Sala` (Axis truncates "Salary" mid-word, e.g.
  `NEFT/IN22626825782262/Sala.`). Every other credit on that subject is out
  of scope for this source — not income, and not spend either — so it's
  marked processed and otherwise ignored, not guessed at or flagged.
- **Explicitly skipped**: OTPs, UPI marketing/fraud-awareness emails, and any
  non-salary incoming credit (see above).
- **Explicitly flagged to `Needs_Review`** (not guessed at): large P2A/IMPS
  transfers other than the known amounts above, credit-card *bill payment*
  debits (these settle a card whose individual purchases are captured
  separately — recording both would double-count), any card charge that
  looks like a bill payment routed through the card (same double-count
  risk), and every Axis savings-account UPI transaction (above).
- **Coin by Zerodha SIP allotments** → `investments`, itemized per fund from
  the consolidated allotment-report email (one row per fund bought that
  cycle). `investments` is deliberately excluded from the This month/Last
  month spend totals — see the category comment in `lib/types.ts`.
  `parseZerodhaAllotments_` chunks the body on each entry's trailing
  "<units> units" marker rather than anchoring to a specific line layout —
  `GmailApp.getPlainBody()` strips the email's markdown table entirely (no
  "|" survives, unlike the Gmail API's own plain-text rendering of the same
  message) and reflows each cell onto its own line, with the fund name
  sometimes landing on the same line as "Folio no.:" and sometimes on its
  own line depending on name length; the invested amount is also sometimes a
  whole rupee figure with no decimal point at all (e.g. "₹59997"). All
  verified against real emails, not guessed — same renderer-mismatch class
  of bug that broke the Amazon order parser earlier.
- **Coin by Zerodha SIP redemptions** → also `investments`, as a NEGATIVE
  amount (item labeled "<fund> (redemption)") — a redemption pulls money OUT
  of a fund back to the bank account, so it nets against contributions
  rather than needing a separate category or sheet. Real redemption emails
  have a different shape than allotments: no "Folio no.:" at all, instead
  "<fund name> NAV: ₹<nav>", plus a trailing disclaimer row ("Amount will be
  credited directly to your bank account...") that's naturally excluded
  since it has no NAV or units marker to chunk on. Both allotments and
  redemptions also store the real units transacted in the Quantity column
  (fed into the Next.js app's current-value estimate - see
  `lib/mutualFunds.ts`), and both search with `INVESTMENT_HISTORY_FILTER`
  (no lower bound) instead of the global `DATE_FILTER` - unlike day-to-day
  spend, a fund's current-holdings math needs its FULL history from whenever
  the SIP started, not just a recent window. A real bug from getting this
  wrong: with `DATE_FILTER`, 5 of 7 real funds showed negative net units,
  because their pre-2026 allotments were invisible while later redemptions
  were fully captured, making still-held funds look over-redeemed.
- **Amazon order confirmations** → `shopping`, one row per Order # (not per
  item — see "Amazon orders live in a different account" below for why),
  vendor `Amazon`. Every card processor (ICICI, Axis My Zone, Axis Neo
  Rupay, Scapia) routes Amazon-looking merchants to `Needs_Review` instead
  of auto-recording them, since the same purchase is itemized here — but
  only once the account below is actually set up and syncing.
- **Not trackable at all via Gmail** (a real, permanent limitation, checked
  directly — not an assumption): SBI and Bank of Baroda accounts. Both banks
  only send monthly PDF e-statements, not per-transaction alerts, to this
  inbox — confirmed by searching broadly and finding nothing but statements
  and marketing mail. Short of parsing those PDFs (likely password-protected,
  the same wall hit early on with credit card statements, and a much bigger
  undertaking), these two accounts can't be synced automatically. Money
  Manager (or whatever else tracks them) stays the source of truth for that
  spend.

Processed emails get a `SpendSense/Processed` Gmail label so they're never
re-read. Flagged ones get `SpendSense/NeedsReview`. Check the `Needs_Review`
sheet tab periodically and either recategorize manually into `Invoices_Raw`
or extend the script's rules once you see a pattern worth automating.

## Budget alerts

`checkBudgetAlerts()` runs automatically at the end of every sync. Once a
category's spend this **pay cycle** reaches 90% of its `Budgets`-tab target,
it emails you (the account the script is authorized under) — once per
category per cycle, tracked in a `Budget_Alerts_Sent` tab so it doesn't
repeat daily. This needs the Gmail *send* scope, which is a new permission
beyond the read/label/sheets access from initial setup — the first run
after adding this will prompt you to re-authorize.

"Pay cycle" means the 25th of one month through the 24th of the next
(`PAY_CYCLE_START_DAY` in Code.gs) — confirmed by the user to match their
actual salary date, so it's when a paycheck really has to stretch across,
not the calendar month. This matches the Budget page's pacing on the
Next.js side (`lib/payPeriod.ts`) — keep both in sync if this ever changes.
One-time note: the dedup key format changed from `category|yyyy-MM` to
`category|yyyy-MM-dd` (the cycle's start date) when this switched, so an
alert already sent this calendar month under the old key won't be
recognized as sent under the new one — worst case, one duplicate email
around the transition.

## Extending it

To add a new source (a new vendor, a new bank), add a `process*` function
following the existing pattern and call it from `runSpendSenseSync()`. To
change the schedule, edit `createDailyTrigger()` and re-run it. To change
the alert threshold or wording, edit `BUDGET_ALERT_THRESHOLD` and
`checkBudgetAlerts()`.
