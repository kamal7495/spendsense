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

Only mail from the last 6 months is scanned (`DATE_FILTER`) — this tracks
recent spend, not a full financial history. Each run also caps how many
threads per source it processes (`MAX_THREADS_PER_SOURCE`) and stops
starting new sources once most of the 6-minute execution budget is used, so
a large backlog gets worked through over several runs instead of timing out.

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
- **Recurring HDFC Life insurance debit** → `other`.
- **Explicitly skipped**: OTPs, UPI marketing/fraud-awareness emails, incoming
  credits (salary/transfers in).
- **Explicitly flagged to `Needs_Review`** (not guessed at): large P2A/IMPS
  transfers, credit-card *bill payment* debits (these settle a card whose
  individual purchases are captured separately — recording both would
  double-count), and any card charge that looks like a bill payment routed
  through the card (same double-count risk).

Processed emails get a `SpendSense/Processed` Gmail label so they're never
re-read. Flagged ones get `SpendSense/NeedsReview`. Check the `Needs_Review`
sheet tab periodically and either recategorize manually into `Invoices_Raw`
or extend the script's rules once you see a pattern worth automating.

## Budget alerts

`checkBudgetAlerts()` runs automatically at the end of every sync. Once a
category's spend this month reaches 90% of its `Budgets`-tab target, it
emails you (the account the script is authorized under) — once per
category per month, tracked in a `Budget_Alerts_Sent` tab so it doesn't
repeat daily. This needs the Gmail *send* scope, which is a new permission
beyond the read/label/sheets access from initial setup — the first run
after adding this will prompt you to re-authorize.

## Extending it

To add a new source (a new vendor, a new bank), add a `process*` function
following the existing pattern and call it from `runSpendSenseSync()`. To
change the schedule, edit `createDailyTrigger()` and re-run it. To change
the alert threshold or wording, edit `BUDGET_ALERT_THRESHOLD` and
`checkBudgetAlerts()`.
