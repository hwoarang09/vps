import React, { useState } from "react";
import { useFabConfigStore, type FabConfigOverride, type TransferRateMode, type TransferRateConfig } from "@/store/simulation/fabConfigStore";
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

const OnOffButton: React.FC<{ enabled: boolean; onClick: () => void }> = ({ enabled, onClick }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1 text-xs font-bold rounded border transition-all ${
      enabled
        ? "bg-green-500/20 border-green-500 text-green-400 shadow-[0_0_8px_rgba(34,197,94,0.3)]"
        : "bg-panel-bg-solid border-panel-border text-gray-500 hover:text-gray-300"
    }`}
  >
    {enabled ? "ON" : "OFF"}
  </button>
);

// ─── Transfer Rate Config Section ───

const TransferRateSection: React.FC<{
  rateConfig: TransferRateConfig;
  onChangeMode: (mode: TransferRateMode) => void;
  onChangeValue: (update: Partial<TransferRateConfig>) => void;
}> = ({ rateConfig, onChangeMode, onChangeValue }) => (
  <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
    <div className={panelTextVariants({ variant: "muted", size: "xs" })}>TRANSFER RATE</div>
    <div className="mt-2 space-y-2">
      <RateToggle active={rateConfig.mode} onChange={onChangeMode} />
      {rateConfig.mode === "utilization" ? (
        <NumberInput
          label="목표 가동률"
          value={rateConfig.utilizationPercent}
          unit="%"
          onChange={(v) => onChangeValue({ utilizationPercent: Math.max(0, Math.min(100, v)) })}
        />
      ) : (
        <NumberInput
          label="반송량"
          value={rateConfig.throughputPerHour}
          unit="/h"
          onChange={(v) => onChangeValue({ throughputPerHour: Math.max(0, v) })}
        />
      )}
    </div>
  </div>
);

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

  // === Worker push helpers ===
  const pushMode = (fabId: string | undefined, mode: TransferMode) => {
    controller?.setTransferMode(mode, fabId);
  };
  const pushEnabled = (fabId: string | undefined, enabled: boolean) => {
    console.log(`[ModeParamsPanel] pushEnabled: enabled=${enabled}, fabId=${fabId}, controller=${!!controller}`);
    controller?.setTransferEnabled(enabled, fabId);
  };
  const pushRate = (fabId: string | undefined, rateConfig: TransferRateConfig) => {
    controller?.setTransferRate(
      rateConfig.mode,
      rateConfig.utilizationPercent,
      rateConfig.throughputPerHour,
      fabId,
    );
  };

  // === Global handlers ===
  const handleGlobalEnabled = (enabled: boolean) => {
    setTransferEnabled(enabled);
    pushEnabled(undefined, enabled);
  };
  const handleGlobalMode = (mode: TransferMode) => {
    setTransferModeConfig(mode);
    pushMode(undefined, mode);
  };
  const handleGlobalRateMode = (mode: TransferRateMode) => {
    const updated = { ...transferRateConfig, mode };
    setTransferRateConfig({ mode });
    pushRate(undefined, updated);
  };
  const handleGlobalRateValue = (update: Partial<TransferRateConfig>) => {
    const updated = { ...transferRateConfig, ...update };
    setTransferRateConfig(update);
    pushRate(undefined, updated);
  };

  // === Per-fab helpers ===
  const getFabId = (fabIndex: number): string | undefined => {
    return controller?.getFabIds()[fabIndex];
  };
  const getEffectiveMode = (fabIndex: number): TransferMode => {
    return fabOverrides[fabIndex]?.transferMode ?? transferModeConfig;
  };
  const getEffectiveEnabled = (fabIndex: number): boolean => {
    return fabOverrides[fabIndex]?.transferEnabled ?? transferEnabled;
  };
  const getEffectiveRate = (fabIndex: number): TransferRateConfig => {
    const ovr = fabOverrides[fabIndex]?.transferRateConfig;
    return {
      mode: ovr?.mode ?? transferRateConfig.mode,
      utilizationPercent: ovr?.utilizationPercent ?? transferRateConfig.utilizationPercent,
      throughputPerHour: ovr?.throughputPerHour ?? transferRateConfig.throughputPerHour,
    };
  };

  const updateFabOverride = (fabIndex: number, patch: Partial<FabConfigOverride>) => {
    const override: FabConfigOverride = JSON.parse(JSON.stringify(fabOverrides[fabIndex] || {}));
    Object.assign(override, patch);
    setFabOverride(fabIndex, override);
  };

  const handleFabEnabled = (fabIndex: number, enabled: boolean) => {
    updateFabOverride(fabIndex, { transferEnabled: enabled });
    const fabId = getFabId(fabIndex);
    if (fabId) pushEnabled(fabId, enabled);
  };
  const handleFabMode = (fabIndex: number, mode: TransferMode) => {
    updateFabOverride(fabIndex, { transferMode: mode });
    const fabId = getFabId(fabIndex);
    if (fabId) pushMode(fabId, mode);
  };
  const handleFabRateMode = (fabIndex: number, rateMode: TransferRateMode) => {
    const current = getEffectiveRate(fabIndex);
    const updated = { ...current, mode: rateMode };
    updateFabOverride(fabIndex, { transferRateConfig: updated });
    const fabId = getFabId(fabIndex);
    if (fabId) pushRate(fabId, updated);
  };
  const handleFabRateValue = (fabIndex: number, update: Partial<TransferRateConfig>) => {
    const current = getEffectiveRate(fabIndex);
    const updated = { ...current, ...update };
    updateFabOverride(fabIndex, { transferRateConfig: updated });
    const fabId = getFabId(fabIndex);
    if (fabId) pushRate(fabId, updated);
  };
  const clearFabOverrides = (fabIndex: number) => {
    const override: FabConfigOverride = JSON.parse(JSON.stringify(fabOverrides[fabIndex] || {}));
    delete override.transferMode;
    delete override.transferEnabled;
    delete override.transferRateConfig;
    setFabOverride(fabIndex, override);
    const fabId = getFabId(fabIndex);
    if (fabId) {
      pushMode(fabId, transferModeConfig);
      pushEnabled(fabId, transferEnabled);
      pushRate(fabId, transferRateConfig);
    }
  };

  const isGlobal = selected === GLOBAL;
  const selectedFabIndex = isGlobal ? null : Number(selected);
  const hasFabOverride = (fi: number) =>
    fabOverrides[fi]?.transferMode !== undefined ||
    fabOverrides[fi]?.transferEnabled !== undefined ||
    fabOverrides[fi]?.transferRateConfig !== undefined;

  // ─── Mode selector (shared) ───
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
      {/* ─── Global 반송 ON/OFF ─── */}
      <div className={`${panelCardVariants({ variant: transferEnabled ? "highlight" : "default", padding: "sm" })}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white">반송 (Global)</span>
          <OnOffButton enabled={transferEnabled} onClick={() => handleGlobalEnabled(!transferEnabled)} />
        </div>
        <div className="text-[10px] text-gray-500 mt-1">
          {transferEnabled
            ? "반송 명령 활성. 완료 후 LOOP 복귀."
            : "모든 차량이 bay LOOP만 순회."}
        </div>
      </div>

      {/* ─── Fab Selector ─── */}
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full px-3 py-2 rounded text-sm font-bold bg-panel-bg-solid text-white border border-accent-cyan/50 focus:border-accent-cyan focus:outline-none"
      >
        <option value={GLOBAL}>Global</option>
        {fabs.map((fab) => (
          <option key={fab.fabIndex} value={String(fab.fabIndex)}>
            Fab {fab.fabIndex}{hasFabOverride(fab.fabIndex) ? " *" : ""}
          </option>
        ))}
      </select>

      {/* ─── Global Settings ─── */}
      {isGlobal && (
        <>
          <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
            {renderModeSelector(transferModeConfig, handleGlobalMode)}
          </div>
          <TransferRateSection
            rateConfig={transferRateConfig}
            onChangeMode={handleGlobalRateMode}
            onChangeValue={handleGlobalRateValue}
          />
        </>
      )}

      {/* ─── Per-Fab Settings ─── */}
      {!isGlobal && selectedFabIndex !== null && (
        <div className={`${panelCardVariants({ variant: hasFabOverride(selectedFabIndex) ? "highlight" : "default", padding: "sm" })} space-y-3`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-accent-orange">Fab {selectedFabIndex}</span>
            {hasFabOverride(selectedFabIndex) ? (
              <button onClick={() => clearFabOverrides(selectedFabIndex)}
                className="text-[10px] text-gray-500 hover:text-gray-300 border border-gray-600 px-1.5 py-0.5 rounded">
                reset to global
              </button>
            ) : (
              <span className="text-[10px] text-gray-600">Global 설정 사용 중</span>
            )}
          </div>

          {/* Per-fab ON/OFF */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">반송</span>
            <OnOffButton
              enabled={getEffectiveEnabled(selectedFabIndex)}
              onClick={() => handleFabEnabled(selectedFabIndex, !getEffectiveEnabled(selectedFabIndex))}
            />
          </div>

          {/* Per-fab Mode */}
          {renderModeSelector(getEffectiveMode(selectedFabIndex), (m) => handleFabMode(selectedFabIndex, m))}

          {/* Per-fab Rate */}
          <TransferRateSection
            rateConfig={getEffectiveRate(selectedFabIndex)}
            onChangeMode={(m) => handleFabRateMode(selectedFabIndex, m)}
            onChangeValue={(u) => handleFabRateValue(selectedFabIndex, u)}
          />
        </div>
      )}

      {/* ─── Override Summary ─── */}
      {fabs.some(f => hasFabOverride(f.fabIndex)) && (
        <div className={`${panelCardVariants({ variant: "default", padding: "sm" })}`}>
          <div className={panelTextVariants({ variant: "muted", size: "xs" })}>OVERRIDE SUMMARY</div>
          <div className="mt-1 space-y-0.5">
            {fabs.map((fab) => {
              if (!hasFabOverride(fab.fabIndex)) return null;
              const ovr = fabOverrides[fab.fabIndex];
              const parts: string[] = [];
              if (ovr?.transferEnabled !== undefined) parts.push(ovr.transferEnabled ? "ON" : "OFF");
              if (ovr?.transferMode) parts.push(ovr.transferMode);
              if (ovr?.transferRateConfig) {
                const r = ovr.transferRateConfig;
                if (r.mode === "utilization" && r.utilizationPercent !== undefined) parts.push(`${r.utilizationPercent}%`);
                else if (r.mode === "throughput" && r.throughputPerHour !== undefined) parts.push(`${r.throughputPerHour}/h`);
              }
              return (
                <div key={fab.fabIndex} className="flex justify-between text-[10px]">
                  <span className="text-accent-orange">Fab {fab.fabIndex}</span>
                  <span className="text-gray-400 font-mono">{parts.join(" · ")}</span>
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
