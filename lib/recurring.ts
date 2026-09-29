import { Category, InvoiceRow } from "./types";

function lineTotal(row: InvoiceRow): number {
  return row.amount + row.fee;
}

function parseDate(dateStr: string): Date | null {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Matches lib/cashflow.ts's toLocalIsoDate: toISOString() converts to UTC
// first, which silently shifts the date back a day for timezones ahead of
// UTC (e.g. IST) when the time is near midnight.
function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Groceries/pantry/personal-care items can coincidentally recur on a
// near-monthly rhythm (the same fruit or snack bought again a month later)
// without being a "bill" in the sense this feature targets - and that
// territory already has dedicated coverage via groceryReorderReminders /
// monthlyStaplesList on the Groceries page. Excluding it here keeps this
// card about subscriptions/utilities/rent/insurance-type recurring charges,
// not grocery restocking.
const NON_BILL_CATEGORIES: Category[] = [
  "fruits", "vegetables", "meat_seafood", "dairy_eggs",
  "rice", "oils", "grains", "pulses", "spices", "sugar", "tea_coffee", "bakery", "instant_food",
  "snacks", "personal_care", "household",
];

export type RecurringCadence = "weekly" | "monthly" | "annual";

const CADENCE_RULES: { cadence: RecurringCadence; minGap: number; maxGap: number; minOccurrences: number }[] = [
  { cadence: "weekly", minGap: 6, maxGap: 8, minOccurrences: 3 },
  { cadence: "monthly", minGap: 25, maxGap: 35, minOccurrences: 3 },
  { cadence: "annual", minGap: 350, maxGap: 380, minOccurrences: 2 },
];

// A gap-consistent series of wildly different amounts (e.g. monthly Amazon
// purchases that happen to land ~30 days apart by chance) isn't a bill -
// it's coincidence. Require amounts to be reasonably stable before calling
// something "recurring", since Priority 2's price-creep baseline only means
// anything against a series that was stable to begin with. This tolerance
// check isn't in the original brief; added because the schema here bills
// everything through a card "vendor" (ICICI, Axis...) rather than the
// merchant, so merchant identity - and the false-positive risk - lives in
// `item`, not `vendor`. See groupingKey below.
const MAX_AMOUNT_COEFFICIENT_OF_VARIATION = 0.5;

function coefficientOfVariation(amounts: number[]): number {
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  if (mean === 0) return Infinity;
  const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
  return Math.sqrt(variance) / mean;
}

export interface PriceCreepFlag {
  baseline: number;
  lastAmount: number;
  increaseAbsolute: number;
  increasePercent: number; // e.g. 0.12 for +12%
}

export interface RecurringSeries {
  /** The recurring merchant/charge name - e.g. "Claude subscription (Anthropic)", "Netflix". */
  merchant: string;
  category: Category;
  /** The card/vendor it was most recently billed through. */
  billedVia: string;
  cadence: RecurringCadence;
  occurrenceCount: number;
  averageAmount: number;
  lastAmount: number;
  lastDate: string;
  nextExpectedDate: string;
  priceCreep: PriceCreepFlag | null;
}

const PRICE_CREEP_ABSOLUTE_FLOOR = 150; // ₹ - the Rocket Money precedent ($1.99) is USD-specific
const PRICE_CREEP_RELATIVE_FLOOR = 0.05; // 5%

/**
 * Detects recurring charges (subscriptions, utilities, rent, insurance...)
 * and flags any whose latest charge has crept up from its own baseline.
 *
 * Grouped by `item`, not `vendor`: in this schema `vendor` is almost always
 * the card/platform doing the billing (ICICI Bank Credit Card, Axis Bank),
 * while the actual recurring merchant identity - Netflix, an insurance
 * premium, a utility biller - lives in `item`. Grouping by vendor would
 * lump every one-off ICICI purchase into one meaningless "series".
 */
export function detectRecurringCharges(rows: InvoiceRow[]): RecurringSeries[] {
  const byMerchant = new Map<string, InvoiceRow[]>();
  for (const row of rows) {
    if (NON_BILL_CATEGORIES.includes(row.category)) continue;
    const key = normalize(row.item);
    if (!key) continue;
    const group = byMerchant.get(key) ?? [];
    group.push(row);
    byMerchant.set(key, group);
  }

  const series: RecurringSeries[] = [];

  for (const group of Array.from(byMerchant.values())) {
    const dated = group
      .map((row) => ({ row, date: parseDate(row.date) }))
      .filter((x): x is { row: InvoiceRow; date: Date } => x.date !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (dated.length < 2) continue;

    const gaps: number[] = [];
    for (let i = 1; i < dated.length; i++) {
      gaps.push((dated[i].date.getTime() - dated[i - 1].date.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Median, not "every gap" - real mailboxes miss the occasional email
    // (sync backlog, a differently-worded subject line that month), which
    // shows up as one outlier-large gap. A strict "every gap must be in
    // range" check would wrongly disqualify a real monthly bill just
    // because one month's alert never arrived. The median is robust to
    // exactly one such outlier without being fooled by a genuinely
    // different cadence (e.g. a mix of weekly and monthly gaps still
    // medians toward whichever cadence has more occurrences).
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

    const rule = CADENCE_RULES.find(
      (r) => dated.length >= r.minOccurrences && medianGap >= r.minGap && medianGap <= r.maxGap
    );
    if (!rule) continue;

    const amounts = dated.map((x) => lineTotal(x.row));
    // Check stability over the PRIOR history only, not the latest charge -
    // otherwise a genuine price hike (the exact thing Priority 2 wants to
    // catch) inflates its own variance and gets filtered out here before
    // ever reaching the price-creep check below.
    const lastAmount = amounts[amounts.length - 1];
    const priorAmounts = amounts.slice(0, -1);
    if (
      priorAmounts.length > 0 &&
      coefficientOfVariation(priorAmounts) > MAX_AMOUNT_COEFFICIENT_OF_VARIATION
    ) {
      continue;
    }

    const last = dated[dated.length - 1];
    // Project from the median gap too, for the same reason it's used for
    // classification above - a mean would drag the projection toward a
    // missed-month outlier instead of this merchant's actual rhythm.
    const nextExpected = new Date(last.date);
    nextExpected.setDate(nextExpected.getDate() + Math.round(medianGap));

    let priceCreep: PriceCreepFlag | null = null;
    if (priorAmounts.length > 0) {
      const baseline = priorAmounts.reduce((a, b) => a + b, 0) / priorAmounts.length;
      const increaseAbsolute = lastAmount - baseline;
      const increasePercent = baseline > 0 ? increaseAbsolute / baseline : 0;
      if (increaseAbsolute > PRICE_CREEP_ABSOLUTE_FLOOR && increasePercent > PRICE_CREEP_RELATIVE_FLOOR) {
        priceCreep = { baseline, lastAmount, increaseAbsolute, increasePercent };
      }
    }

    series.push({
      merchant: last.row.item.trim(),
      category: last.row.category,
      billedVia: last.row.vendor,
      cadence: rule.cadence,
      occurrenceCount: dated.length,
      averageAmount: amounts.reduce((a, b) => a + b, 0) / amounts.length,
      lastAmount,
      lastDate: toLocalIsoDate(last.date),
      nextExpectedDate: toLocalIsoDate(nextExpected),
      priceCreep,
    });
  }

  return series.sort((a, b) => {
    if (a.category === "subscriptions" && b.category !== "subscriptions") return -1;
    if (b.category === "subscriptions" && a.category !== "subscriptions") return 1;
    return b.averageAmount - a.averageAmount;
  });
}
