import React, { useState } from "react";
import { useFabConfigStore, type FabConfigOverride } from "@/store/simulation/fabConfigStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useFabStore } from "@/store/map/fabStore";
import ParamInput from "./ParamInput";
import {
  panelCardVariants,
  panelTextVariants,
} from "../../shared/panelStyles";

type MovementParams = {
  linearMaxSpeed: number;
  linearAcceleration: number;
  linearDeceleration: number;
  preBrakeDeceleration: number;
  curveMaxSpeed: number;
  curveAcceleration: number;
};

const GLOBAL = "global";

const MovementParamsPanel: React.FC = () => {
  const { baseConfig, fabOverrides, setFabOverride, updateBaseMovement } = useFabConfigStore();
  const controller = useShmSimulatorStore((s) => s.controller);
  const { fabs } = useFabStore();
  const [selected, setSelected] = useState<string>(GLOBAL);

  const pushToWorker = (fabId: string | undefined, params: Partial<MovementParams>) => {
    if (!controller) return;
    controller.setMovementConfig({
      linearMaxSpeed: params.linearMaxSpeed,
      linearAcceleration: params.linearAcceleration,
      linearDeceleration: params.linearDeceleration,
      preBrakeDeceleration: params.preBrakeDeceleration,
      curveMaxSpeed: params.curveMaxSpeed,
      curveAcceleration: params.curveAcceleration,
    }, fabId);
  };

  const getEffective = (fabIndex: number): MovementParams => {
    const m = fabOverrides[fabIndex]?.movement;
    return {
      linearMaxSpeed: m?.linear?.maxSpeed ?? baseConfig.movement.linear.maxSpeed,
      linearAcceleration: m?.linear?.acceleration ?? baseConfig.movement.linear.acceleration,
      linearDeceleration: m?.linear?.deceleration ?? baseConfig.movement.linear.deceleration,
      preBrakeDeceleration: m?.linear?.preBrakeDeceleration ?? baseConfig.movement.linear.preBrakeDeceleration,
      curveMaxSpeed: m?.curve?.maxSpeed ?? baseConfig.movement.curve.maxSpeed,
      curveAcceleration: m?.curve?.acceleration ?? baseConfig.movement.curve.acceleration,
    };
  };

  const updateOverride = (fabIndex: number, path: [string, string], value: number | undefined) => {
    const override: FabConfigOverride = JSON.parse(JSON.stringify(fabOverrides[fabIndex] || {}));
    const [subsection, key] = path;

    if (!override.movement) override.movement = {};

    if (subsection === "linear") {
      if (!override.movement.linear) override.movement.linear = {};
      if (value === undefined) {
        delete (override.movement.linear as Record<string, unknown>)[key];
        if (Object.keys(override.movement.linear).length === 0) delete override.movement.linear;
      } else {
        (override.movement.linear as Record<string, number>)[key] = value;
      }
    } else if (subsection === "curve") {
      if (!override.movement.curve) override.movement.curve = {};
      if (value === undefined) {
        delete (override.movement.curve as Record<string, unknown>)[key];
        if (Object.keys(override.movement.curve).length === 0) delete override.movement.curve;
      } else {
        (override.movement.curve as Record<string, number>)[key] = value;
      }
    }

    if (override.movement && !override.movement.linear && !override.movement.curve) {
      delete override.movement;
    }

    setFabOverride(fabIndex, override);

    // Worker에 전체 effective 값 전달
    const eff = getEffective(fabIndex);
    // 오버라이드 적용 후 새 값 반영
    if (subsection === "linear") {
      if (key === "maxSpeed" && value !== undefined) eff.linearMaxSpeed = value;
      if (key === "acceleration" && value !== undefined) eff.linearAcceleration = value;
      if (key === "deceleration" && value !== undefined) eff.linearDeceleration = value;
      if (key === "preBrakeDeceleration" && value !== undefined) eff.preBrakeDeceleration = value;
    } else if (subsection === "curve") {
      if (key === "maxSpeed" && value !== undefined) eff.curveMaxSpeed = value;
      if (key === "acceleration" && value !== undefined) eff.curveAcceleration = value;
    }

    if (controller) {
      const fabId = controller.getFabIds()[fabIndex];
      pushToWorker(fabId, eff);
    }
  };

  // Global 업데이트: Zustand store + Worker broadcast
  const updateGlobal = (subsection: string, key: string, value: number) => {
    // 1. Zustand store 업데이트
    if (subsection === "linear") {
      updateBaseMovement({ linear: { [key]: value } });
    } else if (subsection === "curve") {
      updateBaseMovement({ curve: { [key]: value } });
    }
    // 2. Worker에 전달
    const params: Partial<MovementParams> = {};
    if (subsection === "linear") {
      if (key === "maxSpeed") params.linearMaxSpeed = value;
      if (key === "acceleration") params.linearAcceleration = value;
      if (key === "deceleration") params.linearDeceleration = value;
      if (key === "preBrakeDeceleration") params.preBrakeDeceleration = value;
    } else if (subsection === "curve") {
      if (key === "maxSpeed") params.curveMaxSpeed = value;
      if (key === "acceleration") params.curveAcceleration = value;
    }
    pushToWorker(undefined, params);
  };

  const clearFab = (fabIndex: number) => {
    const override: FabConfigOverride = JSON.parse(JSON.stringify(fabOverrides[fabIndex] || {}));
    delete override.movement;
    setFabOverride(fabIndex, override);
    // base 값으로 리셋
    pushToWorker(
      controller?.getFabIds()[fabIndex],
      {
        linearMaxSpeed: baseConfig.movement.linear.maxSpeed,
        linearAcceleration: baseConfig.movement.linear.acceleration,
        linearDeceleration: baseConfig.movement.linear.deceleration,
        preBrakeDeceleration: baseConfig.movement.linear.preBrakeDeceleration,
        curveMaxSpeed: baseConfig.movement.curve.maxSpeed,
        curveAcceleration: baseConfig.movement.curve.acceleration,
      }
    );
  };

  const isGlobal = selected === GLOBAL;
  const selectedFabIndex = isGlobal ? null : Number(selected);

  return (
    <div className="space-y-3">
      {/* Selector */}
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full px-3 py-2 rounded text-sm font-bold bg-panel-bg-solid text-white border border-accent-cyan/50 focus:border-accent-cyan focus:outline-none"
      >
        <option value={GLOBAL}>Global (Base Config)</option>
        {fabs.map((fab) => {
          const hasOvr = !!fabOverrides[fab.fabIndex]?.movement;
          return (
            <option key={fab.fabIndex} value={String(fab.fabIndex)}>
              Fab {fab.fabIndex}{hasOvr ? " ★" : ""}
            </option>
          );
        })}
      </select>

      {/* Global - Base Config (read-only display + worker push) */}
      {isGlobal && (
        <>
          <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
            <div className={panelTextVariants({ variant: "muted", size: "xs" })}>STRAIGHT</div>
            <div className="space-y-1 mt-1">
              <GlobalParamRow label="Max Speed" value={baseConfig.movement.linear.maxSpeed} unit="m/s"
                onChange={(v) => updateGlobal("linear", "maxSpeed", v)} />
              <GlobalParamRow label="Acceleration" value={baseConfig.movement.linear.acceleration} unit="m/s²"
                onChange={(v) => updateGlobal("linear", "acceleration", v)} />
              <GlobalParamRow label="Deceleration" value={baseConfig.movement.linear.deceleration} unit="m/s²"
                onChange={(v) => updateGlobal("linear", "deceleration", v)} />
              <GlobalParamRow label="Pre-Brake Decel" value={baseConfig.movement.linear.preBrakeDeceleration} unit="m/s²"
                onChange={(v) => updateGlobal("linear", "preBrakeDeceleration", v)} />
            </div>
          </div>
          <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
            <div className={panelTextVariants({ variant: "muted", size: "xs" })}>CURVE</div>
            <div className="space-y-1 mt-1">
              <GlobalParamRow label="Max Speed" value={baseConfig.movement.curve.maxSpeed} unit="m/s"
                onChange={(v) => updateGlobal("curve", "maxSpeed", v)} />
              <GlobalParamRow label="Acceleration" value={baseConfig.movement.curve.acceleration} unit="m/s²"
                onChange={(v) => updateGlobal("curve", "acceleration", v)} />
            </div>
          </div>
          <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
            <div className={panelTextVariants({ variant: "muted", size: "xs" })}>INFO</div>
            <div className="mt-1 text-[10px] text-gray-500 space-y-1">
              <div>Global 변경 = 오버라이드 없는 모든 Fab에 즉시 적용</div>
              <div>가속도/감속도 변경 시 기존 차량도 즉시 갱신</div>
            </div>
          </div>
        </>
      )}

      {/* Per-Fab Override */}
      {!isGlobal && selectedFabIndex !== null && (
        <>
          <div className={`${panelCardVariants({ variant: fabOverrides[selectedFabIndex]?.movement ? "highlight" : "default", padding: "sm" })}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-accent-orange">Fab {selectedFabIndex}</span>
              {fabOverrides[selectedFabIndex]?.movement ? (
                <button onClick={() => clearFab(selectedFabIndex)}
                  className="text-[10px] text-gray-500 hover:text-gray-300 border border-gray-600 px-1.5 py-0.5 rounded">
                  reset to global
                </button>
              ) : (
                <span className="text-[10px] text-gray-600">Global 설정 사용 중</span>
              )}
            </div>
            <div className={panelTextVariants({ variant: "muted", size: "xs" })}>STRAIGHT</div>
            <div className="space-y-1 mt-1">
              <ParamInput
                label="Max Speed"
                value={fabOverrides[selectedFabIndex]?.movement?.linear?.maxSpeed}
                baseValue={baseConfig.movement.linear.maxSpeed}
                onChange={(v) => updateOverride(selectedFabIndex, ["linear", "maxSpeed"], v)}
                unit="m/s"
              />
              <ParamInput
                label="Acceleration"
                value={fabOverrides[selectedFabIndex]?.movement?.linear?.acceleration}
                baseValue={baseConfig.movement.linear.acceleration}
                onChange={(v) => updateOverride(selectedFabIndex, ["linear", "acceleration"], v)}
                unit="m/s²"
              />
              <ParamInput
                label="Deceleration"
                value={fabOverrides[selectedFabIndex]?.movement?.linear?.deceleration}
                baseValue={baseConfig.movement.linear.deceleration}
                onChange={(v) => updateOverride(selectedFabIndex, ["linear", "deceleration"], v)}
                unit="m/s²"
              />
              <ParamInput
                label="Pre-Brake Decel"
                value={fabOverrides[selectedFabIndex]?.movement?.linear?.preBrakeDeceleration}
                baseValue={baseConfig.movement.linear.preBrakeDeceleration}
                onChange={(v) => updateOverride(selectedFabIndex, ["linear", "preBrakeDeceleration"], v)}
                unit="m/s²"
              />
            </div>
          </div>

          <div className={`${panelCardVariants({ variant: fabOverrides[selectedFabIndex]?.movement ? "highlight" : "default", padding: "sm" })}`}>
            <div className={panelTextVariants({ variant: "muted", size: "xs" })}>CURVE</div>
            <div className="space-y-1 mt-1">
              <ParamInput
                label="Max Speed"
                value={fabOverrides[selectedFabIndex]?.movement?.curve?.maxSpeed}
                baseValue={baseConfig.movement.curve.maxSpeed}
                onChange={(v) => updateOverride(selectedFabIndex, ["curve", "maxSpeed"], v)}
                unit="m/s"
              />
              <ParamInput
                label="Acceleration"
                value={fabOverrides[selectedFabIndex]?.movement?.curve?.acceleration}
                baseValue={baseConfig.movement.curve.acceleration}
                onChange={(v) => updateOverride(selectedFabIndex, ["curve", "acceleration"], v)}
                unit="m/s²"
              />
            </div>
          </div>
        </>
      )}

      {/* Override Summary */}
      {fabs.some(f => fabOverrides[f.fabIndex]?.movement) && (
        <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>OVERRIDE SUMMARY</div>
          <div className="mt-1 space-y-0.5">
            {fabs.map((fab) => {
              const m = fabOverrides[fab.fabIndex]?.movement;
              if (!m) return null;
              const eff = getEffective(fab.fabIndex);
              return (
                <div key={fab.fabIndex} className="flex justify-between text-[10px]">
                  <span className="text-accent-orange">Fab {fab.fabIndex}</span>
                  <span className="text-gray-400 font-mono">
                    v={eff.linearMaxSpeed} a={eff.linearAcceleration} d={eff.linearDeceleration}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/** Global base config 값을 편집할 수 있는 인라인 입력 */
const GlobalParamRow: React.FC<{
  label: string; value: number; unit: string; onChange: (v: number) => void;
}> = ({ label, value, unit, onChange }) => {
  const [inputValue, setInputValue] = React.useState(String(value));
  React.useEffect(() => { setInputValue(String(value)); }, [value]);

  return (
    <div className="flex items-center gap-2">
      <label className="w-[120px] text-xs text-gray-400 shrink-0">{label}</label>
      <input
        type="text" inputMode="decimal" value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          const val = Number.parseFloat(e.target.value);
          if (!Number.isNaN(val)) onChange(val);
        }}
        onBlur={() => {
          const val = Number.parseFloat(inputValue);
          if (Number.isNaN(val)) setInputValue(String(value));
        }}
        className="w-[70px] px-2 py-1 rounded text-xs font-mono bg-panel-bg-solid text-white border border-accent-cyan/50"
      />
      <span className="text-[11px] text-gray-600">{unit}</span>
    </div>
  );
};

export default MovementParamsPanel;
