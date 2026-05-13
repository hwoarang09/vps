import React from "react";
import { GRADIENT_CLASS } from "./LiveKpiSection";

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

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="text-[10px] uppercase tracking-[0.18em] text-zinc-300 font-semibold pl-2"
    style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
  >
    {children}
  </div>
);

const ActiveFabSection: React.FC<Props> = ({ routing, transferMode, transferRate }) => {
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

  return (
    <div className="flex flex-col gap-1">
      <SectionLabel>Active Fab</SectionLabel>
      <div className={`${GRADIENT_CLASS} min-w-[260px] px-3 py-1.5 flex flex-col gap-0.5`}>
        <div
          className="flex items-center gap-2 text-[11px] font-mono"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
        >
          <span className="text-purple-300">
            {routingShort}
            <span className="text-zinc-400">{routingParam}</span>
          </span>
        </div>
        <div
          className="flex items-center gap-2 text-[11px] font-mono"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
        >
          <span className="text-cyan-300">{modeShort}</span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-300">{rateStr}</span>
        </div>
      </div>
    </div>
  );
};

export default ActiveFabSection;
