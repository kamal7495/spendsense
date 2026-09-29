import { getBudgets, getInvoices } from "@/lib/sheets";
import { spendByCategoryForPeriod } from "@/lib/analytics";
import { categoryPacing } from "@/lib/pacing";
import { getCurrentPayPeriod } from "@/lib/payPeriod";
import { CATEGORIES } from "@/lib/types";
import BudgetTable, { BudgetRowView } from "@/components/BudgetTable";
import { CATEGORY_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function BudgetPage() {
  let error: string | null = null;
  let rows: BudgetRowView[] = [];

  try {
    const [budgets, invoices] = await Promise.all([getBudgets(), getInvoices()]);
    const now = new Date();
    const period = getCurrentPayPeriod(now);
    const actuals = spendByCategoryForPeriod(invoices, period.startIso, period.endIso);
    const pacing = categoryPacing(invoices, budgets, now);

    rows = CATEGORIES.map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      target: budgets.find((b) => b.category === category)?.monthlyTarget ?? 0,
      actual: actuals.find((a) => a.category === category)?.total ?? 0,
      pace: pacing.find((p) => p.category === category) ?? null,
    }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load budgets";
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">Couldn&apos;t load budget data</p>
        <p className="mt-1 text-red-700">{error}</p>
        <p className="mt-2 text-red-700">
          Make sure a &quot;Budgets&quot; tab exists in the sheet with columns Category |
          MonthlyTarget.
        </p>
      </div>
    );
  }

  const period = getCurrentPayPeriod();
  const { daysElapsed, daysInPeriod } = period;
  const pctElapsed = Math.round((daysElapsed / daysInPeriod) * 100);
  const rangeLabel = period.start.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const rangeEndLabel = period.end.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Budgets</h1>
        <p className="text-sm text-gray-500">
          Pay cycle {rangeLabel} – {rangeEndLabel} · Day {daysElapsed} of {daysInPeriod} —{" "}
          {pctElapsed}% elapsed
        </p>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <BudgetTable rows={rows} />
      </div>
    </div>
  );
}
