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

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
