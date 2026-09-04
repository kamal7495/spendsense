"use client";

import { useMemo, useState } from "react";
import { FrequentItem } from "@/lib/analytics";
import { CATEGORY_LABEL } from "@/lib/labels";
import { Category } from "@/lib/types";

const CADENCE_LABEL = {
  "monthly bulk": "Monthly bulk",
  weekly: "Weekly",
  perishable: "Perishable",
  occasional: "Occasional",
};

type SortKey = "item" | "category" | "count";

interface Props {
  items: FrequentItem[];
  windowDays: number;
}

export default function FrequentItemsTable({ items, windowDays }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortAsc, setSortAsc] = useState(false);

  const categoriesPresent = useMemo(() => {
    const set = new Set<Category>(items.map((i) => i.category));
    return Array.from(set).sort((a, b) => CATEGORY_LABEL[a].localeCompare(CATEGORY_LABEL[b]));
  }, [items]);

  const visibleItems = useMemo(() => {
    const filtered =
      categoryFilter === "all" ? items : items.filter((i) => i.category === categoryFilter);
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "item") cmp = a.item.localeCompare(b.item);
      else if (sortKey === "category") cmp = CATEGORY_LABEL[a.category].localeCompare(CATEGORY_LABEL[b.category]);
      else cmp = a.count - b.count;
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [items, categoryFilter, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "item" || key === "category");
    }
  }

  function SortHeader({ label, sortableKey }: { label: string; sortableKey: SortKey }) {
    const active = sortKey === sortableKey;
    return (
      <th className="py-2 pr-4 font-medium">
        <button
          onClick={() => toggleSort(sortableKey)}
          className={`flex items-center gap-1 hover:text-gray-900 ${active ? "text-gray-900" : ""}`}
        >
          {label}
          <span className="text-gray-400">{active ? (sortAsc ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Frequently ordered items</h2>
          <p className="text-sm text-gray-500">Ordered 2+ times in the last {windowDays} days</p>
        </div>
        {categoriesPresent.length > 1 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as Category | "all")}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-gray-500 focus:outline-none"
          >
            <option value="all">All categories</option>
            {categoriesPresent.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="mt-4 overflow-x-auto">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No repeat items in the last {windowDays} days yet.
          </p>
        ) : visibleItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No items match that filter.</p>
        ) : (
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <SortHeader label="Item" sortableKey="item" />
                <SortHeader label="Category" sortableKey="category" />
                <SortHeader label="Times ordered" sortableKey="count" />
                <th className="py-2 pr-4 font-medium">Suggested cadence</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((row) => (
                <tr key={row.item} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4 capitalize">{row.item}</td>
                  <td className="py-2 pr-4 text-gray-600">{CATEGORY_LABEL[row.category]}</td>
                  <td className="py-2 pr-4 tabular-nums">{row.count}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {CADENCE_LABEL[row.cadence]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
