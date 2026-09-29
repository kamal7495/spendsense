# SpendSense

A personal-finance dashboard built with Next.js 14 (App Router) and TypeScript, backed by a
Google Sheet. Spend data is populated automatically by a Gmail-scanning Apps Script pipeline
(see `apps-script/README.md`) that reads real transaction/order-confirmation emails across
groceries, dining, transport, and multiple credit cards — no manual entry required, though the
dashboard also supports adding items by hand or by scanning a receipt photo.

## Features

- **Dashboard** (`/`) — this-month vs last-month spend, a category breakdown chart, a
  "which card was used where" interactive breakdown, an eating-habits/health snapshot, grocery
  reorder reminders, a monthly staples-to-restock list, and a sortable/filterable frequent-items
  table. A date-range control adjusts every section's window.
- **Budget page** (`/budget`) — editable monthly targets per category. The Apps Script pipeline
  emails an alert once any category crosses 90% of its target.
- **Scan Receipt** (`/scan`) — photograph a receipt or upload a PDF invoice (e.g. downloaded from
  an app like Blinkit); free local text extraction (PDFs) / OCR (photos) plus a keyword-based
  categorizer read the items, and an editable review table lets you fix anything before it's
  written to the sheet. No API key, no per-scan cost — see `lib/receiptScan.ts` for how it works
  and its limitations (it's pattern-matching, not semantic understanding, so it's rougher than an
  AI reader and needs real review each time).

## Architecture

Two halves, kept in sync manually:

- **This Next.js app** (`app/`, `lib/`, `components/`) reads/writes the Google Sheet via a
  service account, for the dashboard/budget pages, manual entry, and receipt scanning.
- **`apps-script/Code.gs`** is a Google Apps Script bound to the Sheet (pasted manually into
  the Sheet's Extensions → Apps Script editor — there is no programmatic deploy) that scans
  Gmail on a daily trigger and writes categorized rows into `Invoices_Raw`. See
  `apps-script/README.md` for what it does and how to install/update it.

## Data model

The app reads/writes a Google Sheet with these tabs:

**`Invoices_Raw`** (columns A-H, header row + data):

```
Date | Vendor | OrderID | Item | Category | Amount | Fee | Quantity
```

`Category` must be one of:

```
fruits, vegetables, meat_seafood, dairy_eggs,
rice, oils, grains, pulses, spices, sugar, tea_coffee, bakery, instant_food,
snacks, personal_care, household,
dining_out, transport, utilities, rent, entertainment, subscriptions,
shopping, health, travel, transfers, fees, gifts, other, investments
```

(see `lib/types.ts` for the source of truth, and `lib/labels.ts` for display names)

`investments` (mutual fund SIPs, etc.) is deliberately excluded from the This
month/Last month totals on the dashboard (`totalSpendForMonth` in
`lib/analytics.ts`) — it's money moved into savings, not spend. It still
shows up as its own line in per-category breakdowns and the budget page.

**`Budgets`** (columns A-B, header row + data):

```
Category | MonthlyTarget
```

**`Needs_Review`** — transactions the Apps Script pipeline couldn't confidently categorize
(large transfers, bill payments that could double-count, unrecognized merchants). Kept as a
permanent audit trail; never bulk-cleared.

**`Budget_Alerts_Sent`** — dedup tracking for the 90%-of-budget email alerts.

## Setup

1. **Create a Google Cloud service account** with the Google Sheets API enabled, and generate
   a JSON key for it.
2. **Share your Google Sheet** with the service account's email address (found in the JSON key
   as `client_email`), giving it Editor access.
3. Copy `.env.example` to `.env.local` and fill in:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the service account's `client_email`
   - `GOOGLE_PRIVATE_KEY` — the service account's `private_key` (keep the `\n` escapes, or paste
     real newlines — both work)
   - `GOOGLE_SHEET_ID` — the ID from your sheet's URL:
     `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`
4. **Set up the Gmail sync pipeline** — follow `apps-script/README.md` to populate
   `Invoices_Raw` automatically. (Optional: skip this and add data manually via the API or the
   Scan Receipt page instead.)
5. Install dependencies and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

6. Open http://localhost:3000.

## Linking a partner's data

To combine a partner's spending into a joint view while keeping each
person's raw data in their own, independently-owned Sheet:

1. **Partner creates their own copy** of the SpendSense Google Sheet (same
   tab structure — `Invoices_Raw`, `Budgets`, `Account_Balances`,
   `Income_Raw`), and pastes+runs `apps-script/Code.gs` on it under their
   own Google account, same as `apps-script/README.md` describes. This
   grants the script Gmail read/label and Sheets write access **on their
   account** — make sure they understand what they're approving.
2. Partner shares their new Sheet with your existing service account email
   (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) as an Editor — the same service account
   your own Sheet already uses; no second Google Cloud project needed.
3. Set `PARTNER_GOOGLE_SHEET_ID` in `.env.local` to their Sheet's ID.
   `getHouseholdInvoices()` / `getHouseholdIncome()` (`lib/sheets.ts`) then
   read and merge both Sheets, tagging each row `owner: "you" | "partner"` —
   nothing is written back to the partner's Sheet from this app.

**What this doesn't solve on its own:** every parser in `apps-script/Code.gs`
(ICICI/Axis/Scapia formats, Instamart's item layout, etc.) was built and
verified against *this account's* real emails — a partner using different
banks/apps will need their own parsers written and verified against *their*
real sample emails the same way (see `apps-script/README.md`'s "never guess
a parsing format" discipline). Until that's done, their Sheet will mostly
stay empty even once linked. The combined-dashboard UI (a "You / Partner /
Household" view) also isn't built yet — that's the next step once there's
real data in a partner Sheet to design and verify it against.

## API

- `GET /api/invoices` — returns all rows from `Invoices_Raw` as JSON.
- `POST /api/invoices` — appends new line items. Body is either an array of line items or
  `{ "items": [...] }`, where each item is:

  ```json
  {
    "date": "2026-09-01",
    "vendor": "Instacart",
    "orderId": "IC-12345",
    "item": "Whole milk",
    "category": "dairy_eggs",
    "amount": 4.99,
    "fee": 0,
    "quantity": 1
  }
  ```

- `GET /api/budgets` — returns all rows from `Budgets`.
- `POST /api/budgets` — upserts a budget: `{ "category": "fruits", "monthlyTarget": 150 }`.
- `POST /api/invoices/scan` — extracts line items from a receipt/invoice via free local text
  extraction (PDF) or OCR (photo). Body: `{ "imageBase64": "...", "mediaType": "image/jpeg" }`
  (JPEG/PNG/GIF/WebP/PDF). Returns `{ vendor, date, items: [{ item, category, amount, quantity }] }`
  for the client to review — it does not write to the sheet itself. No API key needed.

## Deploying to Vercel

This project needs zero configuration changes to deploy on Vercel:

1. Push this repo to GitHub/GitLab/Bitbucket and import it in Vercel, or run `vercel` from this
   directory.
2. In the Vercel project settings, add the environment variables from `.env.example`
   (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`).
3. Deploy. All data reads/writes happen server-side via API routes and server components, so no
   credentials are ever exposed to the browser.
