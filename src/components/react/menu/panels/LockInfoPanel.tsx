import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, ChevronDown } from "lucide-react";
import { getLockMgr, type MergeLockNode } from "@/common/vehicle/logic/LockMgr";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import type { LockNodeData } from "@/shmSimulator/types";
import {
  panelSelectVariants,
  panelCardVariants,
  panelTextVariants,
} from "../shared/panelStyles";
import { twMerge } from "tailwind-merge";

type SimMode = "array" | "shm" | "none";

const LockInfoPanel: React.FC = () => {
  const [nodeName, setNodeName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [allNodes, setAllNodes] = useState<string[]>([]);
  const [selectedFab, setSelectedFab] = useState<string>("");
  const [strategy, setStrategy] = useState<string>("");
  const [, setIsLive] = useState(false);
  const [isNodeListOpen, setIsNodeListOpen] = useState(false);
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

  useEffect(() => {
    if (!nodeName) {
      setArrayNodeInfo(null);
      setShmNodeInfo(null);
      setIsLive(false);
      return;
    }

    const updateNodeInfo = async () => {
      if (mode === "array") {
        const lockMgr = getLockMgr();
        const table = lockMgr.getTable();
        const node = table[nodeName];
        setArrayNodeInfo(node ?? null);
        setStrategy(lockMgr.getGrantStrategy());
      } else if (mode === "shm" && selectedFab) {
        const data = await getLockTableData(selectedFab);
        if (data) {
          setShmNodeInfo(data.nodes[nodeName] ?? null);
          setStrategy(data.strategy);
        }
      }
    };

    updateNodeInfo();
    setIsLive(true);
    intervalRef.current = setInterval(updateNodeInfo, 200);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        setIsLive(false);
      }
    };
  }, [nodeName, mode, selectedFab, getLockTableData]);

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
      {/* Fab + Node 선택 (가로 배치) */}
      <div className="flex gap-2">
        {/* Fab 선택 (SHM 모드) */}
        {mode === "shm" && fabList.length > 0 && (
          <select
            value={selectedFab}
            onChange={(e) => {
              setSelectedFab(e.target.value);
              setNodeName("");
              setSearchQuery("");
              setArrayNodeInfo(null);
              setShmNodeInfo(null);
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

        {/* 노드 선택 (검색 가능한 드롭다운) */}
        <div className="relative w-36">
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
              placeholder={nodeName || "Node..."}
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
      </div>

      {/* 노드 정보 */}
      {nodeName && !arrayNodeInfo && !shmNodeInfo && (
        <div className={panelTextVariants({ variant: "muted", size: "sm" })}>
          Node &quot;{nodeName}&quot; not found or is not a merge node
        </div>
      )}

      {renderNodeInfo()}
    </div>
  );
};

export default LockInfoPanel;
