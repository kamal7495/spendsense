import { AccountBalanceRow, Category, IncomeRow, InvoiceRow } from "./types";

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
  investments: "monthly bulk", // not actually consumed for this category, just satisfies the exhaustive Record
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

/**
 * Total spend (amount + fee) for all rows whose date falls in the given
 * month/year. Excludes "investments" - a SIP contribution is money moved,
 * not spend, and would otherwise inflate the This month/Last month totals
 * this feeds (compareThisMonthToLast) in a misleading way.
 */
export function totalSpendForMonth(rows: InvoiceRow[], year: number, month: number): number {
  return rows.reduce((sum, row) => {
    if (row.category === "investments") return sum;
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

/** Rows dated within the last `days` days of `now`. Shared by every windowed view on the dashboard. */
export function filterByWindow(rows: InvoiceRow[], days: number, now: Date = new Date()): InvoiceRow[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return rows.filter((row) => {
    const d = parseDate(row.date);
    return d !== null && d >= cutoff;
  });
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

// Grocery-only spend (produce, dairy, pantry, snacks) — excludes dining_out
// since that's restaurant spend, not a grocery purchase, and excludes
// personal_care/household since those aren't food.
const GROCERY_CATEGORIES: Category[] = [...HOME_COOKED_CATEGORIES, "snacks"];

const GROCERY_TREND_GROUPS: { label: string; categories: Category[] }[] = [
  { label: "Fresh produce", categories: ["fruits", "vegetables"] },
  { label: "Snacks & sugary items", categories: ["snacks"] },
  { label: "Instant / packaged food", categories: ["instant_food"] },
];

export interface GroceryCategoryTrend {
  label: string;
  pctOfGrocerySpend: number;
  /** Percentage-point change vs. the prior period of equal length. Null when the prior period had no grocery spend to compare against. */
  pointChangeVsLastPeriod: number | null;
}

/**
 * What share of grocery spend (produce/dairy/pantry/snacks — not dining out)
 * goes to a few specific groups worth watching, and how that share moved vs.
 * the prior period of equal length. A rising snacks/instant-food share or a
 * falling fresh-produce share is a pattern worth surfacing even though none
 * of it is a budget overrun by itself.
 */
export function groceryCategoryTrend(
  rows: InvoiceRow[],
  days = 60,
  now: Date = new Date()
): GroceryCategoryTrend[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const prevCutoff = new Date(cutoff);
  prevCutoff.setDate(prevCutoff.getDate() - days);

  function grocerySpend(from: Date, to: Date): { byCategory: Map<Category, number>; total: number } {
    const byCategory = new Map<Category, number>();
    let total = 0;
    for (const row of rows) {
      if (!GROCERY_CATEGORIES.includes(row.category)) continue;
      const d = parseDate(row.date);
      if (!d || d < from || d >= to) continue;
      const amt = lineTotal(row);
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + amt);
      total += amt;
    }
    return { byCategory, total };
  }

  const current = grocerySpend(cutoff, now);
  const previous = grocerySpend(prevCutoff, cutoff);

  return GROCERY_TREND_GROUPS.map(({ label, categories }) => {
    const curAmt = categories.reduce((sum, c) => sum + (current.byCategory.get(c) ?? 0), 0);
    const prevAmt = categories.reduce((sum, c) => sum + (previous.byCategory.get(c) ?? 0), 0);
    const pct = current.total > 0 ? (curAmt / current.total) * 100 : 0;
    const prevPct = previous.total > 0 ? (prevAmt / previous.total) * 100 : null;

    return {
      label,
      pctOfGrocerySpend: pct,
      pointChangeVsLastPeriod: prevPct === null ? null : pct - prevPct,
    };
  });
}

export interface PriceChangeWatch {
  item: string;
  category: Category;
  /** Median amount / quantity across this item's prior purchases (excluding the latest one). */
  previousPrice: number;
  /** amount / quantity from the most recent purchase. */
  currentPrice: number;
  percentChange: number;
  lastOrdered: string;
}

const MIN_PRICE_CHANGE_PERCENT = 3; // below this, treat as noise (rounding, minor promo) rather than a real move

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Price per purchase (amount / quantity — NOT per kg/L, since item names
 * here don't reliably carry a pack size) for the latest purchase of each
 * grocery item vs. the MEDIAN of its prior purchases, when that moved by
 * more than a few percent. Median rather than "just the last purchase" is
 * deliberate: grocery delivery apps run one-off flash/promo prices (a real
 * observed case in this data — "Button Mushroom" at ₹1 once among several
 * ₹55-65 purchases) that would otherwise show up as a wild, misleading swing
 * off a single outlier. Needs 3+ purchases so the median means something.
 * This is still an honest, not a perfect, signal — same item name, presumed
 * same pack size, price paid changed — but a vendor swapping an item's pack
 * size without changing its listed name would show up here too, and there's
 * no way to tell the two apart from the data alone.
 */
export function priceChangeWatch(rows: InvoiceRow[]): PriceChangeWatch[] {
  const byItem = new Map<string, { category: Category; date: Date; unitPrice: number }[]>();

  for (const row of rows) {
    if (!GROCERY_CATEGORIES.includes(row.category)) continue;
    const d = parseDate(row.date);
    if (!d || !row.quantity) continue;

    const key = row.item.trim().toLowerCase();
    if (!key) continue;

    const unitPrice = row.amount / row.quantity;
    const existing = byItem.get(key);
    if (existing) existing.push({ category: row.category, date: d, unitPrice });
    else byItem.set(key, [{ category: row.category, date: d, unitPrice }]);
  }

  const watches: PriceChangeWatch[] = [];

  byItem.forEach((purchases, item) => {
    if (purchases.length < 3) return; // need 2+ prior purchases for a median that isn't just one number
    purchases.sort((a, b) => a.date.getTime() - b.date.getTime());

    const latest = purchases[purchases.length - 1];
    const priorPrices = purchases.slice(0, -1).map((p) => p.unitPrice);
    const previousPrice = median(priorPrices);
    if (previousPrice <= 0) return;

    const percentChange = ((latest.unitPrice - previousPrice) / previousPrice) * 100;
    if (Math.abs(percentChange) < MIN_PRICE_CHANGE_PERCENT) return;

    watches.push({
      item,
      category: latest.category,
      previousPrice,
      currentPrice: latest.unitPrice,
      percentChange,
      lastOrdered: latest.date.toISOString().slice(0, 10),
    });
  });

  return watches.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));
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

export type ReorderStatus = "overdue" | "due_soon" | "upcoming";

export interface GroceryReminder {
  item: string;
  category: Category;
  lastOrdered: string;
  daysSinceLastOrder: number;
  /** Average gap between orders, from this item's own history. */
  avgIntervalDays: number;
  /** avgIntervalDays - daysSinceLastOrder. Negative/zero means it's overdue. */
  daysUntilDue: number;
  status: ReorderStatus;
}

const DUE_SOON_WITHIN_DAYS = 5; // due within this many days counts as "coming up"
const UPCOMING_WINDOW_DAYS = 14; // items due further out than this aren't worth surfacing yet

/**
 * For each recurring grocery essential (produce, dairy_eggs, staples),
 * compares how long it's been since you last bought it against how often
 * you typically reorder it (derived from the gaps between its own past
 * orders) — a personalized reminder rather than a fixed schedule per
 * category. A perishable like milk and a pantry item like rice naturally
 * end up with very different average intervals; this adapts per item
 * instead of assuming one cadence per category. Needs at least 3 orders so
 * the average interval means something. Returns items due within the next
 * `UPCOMING_WINDOW_DAYS` (including already-overdue ones), soonest-due
 * first — a short "coming up" list rather than a full log of every item
 * ever bought 3+ times.
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
    const daysUntilDue = avgIntervalDays - daysSinceLastOrder;
    if (daysUntilDue > UPCOMING_WINDOW_DAYS) return;

    const status: ReorderStatus =
      daysUntilDue <= 0 ? "overdue" : daysUntilDue <= DUE_SOON_WITHIN_DAYS ? "due_soon" : "upcoming";

    reminders.push({
      item,
      category,
      lastOrdered: lastOrdered.toISOString().slice(0, 10),
      daysSinceLastOrder: Math.round(daysSinceLastOrder),
      avgIntervalDays: Math.round(avgIntervalDays),
      daysUntilDue: Math.round(daysUntilDue),
      status,
    });
  });

  return reminders.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

export interface TransactionDetail {
  date: string;
  item: string;
  amount: number;
}

export interface VendorSpend {
  vendor: string;
  total: number;
  /** Individual line items behind this vendor's total, most recent first. */
  transactions: TransactionDetail[];
}

export interface CategoryVendorBreakdown {
  category: Category;
  total: number;
  vendors: VendorSpend[];
}

/** For each category, which vendor/card the spend actually went through, and the transactions behind it. */
export function spendByCategoryAndVendor(rows: InvoiceRow[]): CategoryVendorBreakdown[] {
  const byCategory = new Map<Category, Map<string, TransactionDetail[]>>();

  for (const row of rows) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, new Map());
    const byVendor = byCategory.get(row.category)!;
    const transactions = byVendor.get(row.vendor) ?? [];
    transactions.push({ date: row.date, item: row.item, amount: lineTotal(row) });
    byVendor.set(row.vendor, transactions);
  }

  return Array.from(byCategory.entries())
    .map(([category, byVendor]) => {
      const vendors = Array.from(byVendor.entries())
        .map(([vendor, transactions]) => {
          const sorted = transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
          return {
            vendor,
            total: sorted.reduce((sum, t) => sum + t.amount, 0),
            transactions: sorted,
          };
        })
        .sort((a, b) => b.total - a.total);
      const total = vendors.reduce((sum, v) => sum + v.total, 0);
      return { category, total, vendors };
    })
    .sort((a, b) => b.total - a.total);
}

export interface EstimatedCardBalance {
  account: string;
  openingBalance: number;
  asOfDate: string;
  spendSince: number;
  /** openingBalance + spendSince - NOT a real balance: see the warning in components/CardBalancesCard.tsx. */
  estimatedBalance: number;
}

/**
 * Estimated "what you probably owe now" per configured card: a manually
 * entered opening balance plus every charge recorded since that date. This
 * is NOT a real balance - SpendSense has no visibility into payments made
 * toward a card (those are deliberately excluded elsewhere to avoid
 * double-counting the same spend), so the estimate only ever grows and will
 * drift further from reality the longer it goes without the opening
 * balance being reset to a real, freshly-checked number.
 */
export function estimatedCardBalances(
  rows: InvoiceRow[],
  balances: AccountBalanceRow[]
): EstimatedCardBalance[] {
  return balances.map(({ account, openingBalance, asOfDate }) => {
    // Plain string comparison is correct and simpler than parsing to Date -
    // both sides are already "YYYY-MM-DD" ISO strings, which sort lexically
    // the same as chronologically.
    const spendSince = rows
      .filter((r) => r.vendor === account && r.date > asOfDate)
      .reduce((sum, r) => sum + lineTotal(r), 0);

    return {
      account,
      openingBalance,
      asOfDate,
      spendSince,
      estimatedBalance: openingBalance + spendSince,
    };
  });
}

export interface ItemPurchaseSummary {
  item: string;
  category: Category;
  /** Sum of the quantity column across every purchase in the window - a unit count, not a weight/volume. */
  totalQuantity: number;
  orderCount: number;
  totalAmount: number;
  lastOrdered: string;
}

/**
 * Every distinct item bought in the last `days` days, with how much of it
 * (unit count) and how many separate purchases - unlike frequentItems, this
 * has no "2+ times" floor, so a one-off purchase still shows up. Answers
 * "what did I actually buy in this window", not "what's worth a reorder
 * reminder". totalQuantity is a plain unit count (rows from sources that
 * don't carry a real per-item quantity default to 1 per purchase) - it
 * can't be converted to liters/kg, since that would require parsing a
 * package size out of free-text item names, which isn't reliable across
 * how differently every product describes its own size.
 */
export function itemPurchaseSummary(
  rows: InvoiceRow[],
  days: number,
  now: Date = new Date()
): ItemPurchaseSummary[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);

  const byItem = new Map<
    string,
    { category: Category; totalQuantity: number; orderCount: number; totalAmount: number; lastOrdered: Date }
  >();

  for (const row of rows) {
    const d = parseDate(row.date);
    if (!d || d < cutoff) continue;

    const key = row.item.trim().toLowerCase();
    if (!key) continue;

    const amount = lineTotal(row);
    const existing = byItem.get(key);
    if (existing) {
      existing.totalQuantity += row.quantity;
      existing.orderCount += 1;
      existing.totalAmount += amount;
      if (d > existing.lastOrdered) existing.lastOrdered = d;
    } else {
      byItem.set(key, {
        category: row.category,
        totalQuantity: row.quantity,
        orderCount: 1,
        totalAmount: amount,
        lastOrdered: d,
      });
    }
  }

  return Array.from(byItem.entries())
    .map(([item, v]) => ({
      item,
      category: v.category,
      totalQuantity: v.totalQuantity,
      orderCount: v.orderCount,
      totalAmount: v.totalAmount,
      lastOrdered: v.lastOrdered.toISOString().slice(0, 10),
    }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);
}

export interface MonthlySavingsRate {
  year: number;
  month: number;
  label: string; // e.g. "Jul 2026"
  income: number;
  expense: number;
  /** (income - expense) / income. Null when there's no income recorded for the month yet. */
  savingsRate: number | null;
}

/**
 * Trailing N-month (default 3) income vs. expense, and the resulting savings
 * rate for each month. Expense reuses totalSpendForMonth, which already
 * excludes "investments" - a SIP contribution is itself saved money, not
 * consumption, so it shouldn't count against the savings rate twice.
 */
export function savingsRateTrend(
  invoices: InvoiceRow[],
  income: IncomeRow[],
  monthsBack = 3,
  now: Date = new Date()
): MonthlySavingsRate[] {
  const months: MonthlySavingsRate[] = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth();

    const expense = totalSpendForMonth(invoices, year, month);
    const incomeTotal = income.reduce((sum, row) => {
      const rd = parseDate(row.date);
      if (!rd || rd.getFullYear() !== year || rd.getMonth() !== month) return sum;
      return sum + row.amount;
    }, 0);

    months.push({
      year,
      month,
      label: d.toLocaleString("en-US", { month: "short", year: "numeric" }),
      income: incomeTotal,
      expense,
      savingsRate: incomeTotal > 0 ? (incomeTotal - expense) / incomeTotal : null,
    });
  }

  return months;
}
