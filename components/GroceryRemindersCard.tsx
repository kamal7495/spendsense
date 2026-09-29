import Link from "next/link";
import { GroceryReminder } from "@/lib/analytics";
import { CATEGORY_LABEL } from "@/lib/labels";

const STATUS_STYLE: Record<GroceryReminder["status"], { dot: string; badge: string }> = {
  overdue: { dot: "#d03b3b", badge: "bg-red-50 text-[#d03b3b]" },
  due_soon: { dot: "#d99a1f", badge: "bg-amber-50 text-amber-700" },
  upcoming: { dot: "#1baf7a", badge: "bg-emerald-50 text-[#1baf7a]" },
};

function dueLabel(r: GroceryReminder): string {
  if (r.daysUntilDue <= 0) return "Due today";
  return `Due in ${r.daysUntilDue} day${r.daysUntilDue === 1 ? "" : "s"}`;
}

interface Props {
  reminders: GroceryReminder[];
  /** Dashboard preview: top 3 only, condensed rows, link out to the full list. */
  compact?: boolean;
}

export default function GroceryRemindersCard({ reminders, compact = false }: Props) {
  const visible = compact ? reminders.slice(0, 3) : reminders;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Reorder reminders</h2>
          {!compact && (
            <p className="text-sm text-gray-500">
              Based on how often you&apos;ve reordered each item in the past — produce, dairy &amp;
              eggs, and staples
            </p>
          )}
        </div>
        {compact && (
          <Link href="/groceries" className="whitespace-nowrap text-xs font-medium text-[#2a78d6] hover:underline">
            View all →
          </Link>
        )}
      </div>
      <div className="mt-4">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            Nothing due in the next two weeks — you&apos;re stocked up.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {visible.map((r) => {
              const style = STATUS_STYLE[r.status];
              return (
                <li key={r.item} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: style.dot }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm font-medium capitalize text-gray-900">{r.item}</span>
                    {!compact && (
                      <span className="hidden shrink-0 text-xs text-gray-400 sm:inline">
                        {CATEGORY_LABEL[r.category]}
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}
                  >
                    {dueLabel(r)}
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
