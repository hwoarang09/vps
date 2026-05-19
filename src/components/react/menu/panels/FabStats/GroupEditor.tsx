// FabStats/GroupEditor.tsx — 데이터 드리븐 파라미터 테이블 + 그룹 생성
// 새 파라미터 추가 = PARAM_COLUMNS 배열에 한 줄 추가. fab간 값이 동일한 컬럼은 자동 숨김.
import React, { useMemo, useState } from "react";
import { useFabConfigStore, type FabConfigOverride } from "@/store/simulation/fabConfigStore";
import { useFabStatsUIStore, type FabGroup } from "./store";
import type { FabStats } from "../FabStatsPanel";

// ─── 파라미터 컬럼 정의 (여기만 수정하면 테이블에 반영) ───

interface ParamColumn {
  key: string;
  label: string;
  /** fab의 effective 값 추출. store 전체를 받아서 자유롭게 계산 */
  getValue: (fabIndex: number, ctx: ParamContext) => string | number;
}

interface ParamContext {
  routingConfig: ReturnType<typeof useFabConfigStore.getState>["routingConfig"];
  baseConfig: ReturnType<typeof useFabConfigStore.getState>["baseConfig"];
  transferEnabled: boolean;
  transferRateConfig: ReturnType<typeof useFabConfigStore.getState>["transferRateConfig"];
  transferModeConfig: ReturnType<typeof useFabConfigStore.getState>["transferModeConfig"];
  vehInit: ReturnType<typeof useFabConfigStore.getState>["vehInit"];
  fabOverrides: Record<number, FabConfigOverride>;
  fabStats: FabStats[];
}

const PARAM_COLUMNS: ParamColumn[] = [
  // Routing
  { key: "strategy",  label: "Strategy",   getValue: (fi, c) => c.fabOverrides[fi]?.routing?.strategy ?? c.routingConfig.strategy },
  { key: "bprAlpha",  label: "BPR α",      getValue: (fi, c) => c.fabOverrides[fi]?.routing?.bprAlpha ?? c.routingConfig.bprAlpha },
  { key: "bprBeta",   label: "BPR β",      getValue: (fi, c) => c.fabOverrides[fi]?.routing?.bprBeta ?? c.routingConfig.bprBeta },
  { key: "bprGamma",  label: "BPR γ",      getValue: (fi, c) => c.fabOverrides[fi]?.routing?.bprGamma ?? c.routingConfig.bprGamma },
  { key: "ewmaAlpha", label: "EWMA α",     getValue: (fi, c) => c.fabOverrides[fi]?.routing?.ewmaAlpha ?? c.routingConfig.ewmaAlpha },
  { key: "reroute",   label: "Reroute",    getValue: (fi, c) => c.fabOverrides[fi]?.routing?.rerouteInterval ?? c.routingConfig.rerouteInterval },

  // Transfer
  { key: "txEnabled",  label: "Transfer",  getValue: (fi, c) => (c.fabOverrides[fi]?.transferEnabled ?? c.transferEnabled) ? "ON" : "OFF" },
  { key: "txMode",     label: "Idle",      getValue: (fi, c) => (c.fabOverrides[fi]?.transferMode?.idlePolicy ?? c.transferModeConfig.idlePolicy) },
  { key: "txUtilPct",  label: "Util%",     getValue: (fi, c) => c.fabOverrides[fi]?.transferRateConfig?.utilizationPercent ?? c.transferRateConfig.utilizationPercent },

  // Movement
  { key: "linSpeed",   label: "MaxSpd",    getValue: (fi, c) => c.fabOverrides[fi]?.movement?.linear?.maxSpeed ?? c.baseConfig.movement.linear.maxSpeed },
  { key: "linAcc",     label: "Accel",     getValue: (fi, c) => c.fabOverrides[fi]?.movement?.linear?.acceleration ?? c.baseConfig.movement.linear.acceleration },
  { key: "curveSpd",   label: "CurveSpd",  getValue: (fi, c) => c.fabOverrides[fi]?.movement?.curve?.maxSpeed ?? c.baseConfig.movement.curve.maxSpeed },

  // Lock
  { key: "lockGrant",  label: "Lock",      getValue: (fi, c) => c.fabOverrides[fi]?.lock?.grantStrategy ?? c.baseConfig.lock.grantStrategy },

  // Vehicle count (실제 배치된 수)
  { key: "vehCount",   label: "Veh",       getValue: (fi, c) => c.fabStats[fi]?.vehicleCount ?? 0 },
];

// ─── Component ───

export const GroupEditor: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const routingConfig = useFabConfigStore((s) => s.routingConfig);
  const baseConfig = useFabConfigStore((s) => s.baseConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);
  const transferEnabled = useFabConfigStore((s) => s.transferEnabled);
  const transferRateConfig = useFabConfigStore((s) => s.transferRateConfig);
  const transferModeConfig = useFabConfigStore((s) => s.transferModeConfig);
  const vehInit = useFabConfigStore((s) => s.vehInit);
  const { fabGroups, addFabGroup, removeFabGroup } = useFabStatsUIStore();

  const [sortCol, setSortCol] = useState("fab");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupName, setGroupName] = useState("");

  const ctx: ParamContext = useMemo(() => ({
    routingConfig, baseConfig, fabOverrides, transferEnabled,
    transferRateConfig, transferModeConfig, vehInit, fabStats: fabStatsList,
  }), [routingConfig, baseConfig, fabOverrides, transferEnabled, transferRateConfig, transferModeConfig, vehInit, fabStatsList]);

  // group lookup
  const groupMap = useMemo(() => {
    const m = new Map<number, FabGroup>();
    for (const g of fabGroups) for (const fi of g.fabIndices) m.set(fi, g);
    return m;
  }, [fabGroups]);

  // Build row data: fabIndex + each param value
  const rows = useMemo(() => {
    return fabStatsList.map((_, fabIndex) => {
      const values: Record<string, string | number> = {};
      for (const col of PARAM_COLUMNS) {
        values[col.key] = col.getValue(fabIndex, ctx);
      }
      return { fabIndex, values };
    });
  }, [fabStatsList, ctx]);

  // Auto-detect columns with variation (값이 다른 컬럼만 표시)
  const visibleCols = useMemo(() => {
    if (rows.length <= 1) return PARAM_COLUMNS;
    return PARAM_COLUMNS.filter((col) => {
      const first = rows[0]?.values[col.key];
      return rows.some((r) => r.values[col.key] !== first);
    });
  }, [rows]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...rows];
    const dir = sortAsc ? 1 : -1;
    arr.sort((a, b) => {
      if (sortCol === "fab") return (a.fabIndex - b.fabIndex) * dir;
      const va = a.values[sortCol];
      const vb = b.values[sortCol];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return arr;
  }, [rows, sortCol, sortAsc]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortAsc((v) => !v);
    else { setSortCol(col); setSortAsc(true); }
  };

  const toggleSelect = (fabIndex: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fabIndex)) next.delete(fabIndex); else next.add(fabIndex);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map((r) => r.fabIndex)));
  };

  const handleCreateGroup = () => {
    if (selected.size === 0 || !groupName.trim()) return;
    addFabGroup(groupName.trim(), [...selected]);
    setSelected(new Set());
    setGroupName("");
  };

  const thClass = "px-1.5 py-1 text-left cursor-pointer hover:text-accent-cyan select-none whitespace-nowrap";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto vps-scrollbar">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-gray-900 text-gray-400 border-b border-gray-700">
            <tr>
              <th className="px-1.5 py-1 w-6">
                <input type="checkbox" checked={selected.size === sorted.length && sorted.length > 0}
                  onChange={selectAll} className="accent-accent-cyan" />
              </th>
              <th className={thClass} onClick={() => handleSort("fab")}>
                Fab{sortCol === "fab" && <span className="ml-0.5">{sortAsc ? "▲" : "▼"}</span>}
              </th>
              {visibleCols.map((col) => (
                <th key={col.key} className={thClass} onClick={() => handleSort(col.key)}>
                  {col.label}
                  {sortCol === col.key && <span className="ml-0.5">{sortAsc ? "▲" : "▼"}</span>}
                </th>
              ))}
              <th className="px-1.5 py-1 text-left">Grp</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isChecked = selected.has(row.fabIndex);
              const g = groupMap.get(row.fabIndex);
              return (
                <tr
                  key={row.fabIndex}
                  onClick={() => toggleSelect(row.fabIndex)}
                  className={`cursor-pointer border-b border-gray-800/50 transition-colors ${
                    isChecked ? "bg-accent-cyan/10" : "hover:bg-gray-800/40"
                  }`}
                >
                  <td className="px-1.5 py-0.5 text-center">
                    <input type="checkbox" checked={isChecked} readOnly className="accent-accent-cyan pointer-events-none" />
                  </td>
                  <td className="px-1.5 py-0.5 font-mono text-gray-200">{row.fabIndex}</td>
                  {visibleCols.map((col) => (
                    <td key={col.key} className="px-1.5 py-0.5 font-mono text-gray-300">
                      {row.values[col.key]}
                    </td>
                  ))}
                  <td className="px-1.5 py-0.5">
                    {g && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create group bar */}
      <div className="shrink-0 p-2 border-t border-gray-700/50 flex items-center gap-2">
        <span className="text-[10px] text-gray-500">{selected.size}개 선택</span>
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
          placeholder="그룹 이름"
          className="flex-1 px-2 py-1 rounded text-[11px] bg-panel-bg-solid text-white border border-panel-border focus:border-accent-cyan focus:outline-none"
        />
        <button
          onClick={handleCreateGroup}
          disabled={selected.size === 0 || !groupName.trim()}
          className="px-2 py-1 rounded text-[11px] font-bold bg-accent-cyan text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent-cyan/80"
        >
          + 그룹 생성
        </button>
      </div>

      {/* Existing groups */}
      {fabGroups.length > 0 && (
        <div className="shrink-0 p-2 border-t border-gray-700/50 space-y-1 max-h-32 overflow-auto vps-scrollbar">
          {fabGroups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 text-[11px]">
              <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
              <span className="text-white font-medium truncate flex-1">{g.name}</span>
              <span className="text-gray-500">{g.fabIndices.length}개</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeFabGroup(g.id); }}
                className="text-gray-600 hover:text-red-400 text-[13px] leading-none"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
