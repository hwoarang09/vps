import React from "react";
import { Truck, BarChart3, Timer, Lock } from "lucide-react";
import { useThemeStore } from "@store/ui/themeStore";

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

// 혜성 꼬리 그라데이션 — dark mode (검정 → 투명)
const DARK_GRADIENT_CLASS = [
  "relative isolate rounded-l-[14px] backdrop-blur-[2px]",
  "before:content-[''] before:absolute before:inset-0 before:rounded-l-[14px] before:-z-10 before:pointer-events-none",
  "before:bg-[linear-gradient(to_right,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.45)_12%,rgba(0,0,0,0.18)_35%,rgba(0,0,0,0.06)_65%,transparent_100%)]",
  "before:blur-[3px]",
].join(" ");

// 혜성 꼬리 그라데이션 — light mode (흰색 → 투명)
const LIGHT_GRADIENT_CLASS = [
  "relative isolate rounded-l-[14px] backdrop-blur-[2px]",
  "before:content-[''] before:absolute before:inset-0 before:rounded-l-[14px] before:-z-10 before:pointer-events-none",
  "before:bg-[linear-gradient(to_right,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0.5)_12%,rgba(255,255,255,0.22)_35%,rgba(255,255,255,0.08)_65%,transparent_100%)]",
  "before:blur-[3px]",
].join(" ");

// Active leader — cyan (dark용)
const DARK_ACTIVE_GRADIENT_CLASS = [
  "relative isolate rounded-l-[14px] backdrop-blur-[2px]",
  "before:content-[''] before:absolute before:inset-0 before:rounded-l-[14px] before:-z-10 before:pointer-events-none",
  "before:bg-[linear-gradient(to_right,rgba(6,182,212,0.55)_0%,rgba(6,182,212,0.25)_15%,rgba(6,182,212,0.1)_40%,transparent_75%)]",
  "before:blur-[3px]",
].join(" ");

// Active leader — sky blue (light용)
const LIGHT_ACTIVE_GRADIENT_CLASS = [
  "relative isolate rounded-l-[14px] backdrop-blur-[2px]",
  "before:content-[''] before:absolute before:inset-0 before:rounded-l-[14px] before:-z-10 before:pointer-events-none",
  "before:bg-[linear-gradient(to_right,rgba(14,165,233,0.55)_0%,rgba(14,165,233,0.28)_15%,rgba(14,165,233,0.12)_40%,transparent_75%)]",
  "before:blur-[3px]",
].join(" ");

const DARK_TEXT_OUTLINE: React.CSSProperties = {
  WebkitTextStroke: "0.5px rgba(0,0,0,0.9)",
  paintOrder: "stroke fill",
  textShadow: "0 1px 2px rgba(0,0,0,0.7)",
};

const LIGHT_TEXT_OUTLINE: React.CSSProperties = {
  WebkitTextStroke: "0.5px rgba(255,255,255,0.95)",
  paintOrder: "stroke fill",
  textShadow: "0 1px 2px rgba(255,255,255,0.7)",
};

export interface HudStyles {
  gradientClass: string;
  activeGradientClass: string;
  textOutlineStyle: React.CSSProperties;
  primaryText: string;   // 큰 숫자 / fab 이름
  dimText: string;       // 라벨 / 보조 텍스트
  mutedText: string;     // 더 옅은 텍스트
}

export function useHudStyles(): HudStyles {
  const hudMode = useThemeStore((s) => s.theme.hudMode);
  if (hudMode === "light") {
    return {
      gradientClass: LIGHT_GRADIENT_CLASS,
      activeGradientClass: LIGHT_ACTIVE_GRADIENT_CLASS,
      textOutlineStyle: LIGHT_TEXT_OUTLINE,
      primaryText: "text-zinc-900",
      dimText: "text-zinc-700",
      mutedText: "text-zinc-600",
    };
  }
  return {
    gradientClass: DARK_GRADIENT_CLASS,
    activeGradientClass: DARK_ACTIVE_GRADIENT_CLASS,
    textOutlineStyle: DARK_TEXT_OUTLINE,
    primaryText: "text-white",
    dimText: "text-zinc-300",
    mutedText: "text-zinc-400",
  };
}

// Backward-compat exports (다른 섹션이 직접 import 하는 경우 — useHudStyles로 교체 예정)
const GRADIENT_CLASS = DARK_GRADIENT_CLASS;
const ACTIVE_GRADIENT_CLASS = DARK_ACTIVE_GRADIENT_CLASS;
const TEXT_OUTLINE_STYLE = DARK_TEXT_OUTLINE;

export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hud = useHudStyles();
  return (
    <div
      className={`text-[10px] uppercase tracking-[0.18em] ${hud.dimText} font-semibold pl-2`}
      style={hud.textOutlineStyle}
    >
      {children}
    </div>
  );
};

const TrendArrow: React.FC<{ trend: Trend; positiveIsGood?: boolean }> = ({
  trend,
  positiveIsGood = true,
}) => {
  const hud = useHudStyles();
  if (trend === "flat") return null;
  const isGood = (trend === "up" && positiveIsGood) || (trend === "down" && !positiveIsGood);
  const cls = isGood ? "text-emerald-500" : "text-red-500";
  return (
    <span className={`text-[10px] font-bold ${cls}`} style={hud.textOutlineStyle}>
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
}> = ({ icon, label, value, unit, trend, trendPositiveIsGood }) => {
  const hud = useHudStyles();
  return (
    <div className={`${hud.gradientClass} flex items-center gap-2.5 px-3 py-1.5 min-w-[200px]`}>
      <span className={`${hud.dimText} flex-shrink-0`}>{icon}</span>
      <span
        className={`text-[10px] uppercase tracking-wider ${hud.dimText} flex-shrink-0 w-[60px]`}
        style={hud.textOutlineStyle}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-1 flex-1 justify-end">
        <span
          className={`font-mono text-base font-bold ${hud.primaryText} tabular-nums`}
          style={hud.textOutlineStyle}
        >
          {value}
        </span>
        {unit && (
          <span className={`text-[10px] ${hud.dimText} font-mono`} style={hud.textOutlineStyle}>
            {unit}
          </span>
        )}
        {trend && <TrendArrow trend={trend} positiveIsGood={trendPositiveIsGood} />}
      </div>
    </div>
  );
};

interface Props {
  snapshot: KpiSnapshot;
}

const LiveKpiSection: React.FC<Props> = ({ snapshot }) => {
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel>Live KPI</SectionLabel>
      <div className="flex flex-col gap-1">
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

export { GRADIENT_CLASS, ACTIVE_GRADIENT_CLASS, TEXT_OUTLINE_STYLE };

export default LiveKpiSection;
