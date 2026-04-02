import React from "react";
import { useFabConfigStore, type FabConfigOverride, type GrantStrategy } from "@/store/simulation/fabConfigStore";
import { useFabStore } from "@/store/map/fabStore";
import ParamInput from "./ParamInput";
import {
  panelTitleVariants,
  panelCardVariants,
  panelTextVariants,
} from "../../shared/panelStyles";

const StrategyToggle: React.FC<{
  value: GrantStrategy | undefined;
  baseValue: GrantStrategy;
  onChange: (v: GrantStrategy | undefined) => void;
}> = ({ value, baseValue, onChange }) => {
  const current = value ?? baseValue;

  return (
    <div className="flex items-center gap-2 mb-2">
      <label className="w-[160px] text-xs text-gray-400 shrink-0">
        Grant Strategy
        <span className="text-[10px] text-gray-600 block">락 승인 전략</span>
      </label>
      <div className="flex">
        <button
          onClick={() => onChange("FIFO")}
          className={`px-3 py-1 text-[11px] rounded-l border ${
            current === "FIFO"
              ? "bg-blue-500 text-white border-blue-500 font-bold"
              : "bg-panel-bg-solid text-gray-500 border-panel-border"
          }`}
        >
          FIFO
        </button>
        <button
          onClick={() => onChange("BATCH")}
          className={`px-3 py-1 text-[11px] rounded-r border-t border-b border-r ${
            current === "BATCH"
              ? "bg-amber-500 text-white border-amber-500 font-bold"
              : "bg-panel-bg-solid text-gray-500 border-panel-border"
          }`}
        >
          BATCH
        </button>
      </div>
      {value !== undefined && (
        <button
          onClick={() => onChange(undefined)}
          className="text-gray-500 hover:text-gray-300 text-[10px]"
        >
          reset
        </button>
      )}
      <span className="text-[10px] text-gray-600">(base: {baseValue})</span>
    </div>
  );
};

const LockParamsPanel: React.FC = () => {
  const { baseConfig, fabOverrides, setFabOverride } = useFabConfigStore();
  const { fabs } = useFabStore();

  const updateOverride = (fabIndex: number, key: string, value: number | string | undefined) => {
    const override: FabConfigOverride = JSON.parse(JSON.stringify(fabOverrides[fabIndex] || {}));
    if (!override.lock) override.lock = {};

    if (value === undefined) {
      delete (override.lock as Record<string, unknown>)[key];
      if (Object.keys(override.lock).length === 0) delete override.lock;
    } else {
      (override.lock as Record<string, number | string>)[key] = value;
    }

    setFabOverride(fabIndex, override);
  };

  return (
    <div className="space-y-4">
      {/* Base Config */}
      <div>
        <h3 className={panelTitleVariants({ size: "sm", color: "cyan" })}>Base Config</h3>

        <div className={`${panelCardVariants({ variant: "default", padding: "sm" })} mt-2`}>
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>STRAIGHT MERGE</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Request Dist</span>
              <span className="text-white font-mono">{baseConfig.lock.requestDistanceFromMergingStr} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Wait Dist</span>
              <span className="text-white font-mono">{baseConfig.lock.waitDistanceFromMergingStr} m</span>
            </div>
          </div>
        </div>

        <div className={`${panelCardVariants({ variant: "default", padding: "sm" })} mt-2`}>
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>CURVE MERGE</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Request Dist</span>
              <span className="text-white font-mono">{baseConfig.lock.requestDistanceFromMergingCurve} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Wait Dist</span>
              <span className="text-white font-mono">{baseConfig.lock.waitDistanceFromMergingCurve} m</span>
            </div>
          </div>
        </div>

        <div className={`${panelCardVariants({ variant: "default", padding: "sm" })} mt-2`}>
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>STRATEGY</div>
          <div className="mt-1 text-xs flex items-center gap-2">
            <span className="text-gray-500">Grant Strategy</span>
            <span className={`font-bold font-mono ${baseConfig.lock.grantStrategy === "FIFO" ? "text-blue-400" : "text-amber-400"}`}>
              {baseConfig.lock.grantStrategy}
            </span>
          </div>
        </div>
      </div>

      {/* Per-Fab Overrides */}
      {fabs.map((fab) => {
        const override = fabOverrides[fab.fabIndex];
        if (!override) return null;

        return (
          <div key={fab.fabIndex}>
            <h3 className={panelTitleVariants({ size: "sm", color: "orange" })}>
              Fab {fab.fabIndex} Override
            </h3>

            <div className={`${panelCardVariants({ variant: "default", padding: "sm" })} mt-2 space-y-1`}>
              <div className={panelTextVariants({ variant: "muted", size: "xs" })}>STRAIGHT MERGE</div>
              <ParamInput
                label="Request Distance"
                value={override.lock?.requestDistanceFromMergingStr}
                baseValue={baseConfig.lock.requestDistanceFromMergingStr}
                onChange={(v) => updateOverride(fab.fabIndex, "requestDistanceFromMergingStr", v)}
                unit="m"
                description="toNode 앞 요청 지점"
              />
              <ParamInput
                label="Wait Distance"
                value={override.lock?.waitDistanceFromMergingStr}
                baseValue={baseConfig.lock.waitDistanceFromMergingStr}
                onChange={(v) => updateOverride(fab.fabIndex, "waitDistanceFromMergingStr", v)}
                unit="m"
                description="toNode 앞 대기 지점"
              />
            </div>

            <div className={`${panelCardVariants({ variant: "default", padding: "sm" })} mt-2 space-y-1`}>
              <div className={panelTextVariants({ variant: "muted", size: "xs" })}>CURVE MERGE</div>
              <ParamInput
                label="Request Distance"
                value={override.lock?.requestDistanceFromMergingCurve}
                baseValue={baseConfig.lock.requestDistanceFromMergingCurve}
                onChange={(v) => updateOverride(fab.fabIndex, "requestDistanceFromMergingCurve", v)}
                unit="m"
                description="fromNode 앞 요청 지점"
              />
              <ParamInput
                label="Wait Distance"
                value={override.lock?.waitDistanceFromMergingCurve}
                baseValue={baseConfig.lock.waitDistanceFromMergingCurve}
                onChange={(v) => updateOverride(fab.fabIndex, "waitDistanceFromMergingCurve", v)}
                unit="m"
                description="fromNode 앞 대기 지점"
              />
            </div>

            <div className={`${panelCardVariants({ variant: "default", padding: "sm" })} mt-2`}>
              <div className={panelTextVariants({ variant: "muted", size: "xs" })}>STRATEGY</div>
              <div className="mt-1">
                <StrategyToggle
                  value={override.lock?.grantStrategy}
                  baseValue={baseConfig.lock.grantStrategy}
                  onChange={(v) => updateOverride(fab.fabIndex, "grantStrategy", v)}
                />
              </div>
            </div>
          </div>
        );
      })}

      {Object.keys(fabOverrides).length === 0 && (
        <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
          Fab override 없음. Params 모달에서 추가하세요.
        </div>
      )}
    </div>
  );
};

export default LockParamsPanel;
