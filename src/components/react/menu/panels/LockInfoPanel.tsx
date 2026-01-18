import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { getLockMgr, type MergeLockNode } from "@/common/vehicle/logic/LockMgr";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";
import type { LockNodeData } from "@/shmSimulator/types";

type SimMode = "array" | "shm" | "none";

const LockInfoPanel: React.FC = () => {
  const [nodeName, setNodeName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [allNodes, setAllNodes] = useState<string[]>([]);
  const [selectedFab, setSelectedFab] = useState<string>("");
  const [strategy, setStrategy] = useState<string>("");
  const [isLive, setIsLive] = useState(false);
  const [isNodeListOpen, setIsNodeListOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Array 모드용
  const [arrayNodeInfo, setArrayNodeInfo] = useState<MergeLockNode | null>(null);

  // SHM 모드용
  const [shmNodeInfo, setShmNodeInfo] = useState<LockNodeData | null>(null);

  // Store 접근
  const shmController = useShmSimulatorStore((s) => s.controller);
  const shmFabIds = useShmSimulatorStore((s) => s.getFabIds);
  const shmIsInitialized = useShmSimulatorStore((s) => s.isInitialized);
  const getLockTableData = useShmSimulatorStore((s) => s.getLockTableData);

  const arrayNumVehicles = useVehicleArrayStore((s) => s.actualNumVehicles);

  // 모드 감지
  const detectMode = useCallback((): SimMode => {
    if (shmIsInitialized && shmController) return "shm";
    if (arrayNumVehicles > 0) return "array";
    return "none";
  }, [shmIsInitialized, shmController, arrayNumVehicles]);

  const [mode, setMode] = useState<SimMode>("none");

  // Fab 목록
  const [fabList, setFabList] = useState<string[]>([]);

  // 모드 감지 및 fab 목록 갱신
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

  // 노드 목록 갱신
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

  // 초기 노드 목록 로드
  useEffect(() => {
    refreshNodeList();
  }, [refreshNodeList]);

  // 주기적 갱신
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

  // 노드 정보 렌더링 (array/shm 공통화)
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
        <div className="border border-gray-200 rounded p-3 bg-gray-50">
          <h4 className="font-medium mb-2 text-gray-800">Node: {nodeInfo.name}</h4>
          <div className="text-sm text-gray-600">Strategy: {strategy}</div>
        </div>

        <div className="border border-gray-200 rounded p-3">
          <h4 className="font-medium mb-2 text-green-700">
            Granted ({granted.length})
          </h4>
          {granted.length === 0 ? (
            <div className="text-sm text-gray-500">No vehicles have lock</div>
          ) : (
            <div className="space-y-1">
              {granted.map((g, idx) => (
                <div
                  key={idx}
                  className="flex justify-between text-sm bg-green-50 p-2 rounded"
                >
                  <span className="font-mono">Vehicle {g.veh}</span>
                  <span className="text-gray-600">from {g.edge}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border border-gray-200 rounded p-3">
          <h4 className="font-medium mb-2 text-orange-700">
            Requests ({requests.length})
          </h4>
          {requests.length === 0 ? (
            <div className="text-sm text-gray-500">No pending requests</div>
          ) : (
            <div className="space-y-1">
              {requests.map((r, idx) => (
                <div
                  key={idx}
                  className="flex justify-between text-sm bg-orange-50 p-2 rounded"
                >
                  <span className="font-mono">Vehicle {r.vehId}</span>
                  <span className="text-gray-600">from {r.edgeName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border border-gray-200 rounded p-3">
          <h4 className="font-medium mb-2 text-blue-700">Edge Queues</h4>
          {edgeQueueEntries.length === 0 ? (
            <div className="text-sm text-gray-500">No edge queues</div>
          ) : (
            <div className="space-y-1">
              {edgeQueueEntries.map(([edgeName, size]) => (
                <div
                  key={edgeName}
                  className="flex justify-between text-sm bg-blue-50 p-2 rounded"
                >
                  <span className="font-mono">{edgeName}</span>
                  <span className="text-gray-600">{size} waiting</span>
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
      <div className="text-sm text-gray-500 p-4">
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
            className="w-24 px-2 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
          <div
            className="flex items-center border border-gray-300 rounded focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500"
          >
            <Search size={12} className="ml-1.5 text-gray-400 shrink-0" />
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
              className="flex-1 min-w-0 px-1 py-1.5 text-sm focus:outline-none bg-transparent"
            />
            <button
              onClick={() => setIsNodeListOpen(!isNodeListOpen)}
              className="px-1 py-1.5 text-gray-500 hover:text-gray-700 shrink-0"
            >
              <ChevronDown size={12} className={`transition-transform ${isNodeListOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
          {isNodeListOpen && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg">
              <div className="p-1 text-xs text-gray-500 border-b">
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
                      className={`w-full text-left text-sm px-3 py-2 hover:bg-gray-100 ${
                        name === nodeName ? "bg-blue-100 text-blue-700" : ""
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
        <div className="text-sm text-gray-500">
          Node &quot;{nodeName}&quot; not found or is not a merge node
        </div>
      )}

      {renderNodeInfo()}
    </div>
  );
};

export default LockInfoPanel;
