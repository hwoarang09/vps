import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Search, ChevronDown, Circle, Car } from "lucide-react";
import { getLockMgr, type MergeLockNode } from "@/common/vehicle/logic/LockMgr";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import type { LockNodeData, LockTableData } from "@/shmSimulator/types";
import {
  panelSelectVariants,
  panelCardVariants,
  panelTextVariants,
} from "../shared/panelStyles";
import { twMerge } from "tailwind-merge";

type SimMode = "array" | "shm" | "none";
type SearchType = "node" | "vehicle";

// Vehicle의 Lock 정보
interface VehicleLockInfo {
  grantedNodes: { nodeName: string; edgeName: string }[];
  requestedNodes: { nodeName: string; edgeName: string; requestTime: number }[];
}

const LockInfoPanel: React.FC = () => {
  const [searchType, setSearchType] = useState<SearchType>("node");
  const [nodeName, setNodeName] = useState("");
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [allNodes, setAllNodes] = useState<string[]>([]);
  const [selectedFab, setSelectedFab] = useState<string>("");
  const [strategy, setStrategy] = useState<string>("");
  const [, setIsLive] = useState(false);
  const [isNodeListOpen, setIsNodeListOpen] = useState(false);
  const [lockTableData, setLockTableData] = useState<LockTableData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [arrayNodeInfo, setArrayNodeInfo] = useState<MergeLockNode | null>(null);
  const [shmNodeInfo, setShmNodeInfo] = useState<LockNodeData | null>(null);

  const shmController = useShmSimulatorStore((s) => s.controller);
  const shmFabIds = useShmSimulatorStore((s) => s.getFabIds);
  const shmIsInitialized = useShmSimulatorStore((s) => s.isInitialized);
  const getLockTableData = useShmSimulatorStore((s) => s.getLockTableData);

  const arrayNumVehicles = useVehicleArrayStore((s) => s.actualNumVehicles);

  const detectMode = useCallback((): SimMode => {
    if (shmIsInitialized && shmController) return "shm";
    if (arrayNumVehicles > 0) return "array";
    return "none";
  }, [shmIsInitialized, shmController, arrayNumVehicles]);

  const [mode, setMode] = useState<SimMode>("none");
  const [fabList, setFabList] = useState<string[]>([]);

  useEffect(() => {
    const currentMode = detectMode();
    setMode(currentMode);

    if (currentMode === "shm") {
      const fabs = shmFabIds();
      setFabList(fabs);
      if (fabs.length > 0 && !selectedFab) {
        setSelectedFab(fabs[0]);
      }
    } else if (currentMode === "array") {
      setFabList([]);
      setSelectedFab("");
    }
  }, [detectMode, shmFabIds, selectedFab]);

  const refreshNodeList = useCallback(async () => {
    if (mode === "array") {
      const lockMgr = getLockMgr();
      const table = lockMgr.getTable();
      setAllNodes(Object.keys(table));
      setStrategy(lockMgr.getGrantStrategy());
    } else if (mode === "shm" && selectedFab) {
      const data = await getLockTableData(selectedFab);
      if (data) {
        setAllNodes(Object.keys(data.nodes));
        setStrategy(data.strategy);
      }
    }
  }, [mode, selectedFab, getLockTableData]);

  useEffect(() => {
    refreshNodeList();
  }, [refreshNodeList]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Lock 테이블 데이터 주기적 업데이트 (Node/Vehicle 검색 모두 사용)
  useEffect(() => {
    const shouldUpdate = searchType === "node" ? !!nodeName : vehicleId !== null;
    if (!shouldUpdate) {
      setArrayNodeInfo(null);
      setShmNodeInfo(null);
      setLockTableData(null);
      setIsLive(false);
      return;
    }

    const updateLockData = async () => {
      if (mode === "array") {
        const lockMgr = getLockMgr();
        const table = lockMgr.getTable();
        setStrategy(lockMgr.getGrantStrategy());

        if (searchType === "node" && nodeName) {
          const node = table[nodeName];
          setArrayNodeInfo(node ?? null);
        }
        // Array 모드에서 Vehicle 검색용 테이블 데이터 변환
        if (searchType === "vehicle") {
          const nodes: Record<string, LockNodeData> = {};
          for (const [name, node] of Object.entries(table)) {
            nodes[name] = {
              name: node.name,
              requests: node.requests.map(r => ({ vehId: r.vehId, edgeName: r.edgeName, requestTime: r.requestTime })),
              granted: node.granted.map(g => ({ edge: g.edge, veh: g.veh })),
              edgeQueueSizes: Object.fromEntries(
                Object.entries(node.edgeQueues ?? {}).map(([k, q]) => [k, q.size])
              ),
            };
          }
          setLockTableData({ strategy: lockMgr.getGrantStrategy(), nodes });
        }
      } else if (mode === "shm" && selectedFab) {
        const data = await getLockTableData(selectedFab);
        if (data) {
          setStrategy(data.strategy);
          setLockTableData(data);
          if (searchType === "node" && nodeName) {
            setShmNodeInfo(data.nodes[nodeName] ?? null);
          }
        }
      }
    };

    updateLockData();
    setIsLive(true);
    intervalRef.current = setInterval(updateLockData, 200);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        setIsLive(false);
      }
    };
  }, [nodeName, vehicleId, searchType, mode, selectedFab, getLockTableData]);

  // Vehicle별 Lock 정보 추출
  const vehicleLockInfo = useMemo((): VehicleLockInfo | null => {
    if (searchType !== "vehicle" || vehicleId === null || !lockTableData) {
      return null;
    }

    const grantedNodes: VehicleLockInfo["grantedNodes"] = [];
    const requestedNodes: VehicleLockInfo["requestedNodes"] = [];

    for (const [nodeName, nodeData] of Object.entries(lockTableData.nodes)) {
      // granted 확인
      for (const g of nodeData.granted) {
        if (g.veh === vehicleId) {
          grantedNodes.push({ nodeName, edgeName: g.edge });
        }
      }
      // requests 확인
      for (const r of nodeData.requests) {
        if (r.vehId === vehicleId) {
          requestedNodes.push({ nodeName, edgeName: r.edgeName, requestTime: r.requestTime });
        }
      }
    }

    return { grantedNodes, requestedNodes };
  }, [searchType, vehicleId, lockTableData]);

  // 모든 Vehicle ID 목록 (Lock 테이블에서 추출)
  const allVehicleIds = useMemo((): number[] => {
    if (!lockTableData) return [];
    const ids = new Set<number>();
    for (const nodeData of Object.values(lockTableData.nodes)) {
      for (const g of nodeData.granted) {
        ids.add(g.veh);
      }
      for (const r of nodeData.requests) {
        ids.add(r.vehId);
      }
    }
    return Array.from(ids).sort((a, b) => a - b);
  }, [lockTableData]);

  // Vehicle Lock 정보 렌더링
  const renderVehicleLockInfo = () => {
    if (vehicleId === null) return null;

    if (!vehicleLockInfo) {
      return (
        <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
          Loading lock info...
        </div>
      );
    }

    const { grantedNodes, requestedNodes } = vehicleLockInfo;

    if (grantedNodes.length === 0 && requestedNodes.length === 0) {
      return (
        <div className={panelCardVariants({ variant: "default", padding: "md" })}>
          <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
            Vehicle {vehicleId} has no locks held or requested
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className={panelCardVariants({ variant: "default", padding: "md" })}>
          <h4 className="font-medium mb-2 text-accent-orange">Vehicle: {vehicleId}</h4>
          <div className="text-sm text-gray-400">Strategy: <span className="text-white">{strategy}</span></div>
        </div>

        <div className={panelCardVariants({ variant: "default", padding: "md" })}>
          <h4 className="font-medium mb-2 text-accent-green">
            Locks Held ({grantedNodes.length})
          </h4>
          {grantedNodes.length === 0 ? (
            <div className={panelTextVariants({ variant: "muted", size: "sm" })}>No locks held</div>
          ) : (
            <div className="space-y-1">
              {grantedNodes.map((g, idx) => (
                <div
                  key={idx}
                  className="flex justify-between text-sm bg-accent-green/10 p-2 rounded border border-accent-green/20"
                >
                  <span className="font-mono text-accent-green">{g.nodeName}</span>
                  <span className="text-gray-400">from {g.edgeName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={panelCardVariants({ variant: "default", padding: "md" })}>
          <h4 className="font-medium mb-2 text-accent-orange">
            Pending Requests ({requestedNodes.length})
          </h4>
          {requestedNodes.length === 0 ? (
            <div className={panelTextVariants({ variant: "muted", size: "sm" })}>No pending requests</div>
          ) : (
            <div className="space-y-1">
              {requestedNodes.map((r, idx) => (
                <div
                  key={idx}
                  className="flex justify-between text-sm bg-accent-orange/10 p-2 rounded border border-accent-orange/20"
                >
                  <span className="font-mono text-accent-orange">{r.nodeName}</span>
                  <span className="text-gray-400">from {r.edgeName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderNodeInfo = () => {
    const nodeInfo = mode === "array" ? arrayNodeInfo : shmNodeInfo;
    if (!nodeInfo) return null;

    const granted = mode === "array"
      ? (arrayNodeInfo?.granted ?? [])
      : (shmNodeInfo?.granted ?? []);

    const requests = mode === "array"
      ? (arrayNodeInfo?.requests ?? [])
      : (shmNodeInfo?.requests ?? []);

    const edgeQueueEntries = mode === "array"
      ? Object.entries(arrayNodeInfo?.edgeQueues ?? {}).map(([name, q]) => [name, q.size] as const)
      : Object.entries(shmNodeInfo?.edgeQueueSizes ?? {});

    return (
      <div className="space-y-4">
        <div className={panelCardVariants({ variant: "default", padding: "md" })}>
          <h4 className="font-medium mb-2 text-accent-orange">Node: {nodeInfo.name}</h4>
          <div className="text-sm text-gray-400">Strategy: <span className="text-white">{strategy}</span></div>
        </div>

        <div className={panelCardVariants({ variant: "default", padding: "md" })}>
          <h4 className="font-medium mb-2 text-accent-green">
            Granted ({granted.length})
          </h4>
          {granted.length === 0 ? (
            <div className={panelTextVariants({ variant: "muted", size: "sm" })}>No vehicles have lock</div>
          ) : (
            <div className="space-y-1">
              {granted.map((g, idx) => (
                <div
                  key={idx}
                  className="flex justify-between text-sm bg-accent-green/10 p-2 rounded border border-accent-green/20"
                >
                  <span className="font-mono text-accent-green">Vehicle {g.veh}</span>
                  <span className="text-gray-400">from {g.edge}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={panelCardVariants({ variant: "default", padding: "md" })}>
          <h4 className="font-medium mb-2 text-accent-orange">
            Requests ({requests.length})
          </h4>
          {requests.length === 0 ? (
            <div className={panelTextVariants({ variant: "muted", size: "sm" })}>No pending requests</div>
          ) : (
            <div className="space-y-1">
              {requests.map((r, idx) => (
                <div
                  key={idx}
                  className="flex justify-between text-sm bg-accent-orange/10 p-2 rounded border border-accent-orange/20"
                >
                  <span className="font-mono text-accent-orange">Vehicle {r.vehId}</span>
                  <span className="text-gray-400">from {r.edgeName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={panelCardVariants({ variant: "default", padding: "md" })}>
          <h4 className="font-medium mb-2 text-accent-cyan">Edge Queues</h4>
          {edgeQueueEntries.length === 0 ? (
            <div className={panelTextVariants({ variant: "muted", size: "sm" })}>No edge queues</div>
          ) : (
            <div className="space-y-1">
              {edgeQueueEntries.map(([edgeName, size]) => (
                <div
                  key={edgeName}
                  className="flex justify-between text-sm bg-accent-cyan/10 p-2 rounded border border-accent-cyan/20"
                >
                  <span className="font-mono text-accent-cyan">{edgeName}</span>
                  <span className="text-gray-400">{size} waiting</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (mode === "none") {
    return (
      <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
        No simulation running. Start a simulation first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 검색 타입 탭 (Node / Vehicle) */}
      <div className="flex gap-1 bg-panel-bg-solid border border-panel-border rounded p-1">
        <button
          onClick={() => {
            setSearchType("node");
            setVehicleId(null);
            setSearchQuery("");
          }}
          className={twMerge(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors",
            searchType === "node"
              ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30"
              : "text-gray-400 hover:text-gray-300 hover:bg-panel-border/30"
          )}
        >
          <Circle size={14} />
          Node
        </button>
        <button
          onClick={() => {
            setSearchType("vehicle");
            setNodeName("");
            setSearchQuery("");
            setArrayNodeInfo(null);
            setShmNodeInfo(null);
          }}
          className={twMerge(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors",
            searchType === "vehicle"
              ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30"
              : "text-gray-400 hover:text-gray-300 hover:bg-panel-border/30"
          )}
        >
          <Car size={14} />
          Vehicle
        </button>
      </div>

      {/* Fab 선택 + 검색 입력 */}
      <div className="flex gap-2">
        {/* Fab 선택 (SHM 모드) */}
        {mode === "shm" && fabList.length > 0 && (
          <select
            value={selectedFab}
            onChange={(e) => {
              setSelectedFab(e.target.value);
              setNodeName("");
              setVehicleId(null);
              setSearchQuery("");
              setArrayNodeInfo(null);
              setShmNodeInfo(null);
              setLockTableData(null);
            }}
            className={twMerge(panelSelectVariants({ accent: "cyan", size: "sm" }), "w-24")}
          >
            {fabList.map((fab) => (
              <option key={fab} value={fab}>
                {fab}
              </option>
            ))}
          </select>
        )}

        {/* Node 검색 (searchType === "node") */}
        {searchType === "node" && (
          <div className="relative flex-1">
            <div className="flex items-center border border-panel-border rounded bg-panel-bg-solid focus-within:ring-1 focus-within:ring-accent-cyan focus-within:border-accent-cyan">
              <Search size={12} className="ml-1.5 text-gray-500 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsNodeListOpen(true);
                }}
                onFocus={() => setIsNodeListOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsNodeListOpen(false);
                    inputRef.current?.blur();
                  }
                }}
                placeholder={nodeName || "Search node..."}
                className="flex-1 min-w-0 px-1 py-1.5 text-sm focus:outline-none bg-transparent text-white placeholder-gray-500"
              />
              <button
                onClick={() => setIsNodeListOpen(!isNodeListOpen)}
                className="px-1 py-1.5 text-gray-500 hover:text-gray-300 shrink-0"
              >
                <ChevronDown size={12} className={`transition-transform ${isNodeListOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
            {isNodeListOpen && (
              <div className="absolute z-10 w-full mt-1 bg-panel-bg-solid border border-panel-border rounded shadow-lg">
                <div className="p-1 text-xs text-gray-500 border-b border-panel-border">
                  {allNodes.length} nodes
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {allNodes
                    .filter((name) =>
                      name.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((name) => (
                      <button
                        key={name}
                        onClick={() => {
                          setNodeName(name);
                          setSearchQuery("");
                          setIsNodeListOpen(false);
                        }}
                        className={`w-full text-left text-sm px-3 py-2 hover:bg-accent-cyan/20 transition-colors ${
                          name === nodeName ? "bg-accent-cyan/30 text-accent-cyan" : "text-gray-300"
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  {allNodes.filter((name) =>
                    name.toLowerCase().includes(searchQuery.toLowerCase())
                  ).length === 0 && (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      No matching nodes
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vehicle 검색 (searchType === "vehicle") */}
        {searchType === "vehicle" && (
          <div className="relative flex-1">
            <div className="flex items-center border border-panel-border rounded bg-panel-bg-solid focus-within:ring-1 focus-within:ring-accent-cyan focus-within:border-accent-cyan">
              <Search size={12} className="ml-1.5 text-gray-500 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsNodeListOpen(true);
                }}
                onFocus={() => setIsNodeListOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsNodeListOpen(false);
                  } else if (e.key === "Enter") {
                    const num = parseInt(searchQuery, 10);
                    if (!isNaN(num)) {
                      setVehicleId(num);
                      setSearchQuery("");
                      setIsNodeListOpen(false);
                    }
                  }
                }}
                placeholder={vehicleId !== null ? `Vehicle ${vehicleId}` : "Search vehicle ID..."}
                className="flex-1 min-w-0 px-1 py-1.5 text-sm focus:outline-none bg-transparent text-white placeholder-gray-500"
              />
              <button
                onClick={() => setIsNodeListOpen(!isNodeListOpen)}
                className="px-1 py-1.5 text-gray-500 hover:text-gray-300 shrink-0"
              >
                <ChevronDown size={12} className={`transition-transform ${isNodeListOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
            {isNodeListOpen && (
              <div className="absolute z-10 w-full mt-1 bg-panel-bg-solid border border-panel-border rounded shadow-lg">
                <div className="p-1 text-xs text-gray-500 border-b border-panel-border">
                  {allVehicleIds.length} vehicles with locks
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {allVehicleIds
                    .filter((id) =>
                      searchQuery === "" || id.toString().includes(searchQuery)
                    )
                    .map((id) => (
                      <button
                        key={id}
                        onClick={() => {
                          setVehicleId(id);
                          setSearchQuery("");
                          setIsNodeListOpen(false);
                        }}
                        className={`w-full text-left text-sm px-3 py-2 hover:bg-accent-cyan/20 transition-colors ${
                          id === vehicleId ? "bg-accent-cyan/30 text-accent-cyan" : "text-gray-300"
                        }`}
                      >
                        Vehicle {id}
                      </button>
                    ))}
                  {allVehicleIds.filter((id) =>
                    searchQuery === "" || id.toString().includes(searchQuery)
                  ).length === 0 && (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      {searchQuery ? "No matching vehicles" : "No vehicles with locks"}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 노드 정보 (searchType === "node") */}
      {searchType === "node" && (
        <>
          {nodeName && !arrayNodeInfo && !shmNodeInfo && (
            <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
              Node &quot;{nodeName}&quot; not found or is not a merge node
            </div>
          )}
          {renderNodeInfo()}
        </>
      )}

      {/* Vehicle 정보 (searchType === "vehicle") */}
      {searchType === "vehicle" && renderVehicleLockInfo()}
    </div>
  );
};

export default LockInfoPanel;
