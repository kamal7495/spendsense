"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Category } from "@/lib/types";
import { CategorySpend } from "@/lib/analytics";
import { CATEGORY_LABEL } from "@/lib/labels";
import { currency } from "@/lib/format";

const BAR_COLOR = "#2a78d6";

interface Props {
  data: CategorySpend[];
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { category, total } = payload[0].payload as CategorySpend;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-md">
      <p className="font-medium text-gray-900">{CATEGORY_LABEL[category as Category]}</p>
      <p className="text-gray-600">{currency.format(total)}</p>
    </div>
  );
}

export default function CategoryBarChart({ data }: Props) {
  const chartData = data.filter((d) => d.total > 0).sort((a, b) => b.total - a.total);

  if (chartData.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">No spend recorded yet.</p>
    );
  }

  const longestLabel = Math.max(...chartData.map((d) => CATEGORY_LABEL[d.category].length));

  return (
    <div style={{ height: Math.max(240, chartData.length * 34) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 0, bottom: 4 }}
        >
          <CartesianGrid horizontal={false} stroke="#e1e0d9" />
          <XAxis
            type="number"
            tick={{ fill: "#898781", fontSize: 12 }}
            axisLine={{ stroke: "#c3c2b7" }}
            tickLine={false}
            tickFormatter={(value: number) => currency.format(value)}
          />
          <YAxis
            dataKey="category"
            type="category"
            tickFormatter={(value: Category) => CATEGORY_LABEL[value]}
            tick={{ fill: "#0b0b0b", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={Math.min(140, longestLabel * 7 + 16)}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f0efec" }} />
          <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {chartData.map((entry) => (
              <Cell key={entry.category} fill={BAR_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
