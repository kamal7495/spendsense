import { GroceryReminder } from "@/lib/analytics";
import { CATEGORY_LABEL } from "@/lib/labels";

const STATUS_STYLE: Record<GroceryReminder["status"], { label: string; icon: string; className: string }> = {
  overdue: { label: "Overdue", icon: "⚠", className: "bg-red-50 text-[#d03b3b]" },
  due_soon: { label: "Due soon", icon: "⏰", className: "bg-amber-50 text-amber-700" },
  on_track: { label: "On track", icon: "✓", className: "bg-gray-100 text-gray-600" },
};

interface Props {
  reminders: GroceryReminder[];
}

export default function GroceryRemindersCard({ reminders }: Props) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold">Time to reorder</h2>
      <p className="text-sm text-gray-500">
        Based on how often you&apos;ve reordered each item in the past — produce, dairy &amp; eggs, and
        staples
      </p>
      <div className="mt-4">
        {reminders.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            Nothing due right now — you&apos;re stocked up.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reminders.map((r) => {
              const style = STATUS_STYLE[r.status];
              return (
                <li
                  key={r.item}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium capitalize text-gray-900">{r.item}</p>
                    <p className="text-xs text-gray-500">
                      {CATEGORY_LABEL[r.category]} · Last ordered {r.lastOrdered} · usually every ~
                      {r.avgIntervalDays}d
                    </p>
                  </div>
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
                  >
                    <span aria-hidden="true">{style.icon}</span>
                    {style.label} ({r.daysSinceLastOrder}d since last order)
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
