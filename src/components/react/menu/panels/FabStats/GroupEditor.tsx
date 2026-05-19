// FabStats/GroupEditor.tsx — 테이블에서 fab 파라미터 보고 그룹 생성
import React, { useMemo, useState } from "react";
import { useFabConfigStore, type RoutingStrategy } from "@/store/simulation/fabConfigStore";
import { useFabStatsUIStore, type FabGroup } from "./store";
import type { FabStats } from "../FabStatsPanel";

type SortCol = "fab" | "strategy" | "alpha" | "beta" | "gamma" | "reroute";

interface FabRow {
  fabIndex: number;
  fabId: string;
  strategy: RoutingStrategy | string;
  alpha: number;
  beta: number;
  gamma: number;
  reroute: number;
  ewmaAlpha: number;
  groupId: string | null;
  groupColor: string | null;
}

export const GroupEditor: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const globalRouting = useFabConfigStore((s) => s.routingConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);
  const { fabGroups, addFabGroup, removeFabGroup } = useFabStatsUIStore();

  const [sortCol, setSortCol] = useState<SortCol>("fab");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupName, setGroupName] = useState("");

  // Build rows
  const rows: FabRow[] = useMemo(() => {
    // group lookup: fabIndex → group
    const groupMap = new Map<number, FabGroup>();
    for (const g of fabGroups) {
      for (const fi of g.fabIndices) groupMap.set(fi, g);
    }

    return fabStatsList.map((fab, fabIndex) => {
      const ovr = fabOverrides[fabIndex]?.routing;
      const g = groupMap.get(fabIndex);
      return {
        fabIndex,
        fabId: fab.fabId,
        strategy: ovr?.strategy ?? globalRouting.strategy,
        alpha: ovr?.bprAlpha ?? globalRouting.bprAlpha,
        beta: ovr?.bprBeta ?? globalRouting.bprBeta,
        gamma: ovr?.bprGamma ?? globalRouting.bprGamma,
        reroute: ovr?.rerouteInterval ?? globalRouting.rerouteInterval,
        ewmaAlpha: ovr?.ewmaAlpha ?? globalRouting.ewmaAlpha,
        groupId: g?.id ?? null,
        groupColor: g?.color ?? null,
      };
    });
  }, [fabStatsList, fabOverrides, globalRouting, fabGroups]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...rows];
    const dir = sortAsc ? 1 : -1;
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "fab": cmp = a.fabIndex - b.fabIndex; break;
        case "strategy": cmp = a.strategy.localeCompare(b.strategy); break;
        case "alpha": cmp = a.alpha - b.alpha; break;
        case "beta": cmp = a.beta - b.beta; break;
        case "gamma": cmp = a.gamma - b.gamma; break;
        case "reroute": cmp = a.reroute - b.reroute; break;
      }
      return cmp * dir;
    });
    return arr;
  }, [rows, sortCol, sortAsc]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc((v) => !v);
    else { setSortCol(col); setSortAsc(true); }
  };

  const toggleSelect = (fabIndex: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fabIndex)) next.delete(fabIndex);
      else next.add(fabIndex);
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

  const colHeader = (label: string, col: SortCol) => (
    <th
      onClick={() => handleSort(col)}
      className="px-1.5 py-1 text-left cursor-pointer hover:text-accent-cyan select-none whitespace-nowrap"
    >
      {label}
      {sortCol === col && <span className="ml-0.5">{sortAsc ? "▲" : "▼"}</span>}
    </th>
  );

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
              {colHeader("Fab", "fab")}
              {colHeader("Strategy", "strategy")}
              {colHeader("α", "alpha")}
              {colHeader("β", "beta")}
              {colHeader("γ", "gamma")}
              {colHeader("rr", "reroute")}
              <th className="px-1.5 py-1 text-left">Group</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isChecked = selected.has(row.fabIndex);
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
                  <td className="px-1.5 py-0.5">
                    <span className={`font-bold ${
                      row.strategy === "BPR" ? "text-amber-400" :
                      row.strategy === "EWMA" ? "text-green-400" : "text-blue-400"
                    }`}>{row.strategy}</span>
                  </td>
                  <td className="px-1.5 py-0.5 font-mono text-gray-300">
                    {row.strategy === "BPR" ? row.alpha : "-"}
                  </td>
                  <td className="px-1.5 py-0.5 font-mono text-gray-300">
                    {row.strategy === "BPR" ? row.beta : "-"}
                  </td>
                  <td className="px-1.5 py-0.5 font-mono text-gray-300">
                    {row.strategy === "BPR" ? row.gamma : "-"}
                  </td>
                  <td className="px-1.5 py-0.5 font-mono text-gray-300">{row.reroute}</td>
                  <td className="px-1.5 py-0.5">
                    {row.groupColor && (
                      <span className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ backgroundColor: row.groupColor }} />
                    )}
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
                onClick={() => removeFabGroup(g.id)}
                className="text-gray-600 hover:text-red-400 text-[13px] leading-none"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
