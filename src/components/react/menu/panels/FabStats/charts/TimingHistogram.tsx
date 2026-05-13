import React, { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";
import { useFabStatsUIStore, type TimingKey } from "../store";

interface Props {
  fabId: string;
}

const TIMING_META: Record<TimingKey, {
  label: string;
  histogramKey: "leadTimeHistogram" | "waitingTimeHistogram" | "deliveryTimeHistogram";
  p50Key: "leadTimeP50" | "waitingTimeP50" | "deliveryTimeP50";
  p95Key: "leadTimeP95" | "waitingTimeP95" | "deliveryTimeP95";
  barColor: string;
  p50Color: string;
  p95Color: string;
}> = {
  lead:     { label: "Lead",     histogramKey: "leadTimeHistogram",     p50Key: "leadTimeP50",     p95Key: "leadTimeP95",     barColor: "#22c55e", p50Color: "#06b6d4", p95Color: "#f59e0b" },
  waiting:  { label: "Waiting",  histogramKey: "waitingTimeHistogram",  p50Key: "waitingTimeP50",  p95Key: "waitingTimeP95",  barColor: "#06b6d4", p50Color: "#22c55e", p95Color: "#f59e0b" },
  delivery: { label: "Delivery", histogramKey: "deliveryTimeHistogram", p50Key: "deliveryTimeP50", p95Key: "deliveryTimeP95", barColor: "#a78bfa", p50Color: "#22c55e", p95Color: "#f59e0b" },
};

export const TimingHistogram: React.FC<Props> = ({ fabId }) => {
  const stats = useOrderStatsStore((s) => s.fabStats[fabId]);
  const timing = useFabStatsUIStore((s) => s.selectedTiming);
  const meta = TIMING_META[timing];

  const { data, total, hasData, p50, p95, bucketSec } = useMemo(() => {
    const hist = stats?.[meta.histogramKey];
    const bucket = stats?.leadTimeBucketSec ?? 10;
    if (!hist || hist.length === 0) {
      return { data: [], total: 0, hasData: false, p50: 0, p95: 0, bucketSec: bucket };
    }
    const total = hist.reduce((s, c) => s + c, 0);
    const rows = hist.map((count, i) => {
      const isOverflow = i === hist.length - 1;
      const label = isOverflow
        ? `${i * bucket}+`
        : `${i * bucket}-${(i + 1) * bucket}`;
      return { bucket: label, count, idx: i, isOverflow };
    });
    return {
      data: rows,
      total,
      hasData: total > 0,
      p50: stats?.[meta.p50Key] ?? 0,
      p95: stats?.[meta.p95Key] ?? 0,
      bucketSec: bucket,
    };
  }, [stats, meta.histogramKey, meta.p50Key, meta.p95Key]);

  if (!hasData) {
    return (
      <div className="h-full flex items-center justify-center text-[10px] text-gray-600 italic">
        Waiting for completed orders…
      </div>
    );
  }

  const refToLabel = (sec: number): string | undefined => {
    const idx = Math.min(data.length - 1, Math.floor(sec / bucketSec));
    return data[idx]?.bucket;
  };
  const p50Label = refToLabel(p50);
  const p95Label = refToLabel(p95);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-baseline justify-between mb-1 shrink-0">
        <span className="text-[11px] font-semibold" style={{ color: meta.barColor }}>
          {meta.label} Time Distribution
        </span>
        <span className="text-[10px] text-gray-500">
          n = <span className="text-gray-300 tabular-nums">{total}</span>
          <span className="ml-2">p50 <span className="tabular-nums" style={{ color: meta.p50Color }}>{p50.toFixed(1)}s</span></span>
          <span className="ml-2">p95 <span className="tabular-nums" style={{ color: meta.p95Color }}>{p95.toFixed(1)}s</span></span>
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
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
                stroke={meta.p50Color}
                strokeDasharray="3 3"
                label={{ value: "p50", fill: meta.p50Color, fontSize: 9, position: "top" }}
              />
            )}
            {p95Label && (
              <ReferenceLine
                x={p95Label}
                stroke={meta.p95Color}
                strokeDasharray="3 3"
                label={{ value: "p95", fill: meta.p95Color, fontSize: 9, position: "top" }}
              />
            )}
            <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.idx}
                  fill={d.isOverflow ? "#ef4444" : meta.barColor}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
