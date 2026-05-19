// FabStats/GroupEditor.tsx — TanStack Table 기반 파라미터 테이블 + 그룹 생성
// 새 파라미터 추가 = PARAM_COLUMNS 배열에 한 줄 추가. fab간 값이 동일한 컬럼은 자동 숨김.
import React, { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { useFabConfigStore, type FabConfigOverride } from "@/store/simulation/fabConfigStore";
import { useFabStatsUIStore, type FabGroup } from "./store";
import type { FabStats } from "../FabStatsPanel";

// ─── 파라미터 컬럼 정의 (여기만 수정하면 테이블에 반영) ───

interface ParamDef {
  key: string;
  label: string;
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

const PARAM_COLUMNS: ParamDef[] = [
  { key: "strategy",  label: "Strategy",   getValue: (fi, c) => c.fabOverrides[fi]?.routing?.strategy ?? c.routingConfig.strategy },
  { key: "bprAlpha",  label: "BPR α",      getValue: (fi, c) => c.fabOverrides[fi]?.routing?.bprAlpha ?? c.routingConfig.bprAlpha },
  { key: "bprBeta",   label: "BPR β",      getValue: (fi, c) => c.fabOverrides[fi]?.routing?.bprBeta ?? c.routingConfig.bprBeta },
  { key: "bprGamma",  label: "BPR γ",      getValue: (fi, c) => c.fabOverrides[fi]?.routing?.bprGamma ?? c.routingConfig.bprGamma },
  { key: "ewmaAlpha", label: "EWMA α",     getValue: (fi, c) => c.fabOverrides[fi]?.routing?.ewmaAlpha ?? c.routingConfig.ewmaAlpha },
  { key: "reroute",   label: "Reroute",    getValue: (fi, c) => c.fabOverrides[fi]?.routing?.rerouteInterval ?? c.routingConfig.rerouteInterval },
  { key: "txEnabled", label: "Transfer",   getValue: (fi, c) => (c.fabOverrides[fi]?.transferEnabled ?? c.transferEnabled) ? "ON" : "OFF" },
  { key: "txMode",    label: "Idle",       getValue: (fi, c) => (c.fabOverrides[fi]?.transferMode?.idlePolicy ?? c.transferModeConfig.idlePolicy) },
  { key: "txUtilPct", label: "Util%",      getValue: (fi, c) => c.fabOverrides[fi]?.transferRateConfig?.utilizationPercent ?? c.transferRateConfig.utilizationPercent },
  { key: "linSpeed",  label: "MaxSpd",     getValue: (fi, c) => c.fabOverrides[fi]?.movement?.linear?.maxSpeed ?? c.baseConfig.movement.linear.maxSpeed },
  { key: "linAcc",    label: "Accel",      getValue: (fi, c) => c.fabOverrides[fi]?.movement?.linear?.acceleration ?? c.baseConfig.movement.linear.acceleration },
  { key: "curveSpd",  label: "CurveSpd",   getValue: (fi, c) => c.fabOverrides[fi]?.movement?.curve?.maxSpeed ?? c.baseConfig.movement.curve.maxSpeed },
  { key: "lockGrant", label: "Lock",       getValue: (fi, c) => c.fabOverrides[fi]?.lock?.grantStrategy ?? c.baseConfig.lock.grantStrategy },
  { key: "vehCount",  label: "Veh",        getValue: (fi, c) => c.fabStats[fi]?.vehicleCount ?? 0 },
];

// ─── Row type ───

interface FabRow {
  fabIndex: number;
  [key: string]: string | number;
}

// ─── Component ───

const columnHelper = createColumnHelper<FabRow>();

export const GroupEditor: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const routingConfig = useFabConfigStore((s) => s.routingConfig);
  const baseConfig = useFabConfigStore((s) => s.baseConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);
  const transferEnabled = useFabConfigStore((s) => s.transferEnabled);
  const transferRateConfig = useFabConfigStore((s) => s.transferRateConfig);
  const transferModeConfig = useFabConfigStore((s) => s.transferModeConfig);
  const vehInit = useFabConfigStore((s) => s.vehInit);
  const { fabGroups, addFabGroup, removeFabGroup } = useFabStatsUIStore();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [groupName, setGroupName] = useState("");

  const ctx: ParamContext = useMemo(() => ({
    routingConfig, baseConfig, fabOverrides, transferEnabled,
    transferRateConfig, transferModeConfig, vehInit, fabStats: fabStatsList,
  }), [routingConfig, baseConfig, fabOverrides, transferEnabled, transferRateConfig, transferModeConfig, vehInit, fabStatsList]);

  // Group lookup
  const groupMap = useMemo(() => {
    const m = new Map<number, FabGroup>();
    for (const g of fabGroups) for (const fi of g.fabIndices) m.set(fi, g);
    return m;
  }, [fabGroups]);

  // Build row data
  const data: FabRow[] = useMemo(() => {
    return fabStatsList.map((_, fabIndex) => {
      const row: FabRow = { fabIndex };
      for (const col of PARAM_COLUMNS) {
        row[col.key] = col.getValue(fabIndex, ctx);
      }
      return row;
    });
  }, [fabStatsList, ctx]);

  // Auto-detect visible columns (값이 다른 것만)
  const visibleParams = useMemo(() => {
    if (data.length <= 1) return PARAM_COLUMNS;
    return PARAM_COLUMNS.filter((col) => {
      const first = data[0]?.[col.key];
      return data.some((r) => r[col.key] !== first);
    });
  }, [data]);

  // TanStack columns
  const columns = useMemo(() => [
    columnHelper.display({
      id: "select",
      header: ({ table }) => (
        <input type="checkbox"
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          className="accent-accent-cyan" />
      ),
      cell: ({ row }) => (
        <input type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          className="accent-accent-cyan" />
      ),
      size: 30,
    }),
    columnHelper.accessor("fabIndex", {
      header: "Fab",
      cell: (info) => <span className="font-mono text-gray-200">{info.getValue()}</span>,
      size: 40,
    }),
    ...visibleParams.map((p) =>
      columnHelper.accessor(p.key, {
        header: p.label,
        cell: (info) => <span className="font-mono text-gray-300">{info.getValue()}</span>,
        sortingFn: (a, b, colId) => {
          const va = a.getValue(colId);
          const vb = b.getValue(colId);
          if (typeof va === "number" && typeof vb === "number") return va - vb;
          return String(va).localeCompare(String(vb));
        },
      }),
    ),
    columnHelper.display({
      id: "group",
      header: "Grp",
      cell: ({ row }) => {
        const g = groupMap.get(row.original.fabIndex);
        return g ? <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} /> : null;
      },
      size: 35,
    }),
  ], [visibleParams, groupMap]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => String(row.fabIndex),
    enableRowSelection: true,
  });

  const selectedCount = Object.keys(rowSelection).filter((k) => rowSelection[k]).length;

  const handleCreateGroup = () => {
    if (selectedCount === 0 || !groupName.trim()) return;
    const fabIndices = Object.keys(rowSelection).filter((k) => rowSelection[k]).map(Number);
    addFabGroup(groupName.trim(), fabIndices);
    setRowSelection({});
    setGroupName("");
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto vps-scrollbar">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-gray-900 text-gray-400 border-b border-gray-700">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                    className="px-1.5 py-1 text-left cursor-pointer hover:text-accent-cyan select-none whitespace-nowrap"
                    style={{ width: header.getSize() }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: " ▲", desc: " ▼" }[header.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={row.getToggleSelectedHandler()}
                className={`cursor-pointer border-b border-gray-800/50 transition-colors ${
                  row.getIsSelected() ? "bg-accent-cyan/10" : "hover:bg-gray-800/40"
                }`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-1.5 py-0.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create group bar */}
      <div className="shrink-0 p-2 border-t border-gray-700/50 flex items-center gap-2">
        <span className="text-[10px] text-gray-500">{selectedCount}개 선택</span>
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
          disabled={selectedCount === 0 || !groupName.trim()}
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
