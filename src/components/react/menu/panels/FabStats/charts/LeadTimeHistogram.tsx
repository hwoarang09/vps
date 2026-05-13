import React, { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";

interface Props {
  fabId: string;
}

export const LeadTimeHistogram: React.FC<Props> = ({ fabId }) => {
  const stats = useOrderStatsStore((s) => s.fabStats[fabId]);

  const { data, total, hasData } = useMemo(() => {
    const hist = stats?.leadTimeHistogram;
    const bucket = stats?.leadTimeBucketSec ?? 10;
    if (!hist || hist.length === 0) {
      return { data: [], total: 0, hasData: false };
    }
    const total = hist.reduce((s, c) => s + c, 0);
    const rows = hist.map((count, i) => {
      const isOverflow = i === hist.length - 1;
      const label = isOverflow
        ? `${i * bucket}+`
        : `${i * bucket}-${(i + 1) * bucket}`;
      return { bucket: label, count, idx: i, isOverflow };
    });
    return { data: rows, total, hasData: total > 0 };
  }, [stats]);

  if (!hasData) {
    return (
      <div className="h-full flex items-center justify-center text-[10px] text-gray-600 italic">
        Waiting for completed orders…
      </div>
    );
  }

  const p50 = stats?.leadTimeP50;
  const p95 = stats?.leadTimeP95;
  const bucketSec = stats?.leadTimeBucketSec ?? 10;

  // p50/p95 (sec) → bucket label로 매핑 (해당 bucket 중심에 reference line)
  const refToLabel = (sec: number | undefined): string | undefined => {
    if (sec == null) return undefined;
    const idx = Math.min(data.length - 1, Math.floor(sec / bucketSec));
    return data[idx]?.bucket;
  };
  const p50Label = refToLabel(p50);
  const p95Label = refToLabel(p95);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-baseline justify-between mb-1 shrink-0">
        <span className="text-[10px] text-gray-500">
          n = <span className="text-gray-300 tabular-nums">{total}</span>
          {p50 != null && (
            <>
              <span className="ml-2">p50 <span className="text-accent-cyan tabular-nums">{p50.toFixed(1)}s</span></span>
              <span className="ml-2">p95 <span className="text-amber-400 tabular-nums">{p95?.toFixed(1)}s</span></span>
            </>
          )}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
            <XAxis
              dataKey="bucket"
              tick={{ fill: "#9ca3af", fontSize: 9 }}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={36}
            />
            <YAxis
              tick={{ fill: "#9ca3af", fontSize: 9 }}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "#1f2937", border: "1px solid #374151",
                borderRadius: 6, fontSize: 11,
              }}
              labelStyle={{ color: "#fff" }}
              formatter={(value) => [`${value} orders`, "count"]}
              labelFormatter={(l) => `${l} s`}
            />
            {p50Label && (
              <ReferenceLine
                x={p50Label}
                stroke="#06b6d4"
                strokeDasharray="3 3"
                label={{ value: "p50", fill: "#06b6d4", fontSize: 9, position: "top" }}
              />
            )}
            {p95Label && (
              <ReferenceLine
                x={p95Label}
                stroke="#f59e0b"
                strokeDasharray="3 3"
                label={{ value: "p95", fill: "#f59e0b", fontSize: 9, position: "top" }}
              />
            )}
            <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.idx}
                  fill={d.isOverflow ? "#ef4444" : "#8b5cf6"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
