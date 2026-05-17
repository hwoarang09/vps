import React, { useState, useEffect, useMemo } from "react";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { useFabStore } from "@/store/map/fabStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { panelCardVariants, panelTextVariants } from "../../shared/panelStyles";

/** 차량 대수 분배 + 초기 배치 시드 설정 패널 */
const VehParamsPanel: React.FC = () => {
  const { vehInit, setVehInit, setPerFabCounts } = useFabConfigStore();
  const { fabs, fabCountX, fabCountY } = useFabStore();
  const targetTotal = useVehicleTestStore((s) => s.numVehicles);

  const fabCount = fabs.length;
  const hasFabs = fabCount > 0;
  const equalShare = hasFabs ? Math.floor(targetTotal / fabCount) : targetTotal;

  // 일괄 설정 대상 fab 선택
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkValue, setBulkValue] = useState(equalShare);

  // fab 그리드가 만들어지면 perFabCounts 의 빈 항목을 균등값으로 초기화
  useEffect(() => {
    if (!hasFabs) return;
    const counts = vehInit.perFabCounts;
    const missing = fabs.filter((f) => counts[f.fabIndex] === undefined);
    if (missing.length === 0) return;
    const patch: Record<number, number> = {};
    for (const f of missing) patch[f.fabIndex] = equalShare;
    setPerFabCounts(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFabs, fabCount]);

  const customTotal = useMemo(
    () => fabs.reduce((s, f) => s + (vehInit.perFabCounts[f.fabIndex] ?? 0), 0),
    [fabs, vehInit.perFabCounts],
  );

  // (row,col) -> fab 조회
  const fabByPos = useMemo(() => {
    const m = new Map<string, (typeof fabs)[number]>();
    for (const f of fabs) m.set(`${f.row}-${f.col}`, f);
    return m;
  }, [fabs]);

  const toggleFab = (fabIndex: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fabIndex)) next.delete(fabIndex);
      else next.add(fabIndex);
      return next;
    });
  };

  const toggleGroup = (indices: number[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = indices.every((i) => next.has(i));
      for (const i of indices) {
        if (allSelected) next.delete(i);
        else next.add(i);
      }
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(fabs.map((f) => f.fabIndex)));
  const clearSelection = () => setSelected(new Set());

  /** 선택된 fab 들을 주어진 값으로 일괄 설정 */
  const applyToSelected = (value: number) => {
    if (selected.size === 0) return;
    const v = Math.max(0, Math.round(value));
    const patch: Record<number, number> = {};
    for (const idx of selected) patch[idx] = v;
    setPerFabCounts(patch);
  };

  /** 현재 비율을 유지한 채 총합을 목표값에 맞춤 */
  const scaleToTarget = () => {
    if (customTotal <= 0 || !hasFabs) return;
    const ratio = targetTotal / customTotal;
    const patch: Record<number, number> = {};
    let acc = 0;
    for (const f of fabs) {
      const v = Math.max(0, Math.round((vehInit.perFabCounts[f.fabIndex] ?? 0) * ratio));
      patch[f.fabIndex] = v;
      acc += v;
    }
    patch[fabs[0].fabIndex] += targetTotal - acc; // 반올림 나머지 보정
    setPerFabCounts(patch);
  };

  /** 모든 fab 을 균등 분배로 리셋 */
  const resetToEqual = () => {
    if (!hasFabs) return;
    const patch: Record<number, number> = {};
    let acc = 0;
    for (const f of fabs) {
      patch[f.fabIndex] = equalShare;
      acc += equalShare;
    }
    patch[fabs[0].fabIndex] += targetTotal - acc;
    setPerFabCounts(patch);
  };

  const isCustom = vehInit.mode === "custom";

  return (
    <div className="space-y-3">
      {/* ─── Vehicle Count ─── */}
      <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
        <div className={panelTextVariants({ variant: "muted", size: "xs" })}>
          VEHICLE COUNT
        </div>

        {/* 모드 토글 */}
        <div className="flex gap-1 mt-2">
          {(["equal", "custom"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setVehInit({ mode: m })}
              disabled={m === "custom" && !hasFabs}
              className={`flex-1 px-2 py-1.5 text-xs font-bold border rounded transition-all ${
                vehInit.mode === m
                  ? "bg-accent-cyan/20 border-accent-cyan text-accent-cyan"
                  : "bg-panel-bg-solid text-gray-500 border-panel-border hover:text-gray-300"
              } ${m === "custom" && !hasFabs ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {m === "equal" ? "Equal" : "Custom"}
            </button>
          ))}
        </div>

        {/* Equal 모드 안내 */}
        {!isCustom && (
          <div className="mt-2 text-[10px] text-gray-500 space-y-1">
            <div>
              전역 대수(상단 바) ÷ fab수로 균등 분배
            </div>
            {hasFabs && (
              <div className="font-mono text-gray-400">
                {targetTotal} ÷ {fabCount} fabs = fab당 {equalShare}대
              </div>
            )}
          </div>
        )}

        {/* Custom 모드 */}
        {isCustom && hasFabs && (
          <div className="mt-2 space-y-2">
            {/* 총합 */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500">총합</span>
              <span
                className={`font-mono font-bold ${
                  customTotal === targetTotal ? "text-accent-green" : "text-accent-orange"
                }`}
              >
                {customTotal} / {targetTotal}
              </span>
            </div>

            {/* fab 그리드 */}
            <div className="overflow-x-auto">
              <div
                className="grid gap-0.5"
                style={{ gridTemplateColumns: `auto repeat(${fabCountX}, minmax(34px, 1fr))` }}
              >
                {/* 좌상단 코너 (전체 선택) */}
                <button
                  onClick={selectAll}
                  title="전체 선택"
                  className="text-[9px] text-gray-600 hover:text-accent-cyan px-1"
                >
                  ◰
                </button>
                {/* 열 헤더 */}
                {Array.from({ length: fabCountX }, (_, c) => (
                  <button
                    key={`col-${c}`}
                    onClick={() =>
                      toggleGroup(
                        Array.from({ length: fabCountY }, (_, r) => fabByPos.get(`${r}-${c}`))
                          .filter((f): f is NonNullable<typeof f> => !!f)
                          .map((f) => f.fabIndex),
                      )
                    }
                    className="text-[9px] text-gray-600 hover:text-accent-cyan py-0.5"
                  >
                    C{c}
                  </button>
                ))}

                {/* 행들 — Three.js 와 동일하게 높은 R 이 위로 오도록 역순 렌더 */}
                {Array.from({ length: fabCountY }, (_, i) => {
                  const r = fabCountY - 1 - i;
                  return (
                  <React.Fragment key={`row-${r}`}>
                    {/* 행 헤더 */}
                    <button
                      onClick={() =>
                        toggleGroup(
                          Array.from({ length: fabCountX }, (_, c) => fabByPos.get(`${r}-${c}`))
                            .filter((f): f is NonNullable<typeof f> => !!f)
                            .map((f) => f.fabIndex),
                        )
                      }
                      className="text-[9px] text-gray-600 hover:text-accent-cyan px-1"
                    >
                      R{r}
                    </button>
                    {/* 셀들 */}
                    {Array.from({ length: fabCountX }, (_, c) => {
                      const fab = fabByPos.get(`${r}-${c}`);
                      if (!fab) return <div key={`cell-${r}-${c}`} />;
                      const count = vehInit.perFabCounts[fab.fabIndex] ?? 0;
                      const isSel = selected.has(fab.fabIndex);
                      return (
                        <button
                          key={`cell-${r}-${c}`}
                          onClick={() => toggleFab(fab.fabIndex)}
                          className={`flex flex-col items-center py-1 rounded border transition-all ${
                            isSel
                              ? "bg-accent-cyan/20 border-accent-cyan"
                              : "bg-panel-bg-solid border-panel-border hover:border-gray-500"
                          }`}
                        >
                          <span className="text-[8px] text-gray-600 leading-none">
                            F{fab.fabIndex}
                          </span>
                          <span
                            className={`text-[11px] font-mono font-bold leading-tight ${
                              isSel ? "text-accent-cyan" : "text-gray-300"
                            }`}
                          >
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* 선택 상태 + 선택 해제 */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">
                {selected.size} fabs 선택됨
              </span>
              <button
                onClick={clearSelection}
                disabled={selected.size === 0}
                className="text-[10px] font-bold px-2 py-1 rounded border border-accent-cyan/50 text-accent-cyan hover:bg-accent-cyan/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                선택 해제
              </button>
            </div>

            {/* 일괄 값 slider + 입력 */}
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={Math.max(200, equalShare * 3)}
                value={bulkValue}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setBulkValue(v);
                  applyToSelected(v);
                }}
                disabled={selected.size === 0}
                className="flex-1 accent-accent-cyan disabled:opacity-40"
              />
              <input
                type="number"
                value={bulkValue}
                min={0}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0);
                  setBulkValue(v);
                  applyToSelected(v);
                }}
                disabled={selected.size === 0}
                className="w-[56px] px-2 py-1 rounded text-xs font-mono bg-panel-bg-solid text-white border border-accent-cyan/50 disabled:opacity-40"
              />
            </div>
            {selected.size === 0 && (
              <div className="text-[10px] text-gray-600">
                fab 칸 / 행·열 헤더를 눌러 선택하면 일괄 설정됩니다.
              </div>
            )}

            {/* 액션 */}
            <div className="flex gap-1">
              <button
                onClick={scaleToTarget}
                className="flex-1 px-2 py-1.5 text-[11px] font-bold rounded border border-accent-cyan/50 text-accent-cyan hover:bg-accent-cyan/10 transition-all"
                title="현재 비율을 유지하며 총합을 목표값에 맞춤"
              >
                Scale to {targetTotal}
              </button>
              <button
                onClick={resetToEqual}
                className="flex-1 px-2 py-1.5 text-[11px] font-bold rounded border border-panel-border text-gray-400 hover:text-gray-200 transition-all"
                title="모든 fab 을 균등 분배로 리셋"
              >
                Reset Equal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Placement Seed ─── */}
      <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
        <div className={panelTextVariants({ variant: "muted", size: "xs" })}>
          PLACEMENT SEED
        </div>

        <div className="flex gap-1 mt-2">
          {(["random", "fixed"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setVehInit({ seedMode: m })}
              className={`flex-1 px-2 py-1.5 text-xs font-bold border rounded transition-all ${
                vehInit.seedMode === m
                  ? "bg-accent-cyan/20 border-accent-cyan text-accent-cyan"
                  : "bg-panel-bg-solid text-gray-500 border-panel-border hover:text-gray-300"
              }`}
            >
              {m === "random" ? "Random" : "Fixed"}
            </button>
          ))}
        </div>

        {vehInit.seedMode === "fixed" && (
          <div className="flex items-center gap-2 mt-2">
            <label className="text-xs text-gray-400 shrink-0">Seed</label>
            <input
              type="number"
              value={vehInit.seed}
              onChange={(e) => setVehInit({ seed: Number(e.target.value) || 0 })}
              className="w-[100px] px-2 py-1 rounded text-xs font-mono bg-panel-bg-solid text-white border border-accent-cyan/50"
            />
          </div>
        )}

        <div className="mt-2 text-[10px] text-gray-500">
          {vehInit.seedMode === "random"
            ? "매번 다른 초기 분포 (재현 불가)"
            : "고정 시드 — 같은 값이면 항상 같은 분포"}
        </div>
      </div>

      {/* 적용 시점 안내 */}
      <div className="text-[10px] text-gray-600">
        변경값은 다음 차량 Create 시 적용됩니다.
      </div>
    </div>
  );
};

export default VehParamsPanel;
