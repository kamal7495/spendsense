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
- **Scan Receipt** (`/scan`) — photograph or upload a grocery receipt; Claude reads the items,
  guesses an amount/quantity/category for each, and shows an editable review table before
  anything is written to the sheet. Requires an `ANTHROPIC_API_KEY` — see below.

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
shopping, health, travel, transfers, fees, gifts, other
```

(see `lib/types.ts` for the source of truth, and `lib/labels.ts` for display names)

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
   - `ANTHROPIC_API_KEY` — only needed for the Scan Receipt page; get one at
     [console.anthropic.com](https://console.anthropic.com/). The rest of the app works fine
     without it.
4. **Set up the Gmail sync pipeline** — follow `apps-script/README.md` to populate
   `Invoices_Raw` automatically. (Optional: skip this and add data manually via the API or the
   Scan Receipt page instead.)
5. Install dependencies and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

6. Open http://localhost:3000.

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
- `POST /api/invoices/scan` — extracts line items from a receipt photo. Body:
  `{ "imageBase64": "...", "mediaType": "image/jpeg" }` (JPEG/PNG/GIF/WebP). Returns
  `{ vendor, date, items: [{ item, category, amount, quantity }] }` for the client to review —
  it does not write to the sheet itself. Requires `ANTHROPIC_API_KEY`.

## Deploying to Vercel

This project needs zero configuration changes to deploy on Vercel:

1. Push this repo to GitHub/GitLab/Bitbucket and import it in Vercel, or run `vercel` from this
   directory.
2. In the Vercel project settings, add the environment variables from `.env.example`
   (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, and
   `ANTHROPIC_API_KEY` if you want Scan Receipt to work in production).
3. Deploy. All data reads/writes and the Claude API call happen server-side via API routes and
   server components, so no credentials are ever exposed to the browser.
