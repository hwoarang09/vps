import React from "react";
import { useHudStyles, SectionLabel } from "./LiveKpiSection";

const ROUTING_LABEL: Record<string, string> = {
  DISTANCE: "Dist",
  BPR: "BPR",
  EWMA: "EWMA",
};

const IDLE_POLICY_LABEL: Record<string, string> = {
  RANDOM_WALK: "Random",
  ARRIVAL_BAY_LOOP: "BayLoop",
  BALANCED_BAY_LOOP: "Balanced",
};

interface Props {
  routing: {
    strategy: string;
    bprAlpha: number;
    bprBeta: number;
    ewmaAlpha: number;
  };
  transferMode: { idlePolicy: string };
  transferRate: {
    mode: "utilization" | "throughput";
    utilizationPercent: number;
    throughputPerHour: number;
  };
}

const ParamRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const hud = useHudStyles();
  return (
    <div className={`${hud.gradientClass} flex items-center gap-2.5 px-3 py-1.5 min-w-[200px]`}>
      <span
        className={`text-[10px] uppercase tracking-wider ${hud.dimText} flex-shrink-0 w-[60px]`}
        style={hud.textOutlineStyle}
      >
        {label}
      </span>
      <span
        className="font-mono text-[12px] font-semibold flex-1 text-right"
        style={hud.textOutlineStyle}
      >
        {children}
      </span>
    </div>
  );
};

const ActiveFabSection: React.FC<Props> = ({ routing, transferMode, transferRate }) => {
  const hud = useHudStyles();
  const routingShort = ROUTING_LABEL[routing.strategy] ?? routing.strategy;
  let routingParam = "";
  if (routing.strategy === "BPR") {
    routingParam = ` α${routing.bprAlpha} β${routing.bprBeta}`;
  } else if (routing.strategy === "EWMA") {
    routingParam = ` α${routing.ewmaAlpha}`;
  }

  const modeShort = IDLE_POLICY_LABEL[transferMode.idlePolicy] ?? transferMode.idlePolicy;
  const rateStr = transferRate.mode === "utilization"
    ? `${transferRate.utilizationPercent}%`
    : `${transferRate.throughputPerHour}/h`;

  // 강조 색은 light mode에서 더 진한 톤으로
  const routingAccent = hud.primaryText === "text-white" ? "text-purple-300" : "text-purple-700";
  const modeAccent = hud.primaryText === "text-white" ? "text-cyan-300" : "text-cyan-700";

  return (
    <div className="flex flex-col gap-1">
      <SectionLabel>Parameters</SectionLabel>
      <div className="flex flex-col gap-1">
        <ParamRow label="Routing">
          <span className={routingAccent}>{routingShort}</span>
          <span className={hud.dimText}>{routingParam}</span>
        </ParamRow>
        <ParamRow label="Transfer">
          <span className={modeAccent}>{modeShort}</span>
          <span className={hud.mutedText}> · </span>
          <span className={hud.primaryText}>{rateStr}</span>
        </ParamRow>
      </div>
    </div>
  );
};

export default ActiveFabSection;
