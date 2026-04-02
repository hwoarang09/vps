import React from "react";
import { useFabConfigStore, type FabConfigOverride } from "@/store/simulation/fabConfigStore";
import { useFabStore } from "@/store/map/fabStore";
import ParamInput from "./ParamInput";
import {
  panelTitleVariants,
  panelCardVariants,
  panelTextVariants,
} from "../../shared/panelStyles";

const MovementParamsPanel: React.FC = () => {
  const { baseConfig, fabOverrides, setFabOverride } = useFabConfigStore();
  const { fabs } = useFabStore();

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
  };

  return (
    <div className="space-y-4">
      {/* Base Config */}
      <div>
        <h3 className={panelTitleVariants({ size: "sm", color: "cyan" })}>Base Config</h3>
        <div className={`${panelCardVariants({ variant: "default", padding: "sm" })} mt-2`}>
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>STRAIGHT</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Max Speed</span>
              <span className="text-white font-mono">{baseConfig.movement.linear.maxSpeed} m/s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Accel</span>
              <span className="text-white font-mono">{baseConfig.movement.linear.acceleration} m/s²</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Decel</span>
              <span className="text-white font-mono">{baseConfig.movement.linear.deceleration} m/s²</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Pre-Brake</span>
              <span className="text-white font-mono">{baseConfig.movement.linear.preBrakeDeceleration} m/s²</span>
            </div>
          </div>
        </div>

        <div className={`${panelCardVariants({ variant: "default", padding: "sm" })} mt-2`}>
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>CURVE</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Max Speed</span>
              <span className="text-white font-mono">{baseConfig.movement.curve.maxSpeed} m/s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Accel</span>
              <span className="text-white font-mono">{baseConfig.movement.curve.acceleration} m/s²</span>
            </div>
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
              <div className={panelTextVariants({ variant: "muted", size: "xs" })}>STRAIGHT</div>
              <ParamInput
                label="Max Speed"
                value={override.movement?.linear?.maxSpeed}
                baseValue={baseConfig.movement.linear.maxSpeed}
                onChange={(v) => updateOverride(fab.fabIndex, ["linear", "maxSpeed"], v)}
                unit="m/s"
              />
              <ParamInput
                label="Acceleration"
                value={override.movement?.linear?.acceleration}
                baseValue={baseConfig.movement.linear.acceleration}
                onChange={(v) => updateOverride(fab.fabIndex, ["linear", "acceleration"], v)}
                unit="m/s²"
              />
              <ParamInput
                label="Deceleration"
                value={override.movement?.linear?.deceleration}
                baseValue={baseConfig.movement.linear.deceleration}
                onChange={(v) => updateOverride(fab.fabIndex, ["linear", "deceleration"], v)}
                unit="m/s²"
              />
              <ParamInput
                label="Pre-Brake Decel"
                value={override.movement?.linear?.preBrakeDeceleration}
                baseValue={baseConfig.movement.linear.preBrakeDeceleration}
                onChange={(v) => updateOverride(fab.fabIndex, ["linear", "preBrakeDeceleration"], v)}
                unit="m/s²"
              />
            </div>

            <div className={`${panelCardVariants({ variant: "default", padding: "sm" })} mt-2 space-y-1`}>
              <div className={panelTextVariants({ variant: "muted", size: "xs" })}>CURVE</div>
              <ParamInput
                label="Max Speed"
                value={override.movement?.curve?.maxSpeed}
                baseValue={baseConfig.movement.curve.maxSpeed}
                onChange={(v) => updateOverride(fab.fabIndex, ["curve", "maxSpeed"], v)}
                unit="m/s"
              />
              <ParamInput
                label="Acceleration"
                value={override.movement?.curve?.acceleration}
                baseValue={baseConfig.movement.curve.acceleration}
                onChange={(v) => updateOverride(fab.fabIndex, ["curve", "acceleration"], v)}
                unit="m/s²"
              />
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

export default MovementParamsPanel;
