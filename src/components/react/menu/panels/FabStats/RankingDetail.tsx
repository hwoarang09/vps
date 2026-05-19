import React, { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { useFabStatsUIStore, type DetailTabKey } from "./store";
import type { FabStats } from "../FabStatsPanel";
import { useOrderStatsStore } from "@/store/simulation/orderStatsStore";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { panelCardVariants } from "../../shared/panelStyles";
import { SpeedGauge } from "./FabDetailCard";
import { SpeedHistogram } from "./charts/SpeedHistogram";
import { TimingHistogram } from "./charts/TimingHistogram";
import { OrderLifecycleBar } from "./OrderLifecycleBar";
import { ParametersTab } from "./ParametersTab";
import { VEHICLE_JOB_STATE_COLORS, MOVEMENT_STATUS_COLORS } from "@/config/colors";

import { fabRoutingText } from "./routingLabel";

const DETAIL_TABS: { key: DetailTabKey; label: string }[] = [
  { key: "distribution", label: "Distribution" },
  { key: "parameters", label: "Parameters" },
];

// ============================================================================
// Throughput card (좌상단)
// ============================================================================

const ThroughputCard: React.FC<{ fabId: string }> = ({ fabId }) => {
  const stats = useOrderStatsStore((s) => s.fabStats[fabId]);

  return (
    <div className={panelCardVariants({ variant: "default", padding: "sm" })}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Throughput</span>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Completed</span>
      </div>
      {stats && stats.completed > 0 ? (
        <div className="flex items-baseline gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-green-300 leading-none tabular-nums">
              {stats.throughputPerHour.toFixed(0)}
            </span>
            <span className="text-[11px] text-gray-400">/hr</span>
          </div>
          <div className="flex items-baseline gap-1 ml-auto">
            <span className="text-3xl font-bold text-accent-cyan leading-none tabular-nums">
              {stats.completed.toLocaleString()}
            </span>
          </div>
        </div>
      ) : (
        <span className="text-xs text-gray-500">—</span>
      )}
    </div>
  );
};

// ============================================================================
// Job State Bar — 차량 상태 분포 (가로 stacked bar 한 줄)
// 우측에 sensor 정지 (movement=stopped) 차량 별도 표시
// ============================================================================

const JobStateBar: React.FC<{ fab: FabStats }> = ({ fab }) => {
  const total = fab.vehicleCount;
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[10px] text-gray-600 italic">
        No vehicles
      </div>
    );
  }

  const stopped = fab.stoppedCount;
  const stoppedPct = (stopped / total) * 100;

  const segments = [
    { count: fab.jobIdle, color: "#6b7280", label: "Idle" },
    { count: fab.jobMoveToLoad, color: VEHICLE_JOB_STATE_COLORS.MOVE_TO_LOAD, label: "→Load" },
    { count: fab.jobLoading, color: VEHICLE_JOB_STATE_COLORS.LOADING, label: "Loading" },
    { count: fab.jobMoveToUnload, color: VEHICLE_JOB_STATE_COLORS.MOVE_TO_UNLOAD, label: "→Drop" },
    { count: fab.jobUnloading, color: VEHICLE_JOB_STATE_COLORS.UNLOADING, label: "Unloading" },
  ];

  return (
    <div className="flex flex-col gap-1 h-full">
      <div className="flex items-baseline justify-between text-[10px] shrink-0">
        <span className="text-gray-400 uppercase tracking-wider font-semibold">Job State</span>
        <span style={{ color: MOVEMENT_STATUS_COLORS.stopped }}>
          stopped <span className="tabular-nums font-bold">{stopped}</span>
          <span className="text-gray-500 ml-0.5">({stoppedPct.toFixed(0)}%)</span>
        </span>
      </div>
      <div className="flex h-3 rounded overflow-hidden bg-panel-bg-solid shrink-0">
        {segments.map((s, i) => {
          const pct = (s.count / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={i}
              title={`${s.label}: ${s.count} (${pct.toFixed(0)}%)`}
              className="h-full"
              style={{ width: `${pct}%`, background: s.color }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] mt-0.5">
        {segments.map((s, i) => {
          if (s.count === 0) return null;
          return (
            <span key={i} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-gray-400">{s.label}</span>
              <span className="tabular-nums text-gray-300">{s.count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// Speed card (좌하단) — Gauge + (Histogram + JobStateBar 위아래 절반)
// ============================================================================

const SpeedCard: React.FC<{ fab: FabStats; nominalMax: number }> = ({ fab, nominalMax }) => {
  return (
    <div className={panelCardVariants({ variant: "default", padding: "sm" }) + " flex flex-col flex-1 min-h-0"}>
      <div className="shrink-0 mb-1">
        <SpeedGauge avg={fab.avgSpeed} max={fab.maxSpeed} nominalMax={nominalMax} />
      </div>
      <div className="flex-1 min-h-0 grid grid-rows-2 gap-1.5 border-t border-gray-700/50 pt-1.5">
        <div className="min-h-0">
          <SpeedHistogram fab={fab} />
        </div>
        <div className="min-h-0 border-t border-gray-700/50 pt-1.5">
          <JobStateBar fab={fab} />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Distribution Tab — lifecycle bar + 좌측 KPI + 우측 timing histogram
// ============================================================================

const DistributionTab: React.FC<{ fab: FabStats; fabIndex: number }> = ({ fab }) => {
  const baseLinearMaxSpeed = useFabConfigStore((s) => s.baseConfig.movement.linear.maxSpeed);

  return (
    <div className="h-full flex flex-col gap-2 overflow-auto vps-scrollbar">
      <OrderLifecycleBar fabId={fab.fabId} />

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_2fr] gap-2">
        {/* 좌측: Throughput + Speed (gauge + histogram) — 콘텐츠 위에서 쌓이고 아래는 빈 영역 */}
        <div className="flex flex-col gap-2 min-h-0">
          <ThroughputCard fabId={fab.fabId} />
          <SpeedCard fab={fab} nominalMax={baseLinearMaxSpeed} />
        </div>

        {/* 우측: Timing histogram (Lead/Waiting/Delivery — lifecycle bar 클릭으로 전환) */}
        <div className={panelCardVariants({ variant: "default", padding: "sm" }) + " min-h-0"}>
          <TimingHistogram fabId={fab.fabId} />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Group Member Table — TanStack Table (a, b, c 개별 컬럼 + 성능 지표, 정렬 가능)
// ============================================================================

interface MemberRow {
  fabIndex: number;
  strategy: string;
  alpha: number;
  beta: number;
  gamma: number;
  ewmaAlpha: number;
  reroute: number;
  veh: number;
  throughput: number;
  avgSpeed: number;
  movingPct: number;
}

const memberColHelper = createColumnHelper<MemberRow>();

const MEMBER_COLUMNS = [
  memberColHelper.accessor("fabIndex", { header: "Fab", size: 40 }),
  memberColHelper.accessor("strategy", { header: "Str", size: 50 }),
  memberColHelper.accessor("alpha", { header: "α", size: 40 }),
  memberColHelper.accessor("beta", { header: "β", size: 40 }),
  memberColHelper.accessor("gamma", { header: "γ", size: 40 }),
  memberColHelper.accessor("ewmaAlpha", { header: "Eα", size: 40 }),
  memberColHelper.accessor("reroute", { header: "rr", size: 35 }),
  memberColHelper.accessor("veh", { header: "Veh", size: 40 }),
  memberColHelper.accessor("throughput", {
    header: "Thru/hr",
    cell: (info) => <span className="text-accent-green">{info.getValue().toFixed(0)}</span>,
    size: 60,
  }),
  memberColHelper.accessor("avgSpeed", {
    header: "Spd",
    cell: (info) => info.getValue().toFixed(2),
    size: 50,
  }),
  memberColHelper.accessor("movingPct", {
    header: "Mov%",
    cell: (info) => `${info.getValue().toFixed(0)}%`,
    size: 45,
  }),
];

const GroupMemberTable: React.FC<{
  members: { fab: FabStats; fabIndex: number }[];
  orderStatsMap: ReturnType<typeof useOrderStatsStore.getState>["fabStats"];
  globalRouting: ReturnType<typeof useFabConfigStore.getState>["routingConfig"];
  fabOverrides: ReturnType<typeof useFabConfigStore.getState>["fabOverrides"];
}> = ({ members, orderStatsMap, globalRouting, fabOverrides }) => {
  const [sorting, setSorting] = useState<SortingState>([]);

  const data: MemberRow[] = useMemo(() =>
    members.map((m) => {
      const ovr = fabOverrides[m.fabIndex]?.routing;
      const os = orderStatsMap[m.fab.fabId];
      return {
        fabIndex: m.fabIndex,
        strategy: (ovr?.strategy ?? globalRouting.strategy) as string,
        alpha: ovr?.bprAlpha ?? globalRouting.bprAlpha,
        beta: ovr?.bprBeta ?? globalRouting.bprBeta,
        gamma: ovr?.bprGamma ?? globalRouting.bprGamma,
        ewmaAlpha: ovr?.ewmaAlpha ?? globalRouting.ewmaAlpha,
        reroute: ovr?.rerouteInterval ?? globalRouting.rerouteInterval,
        veh: m.fab.vehicleCount,
        throughput: os?.throughputPerHour ?? 0,
        avgSpeed: m.fab.avgSpeed,
        movingPct: m.fab.vehicleCount > 0 ? (m.fab.movingCount / m.fab.vehicleCount) * 100 : 0,
      };
    }),
  [members, orderStatsMap, globalRouting, fabOverrides]);

  // Auto-hide uniform columns
  const visibleColumns = useMemo(() => {
    if (data.length <= 1) return MEMBER_COLUMNS;
    return MEMBER_COLUMNS.filter((col) => {
      const id = (col as { accessorKey?: string }).accessorKey;
      if (!id) return true;
      // Always show: fabIndex + performance metrics
      if (["fabIndex", "veh", "throughput", "avgSpeed", "movingPct"].includes(id)) return true;
      const first = data[0]?.[id as keyof MemberRow];
      return data.some((r) => r[id as keyof MemberRow] !== first);
    });
  }, [data]);

  const table = useReactTable({
    data,
    columns: visibleColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="flex-1 min-h-0 overflow-auto vps-scrollbar">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-gray-900 text-gray-400 border-b border-gray-700">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                  className="px-1.5 py-1 text-left cursor-pointer hover:text-accent-cyan select-none whitespace-nowrap font-mono"
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
            <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-800/40">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-1.5 py-0.5 font-mono text-gray-300">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============================================================================
// Group Detail — 그룹 선택 시 집계 KPI + 멤버 리스트
// ============================================================================

const GroupDetail: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const selectedGroupId = useFabStatsUIStore((s) => s.selectedGroupId);
  const fabGroups = useFabStatsUIStore((s) => s.fabGroups);
  const orderStatsMap = useOrderStatsStore((s) => s.fabStats);
  const globalRouting = useFabConfigStore((s) => s.routingConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);

  const group = fabGroups.find((g) => g.id === selectedGroupId);
  if (!group) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-gray-500">
        Select a group from the list.
      </div>
    );
  }

  const members = group.fabIndices
    .filter((fi) => fi < fabStatsList.length)
    .map((fi) => ({ fab: fabStatsList[fi], fabIndex: fi }))
    .filter((m) => m.fab.vehicleCount > 0);

  const n = members.length || 1;
  const totalVeh = members.reduce((s, m) => s + m.fab.vehicleCount, 0);
  const avgSpeed = members.reduce((s, m) => s + m.fab.avgSpeed, 0) / n;
  const avgThroughput = members.reduce((s, m) => s + (orderStatsMap[m.fab.fabId]?.throughputPerHour ?? 0), 0) / n;
  const avgCompleted = members.reduce((s, m) => s + (orderStatsMap[m.fab.fabId]?.completed ?? 0), 0) / n;
  const avgMovingRate = totalVeh > 0
    ? (members.reduce((s, m) => s + m.fab.movingCount, 0) / totalVeh) * 100 : 0;

  return (
    <div className="h-full min-h-0 flex flex-col p-2 gap-2 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-1 pb-1 border-b border-gray-700/50">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
        <span className="text-base font-bold text-white">{group.name}</span>
        <span className="text-[10px] text-gray-500 ml-auto">{members.length} fabs / {totalVeh} veh</span>
      </div>

      {/* KPI grid */}
      <div className="shrink-0 grid grid-cols-4 gap-2">
        {[
          { label: "Throughput", value: `${avgThroughput.toFixed(0)}/hr`, sub: "fab 평균" },
          { label: "Completed", value: avgCompleted.toFixed(0), sub: "fab 평균" },
          { label: "Avg Speed", value: `${avgSpeed.toFixed(2)} m/s`, sub: "fab 평균" },
          { label: "Moving %", value: `${avgMovingRate.toFixed(0)}%`, sub: "fab 평균" },
        ].map((kpi) => (
          <div key={kpi.label} className={panelCardVariants({ variant: "default", padding: "sm" })}>
            <div className="text-[9px] text-gray-500 uppercase">{kpi.label}</div>
            <div className="text-lg font-bold text-accent-green tabular-nums leading-tight">{kpi.value}</div>
            <div className="text-[9px] text-gray-600">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Member table — TanStack Table */}
      <GroupMemberTable members={members} orderStatsMap={orderStatsMap} globalRouting={globalRouting} fabOverrides={fabOverrides} />
    </div>
  );
};

// ============================================================================
// Main: RankingDetail — viewMode에 따라 개별/그룹 분기
// ============================================================================

export const RankingDetail: React.FC<{ fabStatsList: FabStats[] }> = ({ fabStatsList }) => {
  const viewMode = useFabStatsUIStore((s) => s.viewMode);
  const selectedFabId = useFabStatsUIStore((s) => s.selectedFabId);
  const detailTab = useFabStatsUIStore((s) => s.detailTab);
  const setDetailTab = useFabStatsUIStore((s) => s.setDetailTab);

  const globalRouting = useFabConfigStore((s) => s.routingConfig);
  const fabOverrides = useFabConfigStore((s) => s.fabOverrides);

  // Group mode
  if (viewMode === "group") {
    return <GroupDetail fabStatsList={fabStatsList} />;
  }

  // Individual mode
  const selected = (() => {
    if (!selectedFabId) return null;
    const idx = fabStatsList.findIndex((f) => f.fabId === selectedFabId);
    if (idx < 0) return null;
    return { fab: fabStatsList[idx], fabIndex: idx };
  })();

  if (!selected) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-gray-500">
        Select a fab from the list.
      </div>
    );
  }

  const { fab, fabIndex } = selected;
  const ovr = fabOverrides[fabIndex];
  const strategyText = fabRoutingText(globalRouting, ovr?.routing);

  return (
    <div className="h-full min-h-0 flex flex-col p-2 gap-2 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-baseline gap-2 px-1 pb-1 border-b border-gray-700/50">
        <span className="text-base font-bold text-accent-orange">{fab.fabId}</span>
        <span className="text-xs font-semibold text-purple-300 truncate">{strategyText}</span>
        <span className="text-[10px] text-gray-500 ml-auto shrink-0">{fab.vehicleCount} vehicles</span>
      </div>

      {/* Detail 내부 탭 */}
      <div className="shrink-0 flex border-b border-gray-700/50 px-1">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setDetailTab(t.key)}
            className={`px-3 py-1 text-[11px] font-medium border-b-2 transition-colors ${
              detailTab === t.key
                ? "border-accent-cyan text-accent-cyan"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {detailTab === "distribution" && <DistributionTab fab={fab} fabIndex={fabIndex} />}
        {detailTab === "parameters" && <ParametersTab fabIndex={fabIndex} />}
      </div>
    </div>
  );
};
