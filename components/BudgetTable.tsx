"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Category } from "@/lib/types";
import { CategoryPace } from "@/lib/pacing";
import { currency } from "@/lib/format";

export interface BudgetRowView {
  category: Category;
  label: string;
  target: number;
  actual: number;
  pace: CategoryPace | null;
}

const PACE_COLOR: Record<CategoryPace["status"], string> = {
  no_budget: "#c3c2b7",
  on_pace: "#1baf7a",
  watch: "#d99a1f",
  over_pace: "#d03b3b",
};

const PACE_LABEL: Record<CategoryPace["status"], string> = {
  no_budget: "No budget set",
  on_pace: "On pace",
  watch: "Pacing slightly over",
  over_pace: "Pacing over budget",
};

export default function BudgetTable({ rows }: { rows: BudgetRowView[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.category, r.target ? String(r.target) : ""]))
  );
  const [savingCategory, setSavingCategory] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveBudget(category: Category) {
    const raw = drafts[category];
    const monthlyTarget = parseFloat(raw);
    if (!raw || Number.isNaN(monthlyTarget) || monthlyTarget < 0) {
      setError(`Enter a valid non-negative number for ${category}`);
      return;
    }

    setError(null);
    setSavingCategory(category);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, monthlyTarget }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save budget");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save budget");
    } finally {
      setSavingCategory(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PACE_COLOR.on_pace }} />
          On pace
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PACE_COLOR.watch }} />
          Pacing 0-15% over
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PACE_COLOR.over_pace }} />
          Pacing 15%+ over
        </span>
        <span className="text-gray-400">
          Pace compares spend-so-far to the expected spend-so-far for today&apos;s day of the
          month — not just % of the flat monthly target.
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium">Target</th>
              <th className="py-2 pr-4 font-medium">Spent so far</th>
              <th className="py-2 pr-4 font-medium">% of target</th>
              <th className="py-2 pr-4 font-medium">Pace</th>
              <th className="py-2 pr-4 font-medium">Projected month-end</th>
              <th className="py-2 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const target = parseFloat(drafts[row.category]) || 0;
              const pctOfTarget = target > 0 ? Math.round((row.actual / target) * 100) : 0;
              const pace = row.pace && row.pace.status !== "no_budget" ? row.pace : null;
              return (
                <tr key={row.category} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4 font-medium text-gray-900">{row.label}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">₹</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="decimal"
                        value={drafts[row.category]}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [row.category]: e.target.value }))
                        }
                        className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-gray-500 focus:outline-none"
                        placeholder="0"
                      />
                    </div>
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700">
                    {currency.format(row.actual)}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700">
                    {target > 0 ? `${pctOfTarget}%` : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {pace ? (
                      <span className="flex items-center gap-1.5" title={PACE_LABEL[pace.status]}>
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: PACE_COLOR[pace.status] }}
                        />
                        <span
                          className="tabular-nums text-sm font-medium"
                          style={{ color: pace.status === "on_pace" ? "#1baf7a" : PACE_COLOR[pace.status] }}
                        >
                          {pace.paceRatio !== null ? `${pace.paceRatio.toFixed(2)}x` : "—"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">&mdash;</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {pace ? (
                      <div>
                        <span
                          className="tabular-nums text-sm font-medium"
                          style={{ color: pace.status === "on_pace" ? "#1baf7a" : PACE_COLOR[pace.status] }}
                        >
                          {currency.format(pace.projectedMonthEnd)}
                        </span>
                        <p className="text-xs text-gray-400">
                          {pace.status === "on_pace"
                            ? "on track"
                            : `vs target ${currency.format(pace.monthlyTarget)}`}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">&mdash;</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => saveBudget(row.category)}
                      disabled={savingCategory === row.category}
                      className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                      {savingCategory === row.category ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
