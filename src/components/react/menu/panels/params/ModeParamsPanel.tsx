import React, { useState } from "react";
import { useFabConfigStore, type FabConfigOverride } from "@/store/simulation/fabConfigStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useFabStore } from "@/store/map/fabStore";
import { TransferMode } from "@/common/vehicle/initialize/constants";
import { panelCardVariants, panelTextVariants } from "../../shared/panelStyles";

// ─── Mode definitions ───

const MODE_LIST: { mode: TransferMode; label: string; desc: string; color: string }[] = [
  { mode: TransferMode.LOOP, label: "LOOP", desc: "Bay Loop 경로를 반복 순환", color: "bg-green-500 border-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" },
  { mode: TransferMode.RANDOM, label: "RANDOM", desc: "Station 간 랜덤 반송", color: "bg-purple-500 border-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" },
  { mode: TransferMode.MQTT_CONTROL, label: "MQTT", desc: "외부 시스템에서 반송 명령 수신", color: "bg-amber-500 border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" },
  { mode: TransferMode.AUTO_ROUTE, label: "AUTO", desc: "자동 경로 탐색 및 반송", color: "bg-cyan-500 border-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]" },
];

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

// ─── Main Panel ───

const GLOBAL = "global";

const ModeParamsPanel: React.FC = () => {
  const { transferModeConfig, setTransferModeConfig, fabOverrides, setFabOverride } = useFabConfigStore();
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
          const hasOvr = fabOverrides[fab.fabIndex]?.transferMode !== undefined;
          return (
            <option key={fab.fabIndex} value={String(fab.fabIndex)}>
              Fab {fab.fabIndex}{hasOvr ? " ★" : ""}
            </option>
          );
        })}
      </select>

      {/* ─── Global ─── */}
      {isGlobal && (
        <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>TRANSFER MODE</div>
          <div className="space-y-1 mt-2">
            {MODE_LIST.map((m) => (
              <ModeButton key={m.mode} item={m} active={transferModeConfig === m.mode}
                onClick={() => updateGlobal(m.mode)} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Per-Fab ─── */}
      {!isGlobal && selectedFabIndex !== null && selectedEff !== null && (
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
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>TRANSFER MODE</div>
          <div className="space-y-1 mt-2">
            {MODE_LIST.map((m) => (
              <ModeButton key={m.mode} item={m} active={selectedEff === m.mode}
                onClick={() => updateFab(selectedFabIndex, m.mode)} />
            ))}
          </div>
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

    </div>
  );
};

export default ModeParamsPanel;
