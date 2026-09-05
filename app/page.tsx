import { getInvoices } from "@/lib/sheets";
import {
  compareThisMonthToLast,
  filterByWindow,
  spendByCategory,
  spendByCategoryAndVendor,
} from "@/lib/analytics";
import CategoryBarChart from "@/components/CategoryBarChart";
import CardUsageByCategoryCard from "@/components/CardUsageByCategoryCard";
import DateRangeControl from "@/components/DateRangeControl";
import { currency } from "@/lib/format";

export const dynamic = "force-dynamic";

function parseDays(raw: string | undefined): number {
  if (raw === "all") return 36500; // ~100 years, effectively "all time"
  const n = raw ? parseInt(raw, 10) : 60;
  return Number.isFinite(n) && n > 0 ? n : 60;
}

function windowLabel(daysParam: string): string {
  return daysParam === "all" ? "All time" : `Last ${daysParam} days`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const days = parseDays(searchParams.days);
  const daysParam = searchParams.days ?? "60";

  let error: string | null = null;
  let thisMonth = 0;
  let lastMonth = 0;
  let categorySpend: ReturnType<typeof spendByCategory> = [];
  let cardUsage: ReturnType<typeof spendByCategoryAndVendor> = [];

  try {
    const invoices = await getInvoices();
    const comparison = compareThisMonthToLast(invoices);
    thisMonth = comparison.thisMonth;
    lastMonth = comparison.lastMonth;
    const inWindow = filterByWindow(invoices, days);
    categorySpend = spendByCategory(inWindow);
    cardUsage = spendByCategoryAndVendor(inWindow);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load invoices";
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">Couldn&apos;t load data from Google Sheets</p>
        <p className="mt-1 text-red-700">{error}</p>
        <p className="mt-2 text-red-700">
          Check that GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID are set,
          and that the sheet is shared with the service account.
        </p>
      </div>
    );
  }

  const delta = lastMonth === 0 ? null : ((thisMonth - lastMonth) / lastMonth) * 100;
  const spentMore = delta !== null && delta > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <DateRangeControl current={daysParam} />
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">This month</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{currency.format(thisMonth)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Last month</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-2xl font-semibold tabular-nums">{currency.format(lastMonth)}</p>
            {delta !== null && (
              <span
                className={`text-sm font-medium ${
                  spentMore ? "text-[#d03b3b]" : "text-[#006300]"
                }`}
              >
                {spentMore ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}% vs this month
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold">Spend by category</h2>
        <p className="text-sm text-gray-500">{windowLabel(daysParam)}, total per category</p>
        <div className="mt-4">
          <CategoryBarChart data={categorySpend} />
        </div>
      </section>

      <CardUsageByCategoryCard breakdown={cardUsage} windowLabel={windowLabel(daysParam)} />
    </div>
  );
}
