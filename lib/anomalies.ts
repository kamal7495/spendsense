import { Category, InvoiceRow } from "./types";
import { CATEGORY_LABEL } from "./labels";
import { detectRecurringCharges } from "./recurring";

function lineTotal(row: InvoiceRow): number {
  return row.amount + row.fee;
}

function parseDate(dateStr: string): Date | null {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function median(sortedValues: number[]): number {
  const mid = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 !== 0
    ? sortedValues[mid]
    : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

function quartile(sortedValues: number[], q: number): number {
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sortedValues[base + 1] !== undefined
    ? sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base])
    : sortedValues[base];
}

export interface AnomalyFlag {
  date: string;
  vendor: string;
  item: string;
  category: Category;
  amount: number;
  type: "duplicate" | "outlier";
  reason: string;
}

// Itemized orders (Instamart, and any per-product source) routinely have
// several different items priced the same by coincidence - two different
// ₹20 vegetables on the same day is common, not a duplicate charge. Real
// duplicate-charge risk in this pipeline (confirmed historical cases) is a
// single transaction captured twice by two card/bill-pay alert sources,
// which shows up as one row per source - a domain where "vendor" is the
// card/platform and each row is a whole transaction, not a sub-item. So
// duplicate detection is scoped to non-grocery categories; see the same
// exclusion list and reasoning in lib/recurring.ts.
// "fees" joins the list for the same reason: a delivery/handling fee is an
// ancillary per-order charge that legitimately repeats at the same small
// amount across many genuinely separate orders (confirmed against real data
// - Instamart's ~₹11-12 handling fee kept getting flagged as a "duplicate"
// of itself across unrelated orders days apart).
const ITEMIZED_CATEGORIES: Category[] = [
  "fruits", "vegetables", "meat_seafood", "dairy_eggs",
  "rice", "oils", "grains", "pulses", "spices", "sugar", "tea_coffee", "bakery", "instant_food",
  "snacks", "personal_care", "household", "fees",
];

const DUPLICATE_MAX_GAP_DAYS = 3;
const DUPLICATE_MAX_AMOUNT_DIFF_PCT = 0.01;

/**
 * Same vendor, same item text, amount within ~1%, within a few days of each
 * other - most likely the same real charge recorded twice (e.g. a Gmail
 * thread processed twice, or an alert and its resend both captured).
 * Different orderIds are required, since line items that share an orderId
 * are just multiple items in one legitimate order.
 */
export function detectDuplicateCharges(rows: InvoiceRow[]): AnomalyFlag[] {
  const candidates = rows.filter((r) => !ITEMIZED_CATEGORIES.includes(r.category));

  const byKey = new Map<string, { row: InvoiceRow; date: Date }[]>();
  for (const row of candidates) {
    const date = parseDate(row.date);
    if (!date) continue;
    const key = `${normalize(row.vendor)}::${normalize(row.item)}`;
    const group = byKey.get(key) ?? [];
    group.push({ row, date });
    byKey.set(key, group);
  }

  const flags: AnomalyFlag[] = [];
  for (const group of Array.from(byKey.values())) {
    const sorted = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const gapDays = (sorted[j].date.getTime() - sorted[i].date.getTime()) / (1000 * 60 * 60 * 24);
        if (gapDays > DUPLICATE_MAX_GAP_DAYS) break; // sorted by date - no later j will be closer

        if (sorted[i].row.orderId === sorted[j].row.orderId) continue;

        const amountA = lineTotal(sorted[i].row);
        const amountB = lineTotal(sorted[j].row);
        if (amountA === 0) continue;
        const diffPct = Math.abs(amountB - amountA) / Math.abs(amountA);
        if (diffPct > DUPLICATE_MAX_AMOUNT_DIFF_PCT) continue;

        flags.push({
          date: sorted[j].row.date,
          vendor: sorted[j].row.vendor,
          item: sorted[j].row.item,
          category: sorted[j].row.category,
          amount: amountB,
          type: "duplicate",
          reason: `Possible duplicate of a ${sorted[i].row.vendor} charge ${Math.round(gapDays)} day${
            Math.round(gapDays) === 1 ? "" : "s"
          } earlier`,
        });
      }
    }
  }
  return flags;
}

const MIN_OCCURRENCES_FOR_OUTLIER_CHECK = 4;
const MIN_OCCURRENCES_FOR_MAD = 5;
const MODIFIED_Z_THRESHOLD = 3.0;
const IQR_MULTIPLIER = 1.5;

/**
 * Per-category outliers, using median/MAD (robust to the skew personal
 * spend data always has) rather than mean/stddev, per-category rather than
 * one global threshold. Only flags unusually HIGH charges - an unusually
 * cheap one isn't the kind of surprise worth a flag. Falls back to IQR when
 * there aren't enough points for MAD to mean anything, and skips categories
 * with under 4 transactions entirely rather than guess from too little data.
 *
 * Excludes merchants already surfaced by detectRecurringCharges: a known
 * monthly bill (e.g. an insurance premium) legitimately dwarfs a noisy
 * catch-all category's median every time it lands, which would otherwise
 * re-flag the exact same recurring charge as a fresh "outlier" every single
 * month - redundant with, not additional to, the recurring-charges card.
 */
export function detectOutliers(rows: InvoiceRow[]): AnomalyFlag[] {
  const recurringMerchants = new Set(
    detectRecurringCharges(rows).map((s) => normalize(s.merchant))
  );

  const byCategory = new Map<Category, InvoiceRow[]>();
  for (const row of rows) {
    if (recurringMerchants.has(normalize(row.item))) continue;
    const group = byCategory.get(row.category) ?? [];
    group.push(row);
    byCategory.set(row.category, group);
  }

  const flags: AnomalyFlag[] = [];

  for (const [category, group] of Array.from(byCategory.entries())) {
    if (group.length < MIN_OCCURRENCES_FOR_OUTLIER_CHECK) continue;

    const withAmounts = group.map((row) => ({ row, amount: lineTotal(row) }));
    const sortedAmounts = withAmounts.map((x) => x.amount).sort((a, b) => a - b);
    const med = median(sortedAmounts);

    const reasonFor = (amount: number) =>
      `${(amount / med).toFixed(1)}x your typical ${CATEGORY_LABEL[category]} charge (median ${med.toFixed(0)})`;

    if (group.length >= MIN_OCCURRENCES_FOR_MAD) {
      const deviations = sortedAmounts.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
      const madValue = median(deviations);
      if (madValue > 0) {
        for (const { row, amount } of withAmounts) {
          const modifiedZ = (0.6745 * (amount - med)) / madValue;
          if (modifiedZ >= MODIFIED_Z_THRESHOLD) {
            flags.push({
              date: row.date,
              vendor: row.vendor,
              item: row.item,
              category,
              amount,
              type: "outlier",
              reason: reasonFor(amount),
            });
          }
        }
        continue;
      }
    }

    // IQR fallback: too few points for MAD, or MAD is 0 (most amounts identical).
    const q1 = quartile(sortedAmounts, 0.25);
    const q3 = quartile(sortedAmounts, 0.75);
    const iqr = q3 - q1;
    if (iqr === 0) continue;
    const upperBound = q3 + IQR_MULTIPLIER * iqr;
    for (const { row, amount } of withAmounts) {
      if (amount > upperBound) {
        flags.push({
          date: row.date,
          vendor: row.vendor,
          item: row.item,
          category,
          amount,
          type: "outlier",
          reason: reasonFor(amount),
        });
      }
    }
  }

  return flags;
}

export function detectAnomalies(rows: InvoiceRow[]): AnomalyFlag[] {
  const duplicates = detectDuplicateCharges(rows);
  const outliers = detectOutliers(rows);
  return [...duplicates, ...outliers].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
