import React from "react";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { panelCardVariants } from "../../shared/panelStyles";

import { ROUTING_LABEL } from "./routingLabel";
const IDLE_POLICY_LABEL: Record<string, string> = {
  RANDOM_WALK: "Random Walk",
  ARRIVAL_BAY_LOOP: "Bay Loop",
  BALANCED_BAY_LOOP: "Balanced Loop",
};

// ============================================================================
// Param row — label + value + (optional) override badge
// ============================================================================

const ParamRow: React.FC<{
  label: string;
  value: React.ReactNode;
  overridden?: boolean;
  base?: React.ReactNode;
}> = ({ label, value, overridden, base }) => (
  <div className="flex items-baseline gap-2 py-0.5">
    <span className="text-[10.5px] text-gray-500 w-32 shrink-0">{label}</span>
    <span className="text-[11px] font-mono tabular-nums text-gray-200 flex-1 truncate">{value}</span>
    {overridden && (
      <span
        className="text-[8.5px] px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0"
        title={base != null ? `base: ${base}` : "Fab override"}
      >
        OVR
      </span>
    )}
  </div>
);

// ============================================================================
// Section
// ============================================================================

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
    <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1.5 pb-1 border-b border-gray-700/50">
      {title}
    </div>
    <div className="flex flex-col">{children}</div>
  </div>
);

// ============================================================================
// Main
// ============================================================================

export const ParametersTab: React.FC<{ fabIndex: number }> = ({ fabIndex }) => {
  const baseConfig = useFabConfigStore((s) => s.baseConfig);
  const globalRouting = useFabConfigStore((s) => s.routingConfig);
  const globalMode = useFabConfigStore((s) => s.transferModeConfig);
  const globalRate = useFabConfigStore((s) => s.transferRateConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);
  const ovr = fabOverrides[fabIndex];

  // Routing
  const routingStrategy = ovr?.routing?.strategy ?? globalRouting.strategy;
  const bprAlpha = ovr?.routing?.bprAlpha ?? globalRouting.bprAlpha;
  const bprBeta = ovr?.routing?.bprBeta ?? globalRouting.bprBeta;
  const bprGamma = ovr?.routing?.bprGamma ?? globalRouting.bprGamma;
  const ewmaAlpha = ovr?.routing?.ewmaAlpha ?? globalRouting.ewmaAlpha;
  const rerouteInterval = ovr?.routing?.rerouteInterval ?? globalRouting.rerouteInterval;

  // Transfer
  const transferMode = ovr?.transferMode ?? globalMode;
  const rateMode = ovr?.transferRateConfig?.mode ?? globalRate.mode;
  const utilPct = ovr?.transferRateConfig?.utilizationPercent ?? globalRate.utilizationPercent;
  const throughputPerHour = ovr?.transferRateConfig?.throughputPerHour ?? globalRate.throughputPerHour;

  // Movement (linear)
  const linMax = ovr?.movement?.linear?.maxSpeed ?? baseConfig.movement.linear.maxSpeed;
  const linAcc = ovr?.movement?.linear?.acceleration ?? baseConfig.movement.linear.acceleration;
  const linDec = ovr?.movement?.linear?.deceleration ?? baseConfig.movement.linear.deceleration;
  const linPreBrake = ovr?.movement?.linear?.preBrakeDeceleration ?? baseConfig.movement.linear.preBrakeDeceleration;

  // Movement (curve)
  const curMax = ovr?.movement?.curve?.maxSpeed ?? baseConfig.movement.curve.maxSpeed;
  const curAcc = ovr?.movement?.curve?.acceleration ?? baseConfig.movement.curve.acceleration;

  // Lock
  const lockWaitStr = ovr?.lock?.waitDistanceFromMergingStr ?? baseConfig.lock.waitDistanceFromMergingStr;
  const lockReqStr = ovr?.lock?.requestDistanceFromMergingStr ?? baseConfig.lock.requestDistanceFromMergingStr;
  const lockWaitCurve = ovr?.lock?.waitDistanceFromMergingCurve ?? baseConfig.lock.waitDistanceFromMergingCurve;
  const lockReqCurve = ovr?.lock?.requestDistanceFromMergingCurve ?? baseConfig.lock.requestDistanceFromMergingCurve;
  const lockGrant = ovr?.lock?.grantStrategy ?? baseConfig.lock.grantStrategy;

  // Sensors
  const sensorOverridden = !!ovr?.sensor;
  const sensorPresetCount = useFabConfigStore.getState().getFabSensorPresets(fabIndex)?.length ?? 0;

  return (
    <div className="h-full overflow-auto vps-scrollbar pr-1">
      <div className="grid grid-cols-2 gap-2">
        <Section title="Routing">
          <ParamRow label="Strategy" value={ROUTING_LABEL[routingStrategy] ?? routingStrategy}
            overridden={!!ovr?.routing?.strategy} base={ROUTING_LABEL[globalRouting.strategy]} />
          {routingStrategy === "BPR" && (
            <>
              <ParamRow label="BPR α" value={bprAlpha} overridden={ovr?.routing?.bprAlpha !== undefined} base={globalRouting.bprAlpha} />
              <ParamRow label="BPR β" value={bprBeta} overridden={ovr?.routing?.bprBeta !== undefined} base={globalRouting.bprBeta} />
              <ParamRow label="BPR γ" value={bprGamma} overridden={ovr?.routing?.bprGamma !== undefined} base={globalRouting.bprGamma} />
            </>
          )}
          {routingStrategy === "EWMA" && (
            <ParamRow label="EWMA α" value={ewmaAlpha} overridden={ovr?.routing?.ewmaAlpha !== undefined} base={globalRouting.ewmaAlpha} />
          )}
          <ParamRow
            label="Reroute interval"
            value={rerouteInterval > 0 ? `${rerouteInterval} edges` : "off"}
            overridden={ovr?.routing?.rerouteInterval !== undefined}
            base={globalRouting.rerouteInterval > 0 ? `${globalRouting.rerouteInterval} edges` : "off"}
          />
        </Section>

        <Section title="Transfer">
          <ParamRow label="Idle policy"
            value={IDLE_POLICY_LABEL[transferMode.idlePolicy] ?? transferMode.idlePolicy}
            overridden={!!ovr?.transferMode}
            base={IDLE_POLICY_LABEL[globalMode.idlePolicy] ?? globalMode.idlePolicy}
          />
          <ParamRow label="Rate mode" value={rateMode} overridden={ovr?.transferRateConfig?.mode !== undefined} base={globalRate.mode} />
          {rateMode === "utilization" ? (
            <ParamRow label="Utilization" value={`${utilPct}%`}
              overridden={ovr?.transferRateConfig?.utilizationPercent !== undefined}
              base={`${globalRate.utilizationPercent}%`} />
          ) : (
            <ParamRow label="Throughput target" value={`${throughputPerHour}/hr`}
              overridden={ovr?.transferRateConfig?.throughputPerHour !== undefined}
              base={`${globalRate.throughputPerHour}/hr`} />
          )}
        </Section>

        <Section title="Movement — Linear">
          <ParamRow label="Max speed" value={`${linMax} m/s`} overridden={ovr?.movement?.linear?.maxSpeed !== undefined} base={`${baseConfig.movement.linear.maxSpeed} m/s`} />
          <ParamRow label="Acceleration" value={`${linAcc} m/s²`} overridden={ovr?.movement?.linear?.acceleration !== undefined} base={`${baseConfig.movement.linear.acceleration}`} />
          <ParamRow label="Deceleration" value={`${linDec} m/s²`} overridden={ovr?.movement?.linear?.deceleration !== undefined} base={`${baseConfig.movement.linear.deceleration}`} />
          <ParamRow label="Pre-brake decel" value={`${linPreBrake} m/s²`} overridden={ovr?.movement?.linear?.preBrakeDeceleration !== undefined} base={`${baseConfig.movement.linear.preBrakeDeceleration}`} />
        </Section>

        <Section title="Movement — Curve">
          <ParamRow label="Max speed" value={`${curMax} m/s`} overridden={ovr?.movement?.curve?.maxSpeed !== undefined} base={`${baseConfig.movement.curve.maxSpeed} m/s`} />
          <ParamRow label="Acceleration" value={`${curAcc} m/s²`} overridden={ovr?.movement?.curve?.acceleration !== undefined} base={`${baseConfig.movement.curve.acceleration}`} />
        </Section>

        <Section title="Lock">
          <ParamRow label="Grant strategy" value={String(lockGrant)} overridden={ovr?.lock?.grantStrategy !== undefined} base={String(baseConfig.lock.grantStrategy)} />
          <ParamRow label="Wait (linear)" value={`${lockWaitStr} m`} overridden={ovr?.lock?.waitDistanceFromMergingStr !== undefined} base={`${baseConfig.lock.waitDistanceFromMergingStr} m`} />
          <ParamRow label="Request (linear)" value={`${lockReqStr} m`} overridden={ovr?.lock?.requestDistanceFromMergingStr !== undefined} base={`${baseConfig.lock.requestDistanceFromMergingStr} m`} />
          <ParamRow label="Wait (curve)" value={`${lockWaitCurve} m`} overridden={ovr?.lock?.waitDistanceFromMergingCurve !== undefined} base={`${baseConfig.lock.waitDistanceFromMergingCurve} m`} />
          <ParamRow label="Request (curve)" value={`${lockReqCurve} m`} overridden={ovr?.lock?.requestDistanceFromMergingCurve !== undefined} base={`${baseConfig.lock.requestDistanceFromMergingCurve} m`} />
        </Section>

        <Section title="Sensors">
          <ParamRow
            label="Presets"
            value={`${sensorPresetCount} presets`}
            overridden={sensorOverridden}
            base="base presets"
          />
          <div className="text-[9.5px] text-gray-600 mt-1 leading-snug">
            Front / Rear / Left / Right zone 별 angle·length·decel — Parameters 모달에서 상세 편집
          </div>
        </Section>
      </div>
    </div>
  );
};
