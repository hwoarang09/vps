import React from "react";
import { Truck, BarChart3, Timer, Lock } from "lucide-react";

export type Trend = "up" | "down" | "flat";

export interface KpiSnapshot {
  activeFabId: string;
  vehicleCount: number;
  throughput: number;
  leadP95: number;
  locks: number;
  throughputTrend: Trend;
  leadP95Trend: Trend;
  locksTrend: Trend;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="text-[10px] uppercase tracking-[0.18em] text-zinc-300 font-semibold pl-2"
    style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
  >
    {children}
  </div>
);

const TrendArrow: React.FC<{ trend: Trend; positiveIsGood?: boolean }> = ({
  trend,
  positiveIsGood = true,
}) => {
  if (trend === "flat") return null;
  const isGood = (trend === "up" && positiveIsGood) || (trend === "down" && !positiveIsGood);
  const cls = isGood ? "text-emerald-400" : "text-red-400";
  return (
    <span className={`text-[10px] font-bold ${cls}`} style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}>
      {trend === "up" ? "▲" : "▼"}
    </span>
  );
};

const KpiCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  trend?: Trend;
  trendPositiveIsGood?: boolean;
}> = ({ icon, label, value, unit, trend, trendPositiveIsGood }) => (
  <div className="flex items-center gap-2.5 px-3 py-1.5 min-w-[200px]">
    <span className="text-zinc-300 flex-shrink-0">{icon}</span>
    <span
      className="text-[10px] uppercase tracking-wider text-zinc-400 flex-shrink-0 w-[60px]"
    >
      {label}
    </span>
    <div className="flex items-baseline gap-1 flex-1 justify-end">
      <span
        className="font-mono text-base font-bold text-white tabular-nums"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
      >
        {value}
      </span>
      {unit && (
        <span className="text-[10px] text-zinc-400 font-mono" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}>
          {unit}
        </span>
      )}
      {trend && <TrendArrow trend={trend} positiveIsGood={trendPositiveIsGood} />}
    </div>
  </div>
);

const GRADIENT_CLASS =
  "bg-gradient-to-r from-black/95 from-0% via-black/55 via-25% to-transparent to-60% backdrop-blur-sm rounded-md";

interface Props {
  snapshot: KpiSnapshot;
}

const LiveKpiSection: React.FC<Props> = ({ snapshot }) => {
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel>Live KPI</SectionLabel>
      <div className={`${GRADIENT_CLASS} min-w-[260px] py-1`}>
        <KpiCard
          icon={<Truck size={14} />}
          label="Vehicles"
          value={snapshot.vehicleCount.toLocaleString()}
        />
        <KpiCard
          icon={<BarChart3 size={14} />}
          label="Throughput"
          value={snapshot.throughput.toFixed(0)}
          unit="/hr"
          trend={snapshot.throughputTrend}
          trendPositiveIsGood={true}
        />
        <KpiCard
          icon={<Timer size={14} />}
          label="Lead p95"
          value={snapshot.leadP95.toFixed(1)}
          unit="s"
          trend={snapshot.leadP95Trend}
          trendPositiveIsGood={false}
        />
        <KpiCard
          icon={<Lock size={14} />}
          label="Locks"
          value={snapshot.locks.toString()}
          trend={snapshot.locksTrend}
          trendPositiveIsGood={false}
        />
      </div>
    </div>
  );
};

export { GRADIENT_CLASS };

export default LiveKpiSection;
