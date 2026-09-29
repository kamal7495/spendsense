import { BudgetRow, Category, InvoiceRow } from "./types";
import { spendByCategoryForPeriod } from "./analytics";
import { getCurrentPayPeriod } from "./payPeriod";

export type PaceStatus = "no_budget" | "on_pace" | "watch" | "over_pace";

const WATCH_THRESHOLD = 1.0; // pacing ratio above this = spending faster than a straight-line pace
const OVER_THRESHOLD = 1.15; // Rocket Money-style: 15%+ over projected pace is the flag point

export interface CategoryPace {
  category: Category;
  monthlyTarget: number;
  spendSoFar: number;
  daysElapsed: number;
  daysInPeriod: number;
  /** What spend "should" be by today if the budget were spent in a straight line across the pay cycle. */
  expectedByToday: number;
  /** spendSoFar / expectedByToday. Null when there's no budget target to pace against. */
  paceRatio: number | null;
  /** Straight-line projection of spendSoFar to a full pay cycle, regardless of budget. */
  projectedMonthEnd: number;
  status: PaceStatus;
}

/**
 * Per-category spend pace for the current pay cycle (SALARY_DAY through
 * SALARY_DAY-1 of the next month — see lib/payPeriod.ts; confirmed by the
 * user to be the 25th, matching when their paycheck actually has to
 * stretch): not just "have you crossed 90% of budget" (a flat threshold
 * that only fires once most of the damage is already done), but whether
 * you're on track to exceed it given how many days are actually left -
 * borrowed from ad-tech budget pacing. A category that's spent 40% of its
 * budget by day 10 of a 30-day cycle is pacing at 3x, even though it's
 * nowhere near the 90% mark yet.
 */
export function categoryPacing(
  rows: InvoiceRow[],
  budgets: BudgetRow[],
  now: Date = new Date()
): CategoryPace[] {
  const period = getCurrentPayPeriod(now);
  const { daysElapsed, daysInPeriod } = period;
  const actuals = spendByCategoryForPeriod(rows, period.startIso, period.endIso);

  return budgets.map((b) => {
    const spendSoFar = actuals.find((a) => a.category === b.category)?.total ?? 0;
    const projectedMonthEnd = spendSoFar / (daysElapsed / daysInPeriod);

    if (b.monthlyTarget <= 0) {
      return {
        category: b.category,
        monthlyTarget: b.monthlyTarget,
        spendSoFar,
        daysElapsed,
        daysInPeriod,
        expectedByToday: 0,
        paceRatio: null,
        projectedMonthEnd,
        status: "no_budget",
      };
    }

    const expectedByToday = b.monthlyTarget * (daysElapsed / daysInPeriod);
    const paceRatio = expectedByToday > 0 ? spendSoFar / expectedByToday : 0;
    const status: PaceStatus =
      paceRatio > OVER_THRESHOLD ? "over_pace" : paceRatio > WATCH_THRESHOLD ? "watch" : "on_pace";

    return {
      category: b.category,
      monthlyTarget: b.monthlyTarget,
      spendSoFar,
      daysElapsed,
      daysInPeriod,
      expectedByToday,
      paceRatio,
      projectedMonthEnd,
      status,
    };
  });
}
