import React, { useState } from "react";
import { useFabConfigStore, type FabConfigOverride, type TransferRateMode } from "@/store/simulation/fabConfigStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useFabStore } from "@/store/map/fabStore";
import { TransferMode } from "@/common/vehicle/initialize/constants";
import { panelCardVariants, panelTextVariants } from "../../shared/panelStyles";

// ─── Mode definitions (LOOP 제외 — 기본 동작이므로 선택 불필요) ───

const MODE_LIST: { mode: TransferMode; label: string; desc: string; color: string }[] = [
  { mode: TransferMode.AUTO_ROUTE, label: "AUTO", desc: "시뮬레이터가 자동 반송 생성 (랜덤 목적지)", color: "bg-cyan-500 border-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]" },
  { mode: TransferMode.MQTT_CONTROL, label: "MQTT", desc: "외부에서 반송 명령 수신", color: "bg-amber-500 border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" },
];

const RATE_MODES: { mode: TransferRateMode; label: string; desc: string }[] = [
  { mode: "utilization", label: "가동률", desc: "차량 N%가 반송하도록 조절" },
  { mode: "throughput", label: "물량", desc: "시간당 반송 건수 고정" },
];

// ─── Sub-components ───

const ModeButton: React.FC<{
  item: typeof MODE_LIST[number]; active: boolean; onClick: () => void;
}> = ({ item, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs border rounded transition-all ${
      active
        ? `${item.color} text-white`
        : "bg-panel-bg-solid text-gray-500 border-panel-border hover:text-gray-300"
    }`}
  >
    <span className="font-bold w-[52px] shrink-0 text-left">{item.label}</span>
    <span className={`text-[10px] ${active ? "text-white/80" : "text-gray-600"}`}>{item.desc}</span>
  </button>
);

const RateToggle: React.FC<{
  active: TransferRateMode; onChange: (mode: TransferRateMode) => void;
}> = ({ active, onChange }) => (
  <div className="flex gap-1">
    {RATE_MODES.map((r) => (
      <button
        key={r.mode}
        onClick={() => onChange(r.mode)}
        title={r.desc}
        className={`flex-1 px-2 py-1.5 text-xs font-bold border rounded transition-all ${
          active === r.mode
            ? "bg-accent-cyan/20 border-accent-cyan text-accent-cyan"
            : "bg-panel-bg-solid text-gray-500 border-panel-border hover:text-gray-300"
        }`}
      >
        {r.label}
      </button>
    ))}
  </div>
);

const NumberInput: React.FC<{
  label: string; value: number; unit: string; onChange: (v: number) => void;
}> = ({ label, value, unit, onChange }) => {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => { setText(String(value)); }, [value]);

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-400 shrink-0">{label}</label>
      <input
        type="text" inputMode="decimal" value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number.parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        onBlur={() => {
          const v = Number.parseFloat(text);
          if (Number.isNaN(v)) setText(String(value));
        }}
        className="w-[70px] px-2 py-1 rounded text-xs font-mono bg-panel-bg-solid text-white border border-accent-cyan/50"
      />
      <span className="text-[10px] text-gray-600">{unit}</span>
    </div>
  );
};

// ─── Main Panel ───

const GLOBAL = "global";

const ModeParamsPanel: React.FC = () => {
  const {
    transferEnabled, setTransferEnabled,
    transferModeConfig, setTransferModeConfig,
    transferRateConfig, setTransferRateConfig,
    fabOverrides, setFabOverride,
  } = useFabConfigStore();
  const controller = useShmSimulatorStore((s) => s.controller);
  const { fabs } = useFabStore();
  const [selected, setSelected] = useState<string>(GLOBAL);

  const pushToWorker = (fabId: string | undefined, mode: TransferMode) => {
    if (!controller) return;
    controller.setTransferMode(mode, fabId);
  };

  // === Global ===
  const updateGlobal = (mode: TransferMode) => {
    setTransferModeConfig(mode);
    pushToWorker(undefined, mode);
  };

  // === Per-fab ===
  const getEffective = (fabIndex: number): TransferMode => {
    return fabOverrides[fabIndex]?.transferMode ?? transferModeConfig;
  };

  const updateFab = (fabIndex: number, mode: TransferMode) => {
    const override: FabConfigOverride = JSON.parse(JSON.stringify(fabOverrides[fabIndex] || {}));
    override.transferMode = mode;
    setFabOverride(fabIndex, override);

    if (controller) {
      const fabId = controller.getFabIds()[fabIndex];
      if (fabId) pushToWorker(fabId, mode);
    }
  };

  const clearFab = (fabIndex: number) => {
    const override: FabConfigOverride = JSON.parse(JSON.stringify(fabOverrides[fabIndex] || {}));
    delete override.transferMode;
    setFabOverride(fabIndex, override);
    if (controller) {
      const fabId = controller.getFabIds()[fabIndex];
      if (fabId) pushToWorker(fabId, transferModeConfig);
    }
  };

  const isGlobal = selected === GLOBAL;
  const selectedFabIndex = isGlobal ? null : Number(selected);
  const selectedEff = selectedFabIndex !== null ? getEffective(selectedFabIndex) : null;
  const hasOverride = selectedFabIndex !== null && fabOverrides[selectedFabIndex]?.transferMode !== undefined;

  // ─── Mode selector (shared between global / per-fab) ───
  const renderModeSelector = (activeMode: TransferMode, onSelect: (m: TransferMode) => void) => (
    <>
      <div className={panelTextVariants({ variant: "muted", size: "xs" })}>TRANSFER MODE</div>
      <div className="space-y-1 mt-1">
        {MODE_LIST.map((m) => (
          <ModeButton key={m.mode} item={m} active={activeMode === m.mode}
            onClick={() => onSelect(m.mode)} />
        ))}
      </div>
    </>
  );

  return (
    <div className="space-y-3">
      {/* ─── 반송 ON/OFF ─── */}
      <div className={`${panelCardVariants({ variant: transferEnabled ? "highlight" : "default", padding: "sm" })}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white">반송</span>
          <button
            onClick={() => setTransferEnabled(!transferEnabled)}
            className={`px-3 py-1 text-xs font-bold rounded border transition-all ${
              transferEnabled
                ? "bg-green-500/20 border-green-500 text-green-400 shadow-[0_0_8px_rgba(34,197,94,0.3)]"
                : "bg-panel-bg-solid border-panel-border text-gray-500 hover:text-gray-300"
            }`}
          >
            {transferEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <div className="text-[10px] text-gray-500 mt-1">
          {transferEnabled
            ? "반송 명령 활성. 완료 후 LOOP 복귀."
            : "모든 차량이 bay LOOP만 순회."}
        </div>
      </div>

      {/* ─── 반송 OFF면 여기서 끝 ─── */}
      {!transferEnabled ? null : (
        <>
          {/* ─── Fab Selector ─── */}
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm font-bold bg-panel-bg-solid text-white border border-accent-cyan/50 focus:border-accent-cyan focus:outline-none"
          >
            <option value={GLOBAL}>Global</option>
            {fabs.map((fab) => {
              const hasOvr = fabOverrides[fab.fabIndex]?.transferMode !== undefined;
              return (
                <option key={fab.fabIndex} value={String(fab.fabIndex)}>
                  Fab {fab.fabIndex}{hasOvr ? " *" : ""}
                </option>
              );
            })}
          </select>

          {/* ─── Global ─── */}
          {isGlobal && (
            <>
              <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
                {renderModeSelector(transferModeConfig, updateGlobal)}
              </div>

              {/* ─── Transfer Rate ─── */}
              <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
                <div className={panelTextVariants({ variant: "muted", size: "xs" })}>TRANSFER RATE</div>
                <div className="mt-2 space-y-2">
                  <RateToggle
                    active={transferRateConfig.mode}
                    onChange={(mode) => setTransferRateConfig({ mode })}
                  />
                  {transferRateConfig.mode === "utilization" ? (
                    <NumberInput
                      label="목표 가동률"
                      value={transferRateConfig.utilizationPercent}
                      unit="%"
                      onChange={(v) => setTransferRateConfig({ utilizationPercent: Math.max(0, Math.min(100, v)) })}
                    />
                  ) : (
                    <NumberInput
                      label="반송량"
                      value={transferRateConfig.throughputPerHour}
                      unit="/h"
                      onChange={(v) => setTransferRateConfig({ throughputPerHour: Math.max(0, v) })}
                    />
                  )}
                </div>
              </div>
            </>
          )}

          {/* ─── Per-Fab ─── */}
          {!isGlobal && selectedFabIndex !== null && selectedEff !== null && (
            <div className={`${panelCardVariants({ variant: hasOverride ? "highlight" : "default", padding: "sm" })}`}>
              <div className="flex items-center justify-between mb-2">
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
              {renderModeSelector(selectedEff, (m) => updateFab(selectedFabIndex, m))}
            </div>
          )}

          {/* ─── Override Summary ─── */}
          {fabs.some(f => fabOverrides[f.fabIndex]?.transferMode !== undefined) && (
            <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
              <div className={panelTextVariants({ variant: "muted", size: "xs" })}>OVERRIDE SUMMARY</div>
              <div className="mt-1 space-y-0.5">
                {fabs.map((fab) => {
                  const tm = fabOverrides[fab.fabIndex]?.transferMode;
                  if (tm === undefined) return null;
                  return (
                    <div key={fab.fabIndex} className="flex justify-between text-[10px]">
                      <span className="text-accent-orange">Fab {fab.fabIndex}</span>
                      <span className="text-gray-400 font-mono">{tm}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ModeParamsPanel;
