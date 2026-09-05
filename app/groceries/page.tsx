import { getInvoices } from "@/lib/sheets";
import {
  frequentItems,
  groceryReorderReminders,
  healthSnapshot,
  monthlyStaplesList,
} from "@/lib/analytics";
import HealthSnapshotCard from "@/components/HealthSnapshotCard";
import MonthlyStaplesCard from "@/components/MonthlyStaplesCard";
import GroceryRemindersCard from "@/components/GroceryRemindersCard";
import FrequentItemsTable from "@/components/FrequentItemsTable";
import DateRangeControl from "@/components/DateRangeControl";

export const dynamic = "force-dynamic";

function parseDays(raw: string | undefined): number {
  if (raw === "all") return 36500; // ~100 years, effectively "all time"
  const n = raw ? parseInt(raw, 10) : 60;
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export default async function GroceriesPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const days = parseDays(searchParams.days);
  const daysParam = searchParams.days ?? "60";

  let error: string | null = null;
  let items: ReturnType<typeof frequentItems> = [];
  let health: ReturnType<typeof healthSnapshot> | null = null;
  let staples: ReturnType<typeof monthlyStaplesList> = [];
  let reminders: ReturnType<typeof groceryReorderReminders> = [];

  try {
    const invoices = await getInvoices();
    items = frequentItems(invoices, days);
    health = healthSnapshot(invoices, days);
    staples = monthlyStaplesList(invoices, days);
    reminders = groceryReorderReminders(invoices); // always uses full history for interval accuracy
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load invoices";
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">Couldn&apos;t load data from Google Sheets</p>
        <p className="mt-1 text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Groceries</h1>
        <DateRangeControl current={daysParam} />
      </div>

      <GroceryRemindersCard reminders={reminders} />

      {health && <HealthSnapshotCard snapshot={health} />}

      <MonthlyStaplesCard staples={staples} windowDays={days} />

      <FrequentItemsTable items={items} windowDays={days} />
    </div>
  );
}
