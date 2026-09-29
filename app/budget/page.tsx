import { getBudgets, getInvoices } from "@/lib/sheets";
import { spendByCategoryForMonth } from "@/lib/analytics";
import { categoryPacing } from "@/lib/pacing";
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
    const actuals = spendByCategoryForMonth(invoices, now.getFullYear(), now.getMonth());
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

  const now = new Date();
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pctElapsed = Math.round((daysElapsed / daysInMonth) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Budgets</h1>
        <p className="text-sm text-gray-500">
          Day {daysElapsed} of {daysInMonth} — {pctElapsed}% of month elapsed
        </p>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <BudgetTable rows={rows} />
      </div>
    </div>
  );
}
