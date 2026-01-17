import React, { useState, useEffect } from "react";
import { X, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useFabConfigStore, type FabConfigOverride } from "@/store/simulation/fabConfigStore";
import { useFabStore } from "@/store/map/fabStore";

interface ParamInputProps {
  label: string;
  value: number | undefined;
  baseValue: number;
  onChange: (value: number | undefined) => void;
  unit?: string;
  description?: string;
}

const ParamInput: React.FC<ParamInputProps> = ({
  label,
  value,
  baseValue,
  onChange,
  unit = "",
  description,
}) => {
  const isOverridden = value !== undefined;
  const displayValue = value ?? baseValue;
  // 입력 중간 상태를 위한 로컬 상태 (예: "-" 입력 중)
  const [inputValue, setInputValue] = useState<string>(String(displayValue));

  // 외부 value가 변경되면 inputValue도 업데이트
  useEffect(() => {
    setInputValue(String(displayValue));
  }, [displayValue]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
      <label style={{ width: "180px", fontSize: "12px", color: "#ccc" }}>
        {label}
        {description && (
          <span style={{ fontSize: "10px", color: "#888", display: "block" }}>
            {description}
          </span>
        )}
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={inputValue}
        onChange={(e) => {
          const raw = e.target.value;
          setInputValue(raw);
          // 빈 값이나 "-"만 있으면 아직 입력 중
          if (raw === "" || raw === "-" || raw === ".") {
            return;
          }
          const val = Number.parseFloat(raw);
          if (!Number.isNaN(val)) {
            onChange(val);
          }
        }}
        onBlur={() => {
          // 포커스를 잃을 때 유효한 값으로 정리
          const val = Number.parseFloat(inputValue);
          if (Number.isNaN(val)) {
            setInputValue(String(displayValue));
          } else {
            setInputValue(String(val));
            onChange(val);
          }
        }}
        style={{
          width: "80px",
          padding: "4px 8px",
          background: isOverridden ? "#2a4a3a" : "#333",
          color: isOverridden ? "#4ecdc4" : "#fff",
          border: isOverridden ? "1px solid #4ecdc4" : "1px solid #555",
          borderRadius: "4px",
          fontSize: "12px",
        }}
      />
      <span style={{ fontSize: "11px", color: "#888", width: "30px" }}>{unit}</span>
      {isOverridden && (
        <button
          onClick={() => onChange(undefined)}
          style={{
            background: "transparent",
            border: "none",
            color: "#888",
            cursor: "pointer",
            padding: "2px",
          }}
          title="Reset to base value"
        >
          <X size={14} />
        </button>
      )}
      <span style={{ fontSize: "10px", color: "#666" }}>
        (base: {baseValue})
      </span>
    </div>
  );
};

// Request Mode 선택 컴포넌트 (immediate / distance)
type RequestMode = "immediate" | "distance";

interface RequestModeInputProps {
  value: number | undefined;
  baseValue: number;
  onChange: (value: number | undefined) => void;
}

const RequestModeInput: React.FC<RequestModeInputProps> = ({
  value,
  baseValue,
  onChange,
}) => {
  const isOverridden = value !== undefined;
  const effectiveValue = value ?? baseValue;
  const currentMode: RequestMode = effectiveValue < 0 ? "immediate" : "distance";
  const baseMode: RequestMode = baseValue < 0 ? "immediate" : "distance";

  // distance 모드일 때 거리값 (immediate면 기본 5.0 사용)
  const [distanceValue, setDistanceValue] = useState<string>(
    currentMode === "distance" ? String(effectiveValue) : "5.0"
  );

  // 외부 value가 변경되면 distanceValue도 업데이트
  useEffect(() => {
    if (currentMode === "distance") {
      setDistanceValue(String(effectiveValue));
    }
  }, [effectiveValue, currentMode]);

  const handleModeChange = (newMode: RequestMode) => {
    if (newMode === "immediate") {
      onChange(-1);
    } else {
      // distance 모드로 전환 시, 저장된 거리값 또는 기본값 사용
      const dist = Number.parseFloat(distanceValue);
      onChange(Number.isNaN(dist) || dist <= 0 ? 5.0 : dist);
    }
  };

  const handleDistanceChange = (newDist: number) => {
    if (newDist > 0) {
      onChange(newDist);
    }
  };

  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <label style={{ width: "180px", fontSize: "12px", color: "#ccc" }}>
          Request Mode
          <span style={{ fontSize: "10px", color: "#888", display: "block" }}>
            락 요청 시점 결정 방식
          </span>
        </label>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => handleModeChange("immediate")}
            style={{
              padding: "4px 12px",
              background: currentMode === "immediate" ? "#e74c3c" : "#333",
              color: currentMode === "immediate" ? "#fff" : "#888",
              border: currentMode === "immediate" ? "1px solid #e74c3c" : "1px solid #555",
              borderRadius: "4px 0 0 4px",
              fontSize: "11px",
              cursor: "pointer",
              fontWeight: currentMode === "immediate" ? "bold" : "normal",
            }}
          >
            Immediate
          </button>
          <button
            onClick={() => handleModeChange("distance")}
            style={{
              padding: "4px 12px",
              background: currentMode === "distance" ? "#27ae60" : "#333",
              color: currentMode === "distance" ? "#fff" : "#888",
              border: currentMode === "distance" ? "1px solid #27ae60" : "1px solid #555",
              borderRadius: "0 4px 4px 0",
              fontSize: "11px",
              cursor: "pointer",
              fontWeight: currentMode === "distance" ? "bold" : "normal",
            }}
          >
            Distance
          </button>
        </div>
        {isOverridden && (
          <button
            onClick={() => onChange(undefined)}
            style={{
              background: "transparent",
              border: "none",
              color: "#888",
              cursor: "pointer",
              padding: "2px",
            }}
            title="Reset to base value"
          >
            <X size={14} />
          </button>
        )}
        <span style={{ fontSize: "10px", color: "#666" }}>
          (base: {baseMode})
        </span>
      </div>

      {/* Distance 모드일 때만 거리 입력 표시 */}
      {currentMode === "distance" && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingLeft: "180px" }}>
          <span style={{ fontSize: "11px", color: "#888" }}>Distance:</span>
          <input
            type="text"
            inputMode="decimal"
            value={distanceValue}
            onChange={(e) => {
              const raw = e.target.value;
              setDistanceValue(raw);
              if (raw === "" || raw === ".") return;
              const val = Number.parseFloat(raw);
              if (!Number.isNaN(val) && val > 0) {
                handleDistanceChange(val);
              }
            }}
            onBlur={() => {
              const val = Number.parseFloat(distanceValue);
              if (Number.isNaN(val) || val <= 0) {
                setDistanceValue(String(effectiveValue > 0 ? effectiveValue : 5.0));
              } else {
                setDistanceValue(String(val));
                handleDistanceChange(val);
              }
            }}
            style={{
              width: "60px",
              padding: "4px 8px",
              background: isOverridden ? "#2a4a3a" : "#333",
              color: isOverridden ? "#4ecdc4" : "#fff",
              border: isOverridden ? "1px solid #4ecdc4" : "1px solid #555",
              borderRadius: "4px",
              fontSize: "12px",
            }}
          />
          <span style={{ fontSize: "11px", color: "#888" }}>m</span>
          <span style={{ fontSize: "10px", color: "#666" }}>
            (toNode 앞 거리)
          </span>
        </div>
      )}

      {/* Immediate 모드일 때 설명 */}
      {currentMode === "immediate" && (
        <div style={{ paddingLeft: "180px" }}>
          <span style={{ fontSize: "10px", color: "#888" }}>
            엣지 진입 즉시 락 요청
          </span>
        </div>
      )}
    </div>
  );
};

interface SectionProps {
  title: string;
  color: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const Section: React.FC<SectionProps> = ({ title, color, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: "16px" }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "transparent",
          border: "none",
          color: color,
          fontSize: "14px",
          fontWeight: "bold",
          cursor: "pointer",
          padding: "4px 0",
        }}
      >
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {title}
      </button>
      {isOpen && (
        <div style={{ paddingLeft: "24px", marginTop: "8px" }}>
          {children}
        </div>
      )}
    </div>
  );
};

interface FabOverrideEditorProps {
  fabIndex: number;
  onRemove: () => void;
}

const FabOverrideEditor: React.FC<FabOverrideEditorProps> = ({ fabIndex, onRemove }) => {
  const { baseConfig, fabOverrides, setFabOverride } = useFabConfigStore();
  const override = fabOverrides[fabIndex] || {};

  const updateOverride = (path: string[], value: number | undefined) => {
    const newOverride: FabConfigOverride = JSON.parse(JSON.stringify(override));

    if (path.length === 2) {
      const [section, key] = path;
      if (section === "lock") {
        newOverride.lock = newOverride.lock || {};
        if (value === undefined) {
          delete (newOverride.lock as Record<string, unknown>)[key];
          if (Object.keys(newOverride.lock).length === 0) {
            delete newOverride.lock;
          }
        } else {
          (newOverride.lock as Record<string, number>)[key] = value;
        }
      }
    } else if (path.length === 3) {
      const [section, subsection, key] = path;
      if (section === "movement") {
        newOverride.movement = newOverride.movement || {};
        if (subsection === "linear") {
          newOverride.movement.linear = newOverride.movement.linear || {};
          if (value === undefined) {
            delete (newOverride.movement.linear as Record<string, unknown>)[key];
            if (Object.keys(newOverride.movement.linear).length === 0) {
              delete newOverride.movement.linear;
            }
          } else {
            (newOverride.movement.linear as Record<string, number>)[key] = value;
          }
        } else if (subsection === "curve") {
          newOverride.movement.curve = newOverride.movement.curve || {};
          if (value === undefined) {
            delete (newOverride.movement.curve as Record<string, unknown>)[key];
            if (Object.keys(newOverride.movement.curve).length === 0) {
              delete newOverride.movement.curve;
            }
          } else {
            (newOverride.movement.curve as Record<string, number>)[key] = value;
          }
        }
        if (newOverride.movement && !newOverride.movement.linear && !newOverride.movement.curve) {
          delete newOverride.movement;
        }
      }
    }

    setFabOverride(fabIndex, newOverride);
  };

  const overrideCount = Object.keys(override.lock || {}).length +
    Object.keys(override.movement?.linear || {}).length +
    Object.keys(override.movement?.curve || {}).length;

  return (
    <div
      style={{
        background: "#1a2a35",
        borderRadius: "8px",
        padding: "12px",
        marginBottom: "12px",
        border: "1px solid #3a5a6a",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ color: "#f39c12", fontWeight: "bold", fontSize: "14px" }}>
          Fab {fabIndex}
          {overrideCount > 0 && (
            <span style={{ color: "#4ecdc4", marginLeft: "8px", fontSize: "11px" }}>
              ({overrideCount} override{overrideCount > 1 ? "s" : ""})
            </span>
          )}
        </span>
        <button
          onClick={onRemove}
          style={{
            background: "#c0392b",
            border: "none",
            borderRadius: "4px",
            padding: "4px 8px",
            color: "white",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
          }}
        >
          <Trash2 size={12} />
          Remove
        </button>
      </div>

      <Section title="Lock" color="#e74c3c" defaultOpen={true}>
        <ParamInput
          label="Wait Distance"
          value={override.lock?.waitDistance}
          baseValue={baseConfig.lock.waitDistance}
          onChange={(v) => updateOverride(["lock", "waitDistance"], v)}
          unit="m"
          description="toNode 앞 대기 지점"
        />
        <RequestModeInput
          value={override.lock?.requestDistance}
          baseValue={baseConfig.lock.requestDistance}
          onChange={(v) => updateOverride(["lock", "requestDistance"], v)}
        />
      </Section>

      <Section title="Movement - Linear" color="#3498db" defaultOpen={false}>
        <ParamInput
          label="Max Speed"
          value={override.movement?.linear?.maxSpeed}
          baseValue={baseConfig.movement.linear.maxSpeed}
          onChange={(v) => updateOverride(["movement", "linear", "maxSpeed"], v)}
          unit="m/s"
        />
        <ParamInput
          label="Acceleration"
          value={override.movement?.linear?.acceleration}
          baseValue={baseConfig.movement.linear.acceleration}
          onChange={(v) => updateOverride(["movement", "linear", "acceleration"], v)}
          unit="m/s²"
        />
        <ParamInput
          label="Deceleration"
          value={override.movement?.linear?.deceleration}
          baseValue={baseConfig.movement.linear.deceleration}
          onChange={(v) => updateOverride(["movement", "linear", "deceleration"], v)}
          unit="m/s²"
        />
      </Section>

      <Section title="Movement - Curve" color="#9b59b6" defaultOpen={false}>
        <ParamInput
          label="Max Speed"
          value={override.movement?.curve?.maxSpeed}
          baseValue={baseConfig.movement.curve.maxSpeed}
          onChange={(v) => updateOverride(["movement", "curve", "maxSpeed"], v)}
          unit="m/s"
        />
        <ParamInput
          label="Acceleration"
          value={override.movement?.curve?.acceleration}
          baseValue={baseConfig.movement.curve.acceleration}
          onChange={(v) => updateOverride(["movement", "curve", "acceleration"], v)}
          unit="m/s²"
        />
      </Section>
    </div>
  );
};

const SimulationParamsModal: React.FC = () => {
  const { isModalOpen, setModalOpen, baseConfig, fabOverrides, clearAllOverrides, syncFromSimulationConfig } = useFabConfigStore();
  const { fabs } = useFabStore();
  const [selectedFabToAdd, setSelectedFabToAdd] = useState<number>(0);

  // 모달이 열릴 때 simulationConfig에서 최신 값 동기화
  useEffect(() => {
    if (isModalOpen) {
      syncFromSimulationConfig();
    }
  }, [isModalOpen, syncFromSimulationConfig]);

  // 오버라이드가 있는 fab 목록
  const overriddenFabIndices = Object.keys(fabOverrides).map(Number).sort((a, b) => a - b);

  // 오버라이드가 없는 fab 목록 (추가 가능한 fab)
  const availableFabIndices = fabs
    .map(f => f.fabIndex)
    .filter(idx => !overriddenFabIndices.includes(idx))
    .sort((a, b) => a - b);

  useEffect(() => {
    if (availableFabIndices.length > 0 && !availableFabIndices.includes(selectedFabToAdd)) {
      setSelectedFabToAdd(availableFabIndices[0]);
    }
  }, [availableFabIndices, selectedFabToAdd]);

  if (!isModalOpen) return null;

  const handleAddFabOverride = () => {
    useFabConfigStore.getState().setFabOverride(selectedFabToAdd, {});
  };

  const handleRemoveFabOverride = (fabIndex: number) => {
    useFabConfigStore.getState().removeFabOverride(fabIndex);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 2000,
      }}
      onClick={() => setModalOpen(false)}
    >
      <div
        style={{
          background: "#1a1a2e",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "800px",
          width: "90%",
          maxHeight: "85vh",
          overflow: "auto",
          border: "1px solid #4a5a6a",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ color: "#fff", margin: 0, fontSize: "18px" }}>
            Simulation Parameters
          </h2>
          <button
            onClick={() => setModalOpen(false)}
            style={{
              background: "transparent",
              border: "none",
              color: "#888",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <X size={24} />
          </button>
        </div>

        {/* Base Config Display */}
        <div
          style={{
            background: "#0d1117",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "20px",
            border: "1px solid #30363d",
          }}
        >
          <h3 style={{ color: "#58a6ff", margin: "0 0 16px 0", fontSize: "14px" }}>
            Base Configuration (applies to all fabs)
          </h3>

          <Section title="Lock" color="#e74c3c">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
              <div>
                <span style={{ color: "#888" }}>Wait Distance:</span>
                <span style={{ color: "#fff", marginLeft: "8px" }}>{baseConfig.lock.waitDistance} m</span>
              </div>
              <div>
                <span style={{ color: "#888" }}>Request Mode:</span>
                <span style={{
                  color: baseConfig.lock.requestDistance < 0 ? "#e74c3c" : "#27ae60",
                  marginLeft: "8px",
                  fontWeight: "bold"
                }}>
                  {baseConfig.lock.requestDistance < 0
                    ? "Immediate"
                    : `Distance (${baseConfig.lock.requestDistance} m)`}
                </span>
              </div>
            </div>
          </Section>

          <Section title="Movement - Linear" color="#3498db">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
              <div>
                <span style={{ color: "#888" }}>Max Speed:</span>
                <span style={{ color: "#fff", marginLeft: "8px" }}>{baseConfig.movement.linear.maxSpeed} m/s</span>
              </div>
              <div>
                <span style={{ color: "#888" }}>Acceleration:</span>
                <span style={{ color: "#fff", marginLeft: "8px" }}>{baseConfig.movement.linear.acceleration} m/s²</span>
              </div>
              <div>
                <span style={{ color: "#888" }}>Deceleration:</span>
                <span style={{ color: "#fff", marginLeft: "8px" }}>{baseConfig.movement.linear.deceleration} m/s²</span>
              </div>
              <div>
                <span style={{ color: "#888" }}>Pre-Brake Decel:</span>
                <span style={{ color: "#fff", marginLeft: "8px" }}>{baseConfig.movement.linear.preBrakeDeceleration} m/s²</span>
              </div>
            </div>
          </Section>

          <Section title="Movement - Curve" color="#9b59b6">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
              <div>
                <span style={{ color: "#888" }}>Max Speed:</span>
                <span style={{ color: "#fff", marginLeft: "8px" }}>{baseConfig.movement.curve.maxSpeed} m/s</span>
              </div>
              <div>
                <span style={{ color: "#888" }}>Acceleration:</span>
                <span style={{ color: "#fff", marginLeft: "8px" }}>{baseConfig.movement.curve.acceleration} m/s²</span>
              </div>
            </div>
          </Section>
        </div>

        {/* Fab Overrides */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ color: "#f39c12", margin: 0, fontSize: "14px" }}>
              Fab Overrides
              {overriddenFabIndices.length > 0 && (
                <span style={{ color: "#888", marginLeft: "8px", fontSize: "12px" }}>
                  ({overriddenFabIndices.length} fab{overriddenFabIndices.length > 1 ? "s" : ""})
                </span>
              )}
            </h3>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {availableFabIndices.length > 0 && (
                <>
                  <select
                    value={selectedFabToAdd}
                    onChange={(e) => setSelectedFabToAdd(Number(e.target.value))}
                    style={{
                      padding: "4px 8px",
                      background: "#333",
                      color: "#fff",
                      border: "1px solid #555",
                      borderRadius: "4px",
                      fontSize: "12px",
                    }}
                  >
                    {availableFabIndices.map(idx => (
                      <option key={idx} value={idx}>Fab {idx}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddFabOverride}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "4px 12px",
                      background: "#27ae60",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    <Plus size={14} />
                    Add Override
                  </button>
                </>
              )}
              {overriddenFabIndices.length > 0 && (
                <button
                  onClick={clearAllOverrides}
                  style={{
                    padding: "4px 12px",
                    background: "#c0392b",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {overriddenFabIndices.length === 0 ? (
            <div style={{ color: "#888", fontSize: "12px", textAlign: "center", padding: "20px" }}>
              No fab overrides configured. Add an override to customize parameters for specific fabs.
            </div>
          ) : (
            overriddenFabIndices.map(fabIndex => (
              <FabOverrideEditor
                key={fabIndex}
                fabIndex={fabIndex}
                onRemove={() => handleRemoveFabOverride(fabIndex)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #30363d" }}>
          <button
            onClick={() => setModalOpen(false)}
            style={{
              padding: "8px 24px",
              background: "#4ecdc4",
              color: "#000",
              border: "none",
              borderRadius: "6px",
              fontSize: "14px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SimulationParamsModal;
