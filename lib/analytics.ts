import { Category, InvoiceRow } from "./types";

export type Cadence = "monthly bulk" | "weekly" | "perishable" | "occasional";

const CADENCE_BY_CATEGORY: Record<Category, Cadence> = {
  dairy_eggs: "weekly",
  fruits: "perishable",
  vegetables: "perishable",
  meat_seafood: "perishable",
  rice: "monthly bulk",
  oils: "monthly bulk",
  grains: "monthly bulk",
  pulses: "monthly bulk",
  spices: "monthly bulk",
  sugar: "monthly bulk",
  tea_coffee: "monthly bulk",
  bakery: "weekly",
  instant_food: "monthly bulk",
  snacks: "occasional",
  personal_care: "occasional",
  household: "occasional",
  dining_out: "occasional",
  transport: "occasional",
  utilities: "monthly bulk",
  rent: "monthly bulk",
  entertainment: "occasional",
  subscriptions: "monthly bulk",
  shopping: "occasional",
  health: "occasional",
  travel: "occasional",
  transfers: "occasional",
  fees: "occasional",
  gifts: "occasional",
  other: "occasional",
};

export function suggestedCadence(category: Category): Cadence {
  return CADENCE_BY_CATEGORY[category] ?? "occasional";
}

function lineTotal(row: InvoiceRow): number {
  return row.amount + row.fee;
}

function parseDate(dateStr: string): Date | null {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Total spend (amount + fee) for all rows whose date falls in the given month/year. */
export function totalSpendForMonth(rows: InvoiceRow[], year: number, month: number): number {
  return rows.reduce((sum, row) => {
    const d = parseDate(row.date);
    if (!d) return sum;
    if (d.getFullYear() === year && d.getMonth() === month) {
      return sum + lineTotal(row);
    }
    return sum;
  }, 0);
}

export interface MonthComparison {
  thisMonth: number;
  lastMonth: number;
}

export function compareThisMonthToLast(rows: InvoiceRow[], now: Date = new Date()): MonthComparison {
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);

  return {
    thisMonth: totalSpendForMonth(rows, thisYear, thisMonth),
    lastMonth: totalSpendForMonth(rows, lastMonthDate.getFullYear(), lastMonthDate.getMonth()),
  };
}

export interface CategorySpend {
  category: Category;
  total: number;
}

export function spendByCategory(rows: InvoiceRow[]): CategorySpend[] {
  const totals = new Map<Category, number>();
  for (const row of rows) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + lineTotal(row));
  }
  return Array.from(totals.entries())
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/** Spend by category restricted to rows dated within the given month/year. */
export function spendByCategoryForMonth(
  rows: InvoiceRow[],
  year: number,
  month: number
): CategorySpend[] {
  const inMonth = rows.filter((row) => {
    const d = parseDate(row.date);
    return d && d.getFullYear() === year && d.getMonth() === month;
  });
  return spendByCategory(inMonth);
}

export interface FrequentItem {
  item: string;
  category: Category;
  count: number;
  cadence: Cadence;
  lastOrdered: string;
}

/** Items ordered 2+ times in the last N days, sorted by frequency descending. */
export function frequentItems(rows: InvoiceRow[], days = 60, now: Date = new Date()): FrequentItem[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);

  const byItem = new Map<string, { category: Category; count: number; lastOrdered: Date }>();

  for (const row of rows) {
    const d = parseDate(row.date);
    if (!d || d < cutoff) continue;

    const key = row.item.trim().toLowerCase();
    if (!key) continue;

    const existing = byItem.get(key);
    if (existing) {
      existing.count += 1;
      if (d > existing.lastOrdered) existing.lastOrdered = d;
    } else {
      byItem.set(key, { category: row.category, count: 1, lastOrdered: d });
    }
  }

  return Array.from(byItem.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([item, v]) => ({
      item,
      category: v.category,
      count: v.count,
      cadence: suggestedCadence(v.category),
      lastOrdered: v.lastOrdered.toISOString().slice(0, 10),
    }))
    .sort((a, b) => b.count - a.count);
}

// Home-cooked grocery staples vs. restaurant/convenience-snack spend. A
// rough proxy for eating habits from purchase data alone — not a nutrition
// judgement, just what fraction of food money goes to cooking vs ordering in.
// The pantry categories a single "staples" bucket used to cover.
export const PANTRY_CATEGORIES: Category[] = [
  "rice", "oils", "grains", "pulses", "spices", "sugar", "tea_coffee", "bakery", "instant_food",
];

const HOME_COOKED_CATEGORIES: Category[] = [
  "fruits", "vegetables", "meat_seafood", "dairy_eggs", ...PANTRY_CATEGORIES,
];
const CONVENIENCE_CATEGORIES: Category[] = ["dining_out", "snacks"];

export interface HealthSnapshot {
  windowDays: number;
  homeCookedSpend: number;
  convenienceSpend: number;
  /** homeCookedSpend / (homeCookedSpend + convenienceSpend), 0 if no food spend at all. */
  homeCookedRatio: number;
  diningOutOrders: number;
  diningOutPerWeek: number;
  topConvenienceItems: FrequentItem[];
}

export function healthSnapshot(rows: InvoiceRow[], days = 60, now: Date = new Date()): HealthSnapshot {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);

  const inWindow = rows.filter((row) => {
    const d = parseDate(row.date);
    return d && d >= cutoff;
  });

  let homeCookedSpend = 0;
  let convenienceSpend = 0;
  const diningOutOrderIds = new Set<string>();

  for (const row of inWindow) {
    const total = lineTotal(row);
    if (HOME_COOKED_CATEGORIES.includes(row.category)) homeCookedSpend += total;
    if (CONVENIENCE_CATEGORIES.includes(row.category)) convenienceSpend += total;
    if (row.category === "dining_out") diningOutOrderIds.add(row.orderId);
  }

  const foodTotal = homeCookedSpend + convenienceSpend;
  const weeks = days / 7;

  return {
    windowDays: days,
    homeCookedSpend,
    convenienceSpend,
    homeCookedRatio: foodTotal > 0 ? homeCookedSpend / foodTotal : 0,
    diningOutOrders: diningOutOrderIds.size,
    diningOutPerWeek: diningOutOrderIds.size / weeks,
    topConvenienceItems: frequentItems(inWindow, days, now).filter((item) =>
      CONVENIENCE_CATEGORIES.includes(item.category)
    ),
  };
}

export interface MonthlyStapleNeed {
  item: string;
  category: Category;
  /** Average units bought per month, based on order history. */
  avgQuantityPerMonth: number;
  /** Total times ordered within the analysis window. */
  orderCount: number;
  lastOrdered: string;
}

/**
 * Staples that recur often enough to plan a monthly restock for, with an
 * estimated quantity per month derived from order history. Quantity is only
 * as accurate as what's recorded per line item — rows from sources that
 * don't carry a real unit count default to 1, so this is a reasonable
 * planning estimate, not an exact count.
 */
export function monthlyStaplesList(
  rows: InvoiceRow[],
  days = 90,
  now: Date = new Date()
): MonthlyStapleNeed[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);

  const byItem = new Map<string, { category: Category; totalQuantity: number; orderCount: number; lastOrdered: Date }>();

  for (const row of rows) {
    if (!PANTRY_CATEGORIES.includes(row.category)) continue;
    const d = parseDate(row.date);
    if (!d || d < cutoff) continue;

    const key = row.item.trim().toLowerCase();
    if (!key) continue;

    const existing = byItem.get(key);
    if (existing) {
      existing.totalQuantity += row.quantity;
      existing.orderCount += 1;
      if (d > existing.lastOrdered) existing.lastOrdered = d;
    } else {
      byItem.set(key, { category: row.category, totalQuantity: row.quantity, orderCount: 1, lastOrdered: d });
    }
  }

  const months = days / 30;

  return Array.from(byItem.entries())
    .filter(([, v]) => v.orderCount >= 2) // recurring, not a one-off purchase
    .map(([item, v]) => ({
      item,
      category: v.category,
      avgQuantityPerMonth: v.totalQuantity / months,
      orderCount: v.orderCount,
      lastOrdered: v.lastOrdered.toISOString().slice(0, 10),
    }))
    .sort((a, b) => b.avgQuantityPerMonth - a.avgQuantityPerMonth);
}

export type ReorderStatus = "overdue" | "due_soon" | "on_track";

export interface GroceryReminder {
  item: string;
  category: Category;
  lastOrdered: string;
  daysSinceLastOrder: number;
  /** Average gap between orders, from this item's own history. */
  avgIntervalDays: number;
  status: ReorderStatus;
}

const DUE_SOON_THRESHOLD = 0.8; // fraction of avgIntervalDays that counts as "coming up"

/**
 * For each recurring grocery essential (produce, dairy_eggs, staples),
 * compares how long it's been since you last bought it against how often
 * you typically reorder it (derived from the gaps between its own past
 * orders) — a personalized reminder rather than a fixed schedule per
 * category. A perishable like milk and a pantry item like rice naturally
 * end up with very different average intervals; this adapts per item
 * instead of assuming one cadence per category. Needs at least 3 orders so
 * the average interval means something; returns only items due soon or
 * overdue, most overdue first.
 */
export function groceryReorderReminders(rows: InvoiceRow[], now: Date = new Date()): GroceryReminder[] {
  const byItem = new Map<string, { category: Category; dates: Date[] }>();

  for (const row of rows) {
    if (!HOME_COOKED_CATEGORIES.includes(row.category)) continue;
    const d = parseDate(row.date);
    if (!d) continue;

    const key = row.item.trim().toLowerCase();
    if (!key) continue;

    const existing = byItem.get(key);
    if (existing) existing.dates.push(d);
    else byItem.set(key, { category: row.category, dates: [d] });
  }

  const reminders: GroceryReminder[] = [];

  byItem.forEach(({ category, dates }, item) => {
    if (dates.length < 3) return; // need 2+ gaps to trust an average interval
    dates.sort((a, b) => a.getTime() - b.getTime());

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24));
    }
    const avgIntervalDays = gaps.reduce((a, b) => a + b, 0) / gaps.length;

    const lastOrdered = dates[dates.length - 1];
    const daysSinceLastOrder = (now.getTime() - lastOrdered.getTime()) / (1000 * 60 * 60 * 24);

    const ratio = avgIntervalDays > 0 ? daysSinceLastOrder / avgIntervalDays : 0;
    const status: ReorderStatus = ratio >= 1 ? "overdue" : ratio >= DUE_SOON_THRESHOLD ? "due_soon" : "on_track";
    if (status === "on_track") return;

    reminders.push({
      item,
      category,
      lastOrdered: lastOrdered.toISOString().slice(0, 10),
      daysSinceLastOrder: Math.round(daysSinceLastOrder),
      avgIntervalDays: Math.round(avgIntervalDays),
      status,
    });
  });

  return reminders.sort((a, b) => b.daysSinceLastOrder / b.avgIntervalDays - a.daysSinceLastOrder / a.avgIntervalDays);
}

export interface VendorSpend {
  vendor: string;
  total: number;
}

export interface CategoryVendorBreakdown {
  category: Category;
  total: number;
  vendors: VendorSpend[];
}

/** For each category, which vendor/card the spend actually went through. */
export function spendByCategoryAndVendor(rows: InvoiceRow[]): CategoryVendorBreakdown[] {
  const byCategory = new Map<Category, Map<string, number>>();

  for (const row of rows) {
    const total = lineTotal(row);
    if (!byCategory.has(row.category)) byCategory.set(row.category, new Map());
    const byVendor = byCategory.get(row.category)!;
    byVendor.set(row.vendor, (byVendor.get(row.vendor) ?? 0) + total);
  }

  return Array.from(byCategory.entries())
    .map(([category, byVendor]) => {
      const vendors = Array.from(byVendor.entries())
        .map(([vendor, total]) => ({ vendor, total }))
        .sort((a, b) => b.total - a.total);
      const total = vendors.reduce((sum, v) => sum + v.total, 0);
      return { category, total, vendors };
    })
    .sort((a, b) => b.total - a.total);
}
