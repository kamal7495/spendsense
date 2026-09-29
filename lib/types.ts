export const CATEGORIES = [
  // Grocery (original SpendSense scope) — split from a single "produce" so
  // fruits and vegetables aren't blended, and raw meat/fish get their own
  // bucket instead of hiding inside "staples" alongside dry pantry goods.
  "fruits",
  "vegetables",
  "meat_seafood",
  "dairy_eggs",
  // "staples" split into specific pantry categories rather than one blended
  // bucket — rice, oils, grains, pulses, spices, sugar, tea/coffee, bakery,
  // and instant/ready-to-eat food each get their own line.
  "rice",
  "oils",
  "grains",
  "pulses",
  "spices",
  "sugar",
  "tea_coffee",
  "bakery",
  "instant_food",
  "snacks",
  "personal_care",
  "household",
  // General expenses
  "dining_out",
  "transport",
  "utilities",
  "rent",
  "entertainment",
  "subscriptions",
  "shopping",
  "health",
  "travel",
  "transfers",
  "fees",
  "gifts",
  "other",
  // Money moved into investments (mutual fund SIPs, etc.) - kept out of the
  // "This month"/"Last month" spend totals in lib/analytics.ts, since it's
  // building wealth, not being consumed. Still shows up as its own category
  // in per-category breakdowns and the budget page, just not folded into
  // "spend."
  "investments",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface InvoiceRow {
  date: string; // ISO date string, e.g. "2026-09-04"
  vendor: string;
  orderId: string;
  item: string;
  category: Category;
  amount: number;
  fee: number;
  quantity: number; // units purchased in this line; defaults to 1 when unknown
  /**
   * Set only when merging rows from multiple people's Sheets into one
   * household view (see getHouseholdInvoices in lib/sheets.ts) - undefined
   * for a single-person setup, so it never needs handling elsewhere.
   */
  owner?: string;
}

export interface InvoiceLineItem {
  date: string;
  vendor: string;
  orderId: string;
  item: string;
  category: Category;
  amount: number;
  fee?: number;
  quantity?: number;
}

export interface BudgetRow {
  category: Category;
  monthlyTarget: number;
}

export interface AccountBalanceRow {
  /** Matches an InvoiceRow.vendor exactly, e.g. "Federal Bank (Scapia Card)". */
  account: string;
  /** What you owed on this card as of asOfDate - a manually entered reference point. */
  openingBalance: number;
  asOfDate: string; // ISO date string
}

export interface IncomeRow {
  date: string; // ISO date string
  source: string;
  description: string;
  amount: number;
  /** Set only when merging multiple people's Income_Raw into one household view - see InvoiceRow.owner. */
  owner?: string;
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
