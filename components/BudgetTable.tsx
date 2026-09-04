"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Category } from "@/lib/types";
import { currency } from "@/lib/format";

export interface BudgetRowView {
  category: Category;
  label: string;
  target: number;
  actual: number;
}

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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium">Actual this month</th>
              <th className="py-2 pr-4 font-medium">Monthly target</th>
              <th className="py-2 pr-4 font-medium">Progress</th>
              <th className="py-2 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const target = parseFloat(drafts[row.category]) || 0;
              const pct = target > 0 ? Math.min(100, (row.actual / target) * 100) : 0;
              const over = target > 0 && row.actual > target;
              return (
                <tr key={row.category} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4 font-medium text-gray-900">{row.label}</td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700">
                    {currency.format(row.actual)}
                  </td>
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
                  <td className="py-2 pr-4">
                    <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: over ? "#d03b3b" : "#1baf7a",
                        }}
                      />
                    </div>
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
