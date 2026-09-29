import { RecurringSeries } from "@/lib/recurring";
import { CATEGORY_LABEL } from "@/lib/labels";
import { currency } from "@/lib/format";

interface Props {
  series: RecurringSeries[];
}

const CADENCE_LABEL: Record<RecurringSeries["cadence"], string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Yearly",
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function RecurringChargesCard({ series }: Props) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Recurring charges</h2>
      <p className="text-sm text-gray-500">
        Subscriptions, bills, and other charges that repeat on a steady schedule
      </p>

      {series.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          Nothing detected yet &mdash; a charge needs 3+ occurrences on a steady weekly or monthly
          rhythm (or 2+ a year apart) to show up here.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {series.map((s) => (
            <div
              key={s.merchant}
              className="flex flex-col gap-1 rounded-md border border-gray-100 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{s.merchant}</span>
                  <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                    {CATEGORY_LABEL[s.category]}
                  </span>
                </div>
                <span className="whitespace-nowrap text-sm font-medium tabular-nums text-gray-900">
                  {currency.format(s.lastAmount)}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {CADENCE_LABEL[s.cadence]} via {s.billedVia} &middot; next expected{" "}
                {formatDay(s.nextExpectedDate)}
              </p>
              {s.priceCreep && (
                <p className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                  ⚠ +{(s.priceCreep.increasePercent * 100).toFixed(0)}% since last charge (was{" "}
                  {currency.format(s.priceCreep.baseline)})
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
