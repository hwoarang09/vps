import React, { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { FabStats } from "../../FabStatsPanel";

interface Props {
  fab: FabStats;
}

export const SpeedHistogram: React.FC<Props> = ({ fab }) => {
  const { data, hasData } = useMemo(() => {
    const hist = fab.speedHistogram;
    const ceil = fab.speedBucketCeil;
    if (!hist || hist.length === 0 || ceil <= 0) {
      return { data: [], hasData: false };
    }
    const total = hist.reduce((s, c) => s + c, 0);
    const width = ceil / hist.length;
    const rows = hist.map((count, i) => {
      const low = i * width;
      const high = (i + 1) * width;
      const label = `${low.toFixed(1)}-${high.toFixed(1)}`;
      // 색: 0 근처 amber, 중간 cyan, max 근처 purple
      const ratio = (i + 0.5) / hist.length;
      const color = ratio > 0.75 ? "#a78bfa" : ratio > 0.3 ? "#06b6d4" : "#f59e0b";
      return { label, count, idx: i, color };
    });
    return { data: rows, hasData: total > 0 };
  }, [fab.speedHistogram, fab.speedBucketCeil]);

  if (!hasData) {
    return (
      <div className="h-full flex items-center justify-center text-[10px] text-gray-600 italic">
        No speed data
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-baseline justify-between mb-0.5 shrink-0">
        <span className="text-[10px] text-gray-500">Speed dist.</span>
        <span className="text-[9px] text-gray-600 tabular-nums">
          0 ─ {fab.speedBucketCeil.toFixed(1)} m/s
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: -22 }}>
            <XAxis dataKey="label" hide />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 8 }} width={24} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                background: "#1f2937", border: "1px solid #374151",
                borderRadius: 6, fontSize: 10, padding: "2px 6px",
              }}
              labelStyle={{ color: "#fff", fontSize: 10 }}
              formatter={(value) => [`${value} veh`, "count"]}
              labelFormatter={(l) => `${l} m/s`}
            />
            <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.idx} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
