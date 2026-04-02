import React, { useState, useEffect } from "react";
import { useFabConfigStore, type RoutingStrategy, type FabConfigOverride } from "@/store/simulation/fabConfigStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useFabStore } from "@/store/map/fabStore";
import {
  panelCardVariants,
  panelTextVariants,
} from "../../shared/panelStyles";

// ─── Sub-components ───

const BprParamInput: React.FC<{
  label: string; value: number; onChange: (v: number) => void; description: string;
}> = ({ label, value, onChange, description }) => {
  const [inputValue, setInputValue] = useState(String(value));
  useEffect(() => { setInputValue(String(value)); }, [value]);

  return (
    <div className="flex items-center gap-2 mb-2">
      <label className="w-[80px] text-xs text-gray-400 shrink-0">
        {label}
        <span className="text-[10px] text-gray-600 block">{description}</span>
      </label>
      <input
        type="text" inputMode="decimal" value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          const val = Number.parseFloat(e.target.value);
          if (!Number.isNaN(val) && val >= 0) onChange(val);
        }}
        onBlur={() => {
          const val = Number.parseFloat(inputValue);
          if (Number.isNaN(val) || val < 0) setInputValue(String(value));
        }}
        className="w-[70px] px-2 py-1 rounded text-xs font-mono bg-panel-bg-solid text-accent-cyan border border-accent-cyan/50"
      />
    </div>
  );
};

const StrategyToggle: React.FC<{
  strategy: RoutingStrategy; onChange: (s: RoutingStrategy) => void;
}> = ({ strategy, onChange }) => (
  <div className="flex gap-1 mt-2">
    <button onClick={() => onChange("DISTANCE")}
      className={`flex-1 px-3 py-2 rounded-l text-xs font-bold border transition-all ${
        strategy === "DISTANCE"
          ? "bg-blue-500 text-white border-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
          : "bg-panel-bg-solid text-gray-500 border-panel-border hover:text-gray-300"
      }`}>
      DISTANCE
      <span className="block text-[10px] font-normal mt-0.5 opacity-70">edge.distance</span>
    </button>
    <button onClick={() => onChange("BPR")}
      className={`flex-1 px-3 py-2 rounded-r text-xs font-bold border transition-all ${
        strategy === "BPR"
          ? "bg-amber-500 text-white border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
          : "bg-panel-bg-solid text-gray-500 border-panel-border hover:text-gray-300"
      }`}>
      BPR
      <span className="block text-[10px] font-normal mt-0.5 opacity-70">d*(1+a*(V/C)^b)</span>
    </button>
  </div>
);

const BprParams: React.FC<{
  alpha: number; beta: number; onAlpha: (v: number) => void; onBeta: (v: number) => void; enabled: boolean;
}> = ({ alpha, beta, onAlpha, onBeta, enabled }) => (
  <div className={`mt-2 transition-opacity ${enabled ? "opacity-100" : "opacity-30 pointer-events-none"}`}>
    <div className="mb-2 text-[10px] text-gray-500 font-mono">
      cost = d * (1 + <span className="text-accent-cyan">a</span> * (V/C)<sup className="text-accent-cyan">b</sup>)
    </div>
    <BprParamInput label="a (alpha)" value={alpha} onChange={onAlpha} description="혼잡 가중치" />
    <BprParamInput label="b (beta)" value={beta} onChange={onBeta} description="혼잡 민감도" />
    <div className="text-[10px] text-gray-600">V = edge 위 차량 수, C = edge길이 / 차량간격</div>
  </div>
);

/** Reroute interval selector */
const REROUTE_PRESETS = [
  { value: 0, label: "도착 시만", desc: "경로 1회 생성" },
  { value: 1, label: "매 edge", desc: "비용 높음" },
  { value: 5, label: "5 edge", desc: "권장" },
  { value: 10, label: "10 edge", desc: "" },
  { value: 20, label: "20 edge", desc: "" },
];

const RerouteSelector: React.FC<{
  value: number; onChange: (v: number) => void;
}> = ({ value, onChange }) => {
  // Check if value matches a preset
  const isCustom = !REROUTE_PRESETS.some(p => p.value === value);

  return (
    <div>
      <div className={panelTextVariants({ variant: "muted", size: "xs" })}>REROUTE INTERVAL</div>
      <div className="flex flex-wrap gap-1 mt-2">
        {REROUTE_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => onChange(p.value)}
            className={`px-2 py-1 rounded text-[11px] border transition-all ${
              value === p.value
                ? "bg-accent-purple text-white border-accent-purple font-bold shadow-[0_0_6px_rgba(168,85,247,0.4)]"
                : "bg-panel-bg-solid text-gray-500 border-panel-border hover:text-gray-300"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {/* Custom input */}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[10px] text-gray-500">custom:</span>
        <input
          type="number" min="0" value={isCustom ? value : ""}
          placeholder="N"
          onChange={(e) => {
            const v = parseInt(e.target.value);
            if (!isNaN(v) && v >= 0) onChange(v);
          }}
          className="w-[50px] px-2 py-0.5 rounded text-[11px] font-mono bg-panel-bg-solid text-white border border-panel-border"
        />
        <span className="text-[10px] text-gray-600">edge마다</span>
      </div>
    </div>
  );
};

// ─── Main Panel ───

type FullRouting = { strategy: RoutingStrategy; bprAlpha: number; bprBeta: number; rerouteInterval: number };
const GLOBAL = "global";

const RoutingParamsPanel: React.FC = () => {
  const { routingConfig, setRoutingConfig, fabOverrides, setFabOverride } = useFabConfigStore();
  const controller = useShmSimulatorStore((s) => s.controller);
  const { fabs } = useFabStore();
  const [selected, setSelected] = useState<string>(GLOBAL);

  const pushToWorker = (fabId: string | undefined, cfg: FullRouting) => {
    if (!controller) return;
    controller.setRoutingConfig(cfg.strategy, cfg.bprAlpha, cfg.bprBeta, fabId, cfg.rerouteInterval);
  };

  // === Global ===
  const updateGlobal = (update: Partial<FullRouting>) => {
    setRoutingConfig(update);
    pushToWorker(undefined, { ...routingConfig, ...update });
  };

  // === Per-fab ===
  const getEffective = (fabIndex: number): FullRouting => {
    const r = fabOverrides[fabIndex]?.routing;
    return {
      strategy: (r?.strategy ?? routingConfig.strategy) as RoutingStrategy,
      bprAlpha: r?.bprAlpha ?? routingConfig.bprAlpha,
      bprBeta: r?.bprBeta ?? routingConfig.bprBeta,
      rerouteInterval: r?.rerouteInterval ?? routingConfig.rerouteInterval,
    };
  };

  const updateFab = (fabIndex: number, update: Partial<FullRouting>) => {
    const override: FabConfigOverride = JSON.parse(JSON.stringify(fabOverrides[fabIndex] || {}));
    override.routing = { ...override.routing, ...update };
    setFabOverride(fabIndex, override);

    if (controller) {
      const fabId = controller.getFabIds()[fabIndex];
      if (fabId) pushToWorker(fabId, { ...getEffective(fabIndex), ...update });
    }
  };

  const clearFab = (fabIndex: number) => {
    const override: FabConfigOverride = JSON.parse(JSON.stringify(fabOverrides[fabIndex] || {}));
    delete override.routing;
    setFabOverride(fabIndex, override);
    if (controller) {
      const fabId = controller.getFabIds()[fabIndex];
      if (fabId) pushToWorker(fabId, routingConfig);
    }
  };

  const isGlobal = selected === GLOBAL;
  const selectedFabIndex = isGlobal ? null : Number(selected);
  const selectedEff = selectedFabIndex !== null ? getEffective(selectedFabIndex) : null;
  const hasOverride = selectedFabIndex !== null && !!fabOverrides[selectedFabIndex]?.routing;

  return (
    <div className="space-y-3">
      {/* ─── Selector ─── */}
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full px-3 py-2 rounded text-sm font-bold bg-panel-bg-solid text-white border border-accent-cyan/50 focus:border-accent-cyan focus:outline-none"
      >
        <option value={GLOBAL}>Global (전체 적용)</option>
        {fabs.map((fab) => {
          const hasOvr = !!fabOverrides[fab.fabIndex]?.routing;
          return (
            <option key={fab.fabIndex} value={String(fab.fabIndex)}>
              Fab {fab.fabIndex}{hasOvr ? " ★" : ""}
            </option>
          );
        })}
      </select>

      {/* ─── Global ─── */}
      {isGlobal && (
        <>
          <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
            <div className={panelTextVariants({ variant: "muted", size: "xs" })}>COST FUNCTION</div>
            <StrategyToggle strategy={routingConfig.strategy} onChange={(s) => updateGlobal({ strategy: s })} />
          </div>
          <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
            <BprParams alpha={routingConfig.bprAlpha} beta={routingConfig.bprBeta}
              onAlpha={(v) => updateGlobal({ bprAlpha: v })} onBeta={(v) => updateGlobal({ bprBeta: v })}
              enabled={routingConfig.strategy === "BPR"} />
          </div>
          <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
            <RerouteSelector value={routingConfig.rerouteInterval} onChange={(v) => updateGlobal({ rerouteInterval: v })} />
          </div>
        </>
      )}

      {/* ─── Per-Fab ─── */}
      {!isGlobal && selectedFabIndex !== null && selectedEff && (
        <>
          <div className={`${panelCardVariants({ variant: hasOverride ? "highlight" : "default", padding: "sm" })}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-accent-orange">Fab {selectedFabIndex}</span>
              {hasOverride ? (
                <button onClick={() => clearFab(selectedFabIndex)}
                  className="text-[10px] text-gray-500 hover:text-gray-300 border border-gray-600 px-1.5 py-0.5 rounded">
                  reset to global
                </button>
              ) : (
                <span className="text-[10px] text-gray-600">Global 설정 사용 중</span>
              )}
            </div>
            <StrategyToggle strategy={selectedEff.strategy}
              onChange={(s) => updateFab(selectedFabIndex, { strategy: s })} />
          </div>
          <div className={`${panelCardVariants({ variant: hasOverride ? "highlight" : "default", padding: "sm" })}`}>
            <BprParams alpha={selectedEff.bprAlpha} beta={selectedEff.bprBeta}
              onAlpha={(v) => updateFab(selectedFabIndex, { bprAlpha: v })}
              onBeta={(v) => updateFab(selectedFabIndex, { bprBeta: v })}
              enabled={selectedEff.strategy === "BPR"} />
          </div>
          <div className={`${panelCardVariants({ variant: hasOverride ? "highlight" : "default", padding: "sm" })}`}>
            <RerouteSelector value={selectedEff.rerouteInterval}
              onChange={(v) => updateFab(selectedFabIndex, { rerouteInterval: v })} />
          </div>
        </>
      )}

      {/* ─── Override Summary ─── */}
      {fabs.some(f => fabOverrides[f.fabIndex]?.routing) && (
        <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>OVERRIDE SUMMARY</div>
          <div className="mt-1 space-y-0.5">
            {fabs.map((fab) => {
              const r = fabOverrides[fab.fabIndex]?.routing;
              if (!r) return null;
              const eff = getEffective(fab.fabIndex);
              return (
                <div key={fab.fabIndex} className="flex justify-between text-[10px]">
                  <span className="text-accent-orange">Fab {fab.fabIndex}</span>
                  <span className="text-gray-400 font-mono">
                    {eff.strategy} rr={eff.rerouteInterval}
                    {eff.strategy === "BPR" ? ` a=${eff.bprAlpha} b=${eff.bprBeta}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Info ─── */}
      <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
        <div className={panelTextVariants({ variant: "muted", size: "xs" })}>INFO</div>
        <div className="mt-1 text-[10px] text-gray-500 space-y-1">
          <div>Reroute 0 = 경로 생성 시 1회만</div>
          <div>Reroute N = N edge 지날 때마다 재탐색</div>
          <div>BPR + Reroute 조합 시 혼잡 우회 효과</div>
        </div>
      </div>
    </div>
  );
};

export default RoutingParamsPanel;
