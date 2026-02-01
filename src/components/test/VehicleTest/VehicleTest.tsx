import React, { useEffect, useState, useRef } from "react";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { useVehicleArrayStore, TransferMode } from "@store/vehicle/arrayMode/vehicleStore";
import { useVehicleGeneralStore } from "@store/vehicle/vehicleGeneralStore";
import { useShmSimulatorStore } from "@store/vehicle/shmMode/shmSimulatorStore";
import { useCFGStore } from "@store/system/cfgStore";
import { useCameraStore } from "@store/ui/cameraStore";
import VehicleTestRunner from "./VehicleTestRunner";
import { VehicleSystemType } from "@/types/vehicle";
import { getTestSettings, getDefaultSetting } from "@/config/testSettingConfig";
import { Play, Pause, Settings } from "lucide-react";
import SimulationParamsModal from "./SimulationParamsModal";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { getLockMgr, resetLockMgr } from "@/common/vehicle/logic/LockMgr";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useStationStore } from "@/store/map/stationStore";
import { useTextStore } from "@/store/map/textStore";
import { getNodeBounds, createFabInfos } from "@/utils/fab/fabUtils";
import { useFabStore } from "@/store/map/fabStore";
import { getMaxVehicleCapacity } from "@/utils/vehicle/vehiclePlacement";
import { getStationTextConfig } from "@/config/stationConfig";
import LogFileManager from "./LogFileManager";
import DevLogFileManager from "./DevLogFileManager";
import { DevLogger } from "@/logger";
import { twMerge } from "tailwind-merge";
import {
  panelContainerVariants,
  panelSelectVariants,
  panelInputVariants,
  panelButtonVariants,
  panelLabelVariants,
  panelDividerClass,
  panelTextVariants,
} from "@/components/react/menu/shared/panelStyles";

/**
 * VehicleTest
 * - Router component for vehicle performance tests
 * - Routes to appropriate test based on selected submenu
 * - Allows test setting selection (map + vehicle count)
 * - Stops test when menu is changed or deactivated
 */

const VehicleTest: React.FC = () => {
  const { stopTest, isPaused, setPaused } = useVehicleTestStore();
  const edges = useEdgeStore((state) => state.edges);
  const { transferMode, setTransferMode } = useVehicleArrayStore();

  const { dispose: disposeShmSimulator } = useShmSimulatorStore();
  const { loadCFGFiles } = useCFGStore();
  const { setCameraView } = useCameraStore();

  const [selectedSettingId, setSelectedSettingId] = useState<string>(getDefaultSetting());
  const testSettings = getTestSettings();

  // Get selected test setting
  const selectedSetting = testSettings.find(s => s.id === selectedSettingId) || testSettings[0];
  const [inputValue, setInputValue] = useState<string>(selectedSetting.numVehicles.toString());
  const [customNumVehicles, setCustomNumVehicles] = useState<number>(selectedSetting.numVehicles);
  const [testKey, setTestKey] = useState<number>(0);
  const [isTestCreated, setIsTestCreated] = useState<boolean>(false);
  const [useVehicleConfig, setUseVehicleConfig] = useState<boolean>(false);
  const [fabCountX, setFabCountX] = useState<number>(2);
  const [fabCountY, setFabCountY] = useState<number>(1);
  const [isFabApplied, setIsFabApplied] = useState<boolean>(false);

  const { downloadLogs, isInitialized: isSimInitialized } = useShmSimulatorStore();

  // Calculate max vehicle capacity from edges (fab 개수 반영)
  const maxVehicleCapacity = React.useMemo(() => {
    if (edges.length === 0) return 0;
    const baseCapacity = getMaxVehicleCapacity(edges);
    if (isFabApplied) {
      return baseCapacity * fabCountX * fabCountY;
    }
    return baseCapacity;
  }, [edges, isFabApplied, fabCountX, fabCountY]);

  // Handle log download - directly from Logger Worker
  const handleDownloadLog = async () => {
    try {
      const result = await downloadLogs();

      if (!result) {
        alert("No active logger. Start simulation first.");
        return;
      }


      // Create blob and trigger download
      const blob = new Blob([result.buffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);

      alert(`Downloaded: ${result.fileName}\nRecords: ${result.recordCount}\nSize: ${(result.buffer.byteLength / 1024).toFixed(2)} KB`);
    } catch (error) {
      alert(`Failed to download log: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  useEffect(() => {
    setInputValue(selectedSetting.numVehicles.toString());
    setCustomNumVehicles(selectedSetting.numVehicles);
    if (selectedSetting.transferMode) {
      setTransferMode(selectedSetting.transferMode);
    }
  }, [selectedSettingId, selectedSetting.numVehicles, selectedSetting.transferMode]);

  // Ref to track pending setTimeout for vehicle creation
  const vehicleCreateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTestSetting = async (settingId: string, autoCreateVehicles = true) => {
    const setting = testSettings.find(s => s.id === settingId);
    if (!setting) return;

    // Cancel any pending vehicle creation timeout
    if (vehicleCreateTimeoutRef.current) {
      clearTimeout(vehicleCreateTimeoutRef.current);
      vehicleCreateTimeoutRef.current = null;
    }

    // Cleanup all simulators before loading new map
    resetLockMgr();
    disposeShmSimulator(); // Dispose SHM simulator
    useVehicleGeneralStore.getState().clearAll(); // Clear vehicle metadata
    setIsFabApplied(false); // Reset FAB state when loading new map
    if (isTestCreated) {
      stopTest();
      setIsTestCreated(false);
    }

    try {
      // Load the new map
      await loadCFGFiles(setting.mapName);

      // Initialize LockMgr
      const edges = useEdgeStore.getState().edges;
      getLockMgr().initFromEdges(edges);

      // Set camera position if configured
      if (setting.camera) {
        setCameraView(setting.camera.position, setting.camera.target);
      }

      // Auto-create vehicles only if requested
      if (autoCreateVehicles) {
        // Wait for map to render and edges renderingPoints to be calculated
        vehicleCreateTimeoutRef.current = setTimeout(() => {
          // Auto-create vehicles using vehicles.cfg
          setUseVehicleConfig(true); // Use vehicles.cfg
          setIsTestCreated(true);
          setTestKey(prev => prev + 1); // Force remount to create vehicles
          vehicleCreateTimeoutRef.current = null;
        }, 800);
      }
    } catch (error) {
    }
  };

  // Initialize DevLogger for main thread (enables veh-separated log files)
  useEffect(() => {
    DevLogger.init();
  }, []);

  // Initial load effect
  useEffect(() => {
    // Check if we should auto-load (only once on mount)
    loadTestSetting(selectedSettingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // SHM 모드로 고정
  const mode: VehicleSystemType = VehicleSystemType.SharedMemory;

  // Handle delete - remove all vehicles and stop test
  const handleDelete = () => {
    stopTest(); // Stop the test
    setIsTestCreated(false);

    // Reset LockMgr to clear previous locks/queues
    resetLockMgr();
    // Dispose SHM simulator
    disposeShmSimulator();
    // Clear vehicle metadata from store
    useVehicleGeneralStore.getState().clearAll();

    // Re-initialize LockMgr with current edges so it's ready for next create or manual use
    // Note: useEdgeStore.getState().edges should be valid here as map is loaded
    const edges = useEdgeStore.getState().edges;
    getLockMgr().initFromEdges(edges);

    setTestKey(prev => prev + 1); // Force remount to clear vehicles
  };

  // Handle create - create vehicles with current count (ignore vehicles.cfg)
  const handleCreate = () => {
    const numVehicles = Number.parseInt(inputValue) || 1;
    setCustomNumVehicles(numVehicles);
    setUseVehicleConfig(false); // Don't use vehicles.cfg
    setIsTestCreated(true);
    setTestKey(prev => prev + 1); // Force remount to create vehicles
  };

  // Handle FAB Create - clone nodes/edges/stations to create X * Y grid of fabs
  const handleFabCreate = () => {
    const nodes = useNodeStore.getState().nodes;
    const edges = useEdgeStore.getState().edges;
    const stations = useStationStore.getState().stations;

    if (nodes.length === 0 || edges.length === 0) {
      return;
    }

    // Stop existing test and dispose simulator before FAB creation
    if (isTestCreated) {
      stopTest();
      setIsTestCreated(false);
    }
    disposeShmSimulator();

    // 원본 데이터 저장 (멀티 워커용)
    useFabStore.getState().setOriginalMapData({
      nodes: [...nodes],
      edges: [...edges],
      stations: [...stations],
    });

    // Get bounds for offset calculation
    const bounds = getNodeBounds(nodes);

    // Create fab infos and save to fabStore
    const fabInfos = createFabInfos(fabCountX, fabCountY, bounds);
    useFabStore.getState().setFabGrid(fabCountX, fabCountY, fabInfos);

    // Initialize render slots (슬롯 기반 렌더링용)
    useFabStore.getState().initSlots();

    // Store에는 원본만 저장 (메모리 절약)
    // Worker는 sharedMapData로 원본을 받아서 자체적으로 fab별 offset 계산
    useNodeStore.getState().setNodes(nodes);
    useEdgeStore.getState().setEdges(edges);
    useStationStore.getState().setStations(stations);

    // Update text store with fab 0 data only
    updateTextsForFab(nodes, edges, stations);

    // Re-initialize LockMgr with original edges
    // 메인 스레드 LockMgr는 원본 기준, Worker는 각자 fab별 LockMgr 사용
    resetLockMgr();
    getLockMgr().initFromEdges(edges);

    // testSetting에서 fabSensorOverrides가 있으면 fabConfigStore에 적용
    if (selectedSetting.fabSensorOverrides) {
      const fabConfigStore = useFabConfigStore.getState();
      for (const [fabIndexStr, sensorOverride] of Object.entries(selectedSetting.fabSensorOverrides)) {
        const fabIndex = Number(fabIndexStr);
        const existing = fabConfigStore.fabOverrides[fabIndex] || {};
        fabConfigStore.setFabOverride(fabIndex, { ...existing, sensor: sensorOverride });
      }
    }

    setIsFabApplied(true);
  };

  // Update text store with fab 0 data only (다른 fab은 position offset으로 처리)
  const updateTextsForFab = (
    nodes: ReturnType<typeof useNodeStore.getState>["nodes"],
    edges: ReturnType<typeof useEdgeStore.getState>["edges"],
    stations: ReturnType<typeof useStationStore.getState>["stations"],
  ) => {
    const textStore = useTextStore.getState();
    const fabInfos = useFabStore.getState().fabs;
    textStore.clearAllTexts();

    const stationTextConfig = getStationTextConfig();

    // fab 0 bounds (fab 0 내의 데이터만 저장)
    const fab0 = fabInfos[0];
    const isInFab0 = (x: number, y: number): boolean => {
      if (!fab0) return true; // single fab이면 전부 포함
      return x >= fab0.xMin && x <= fab0.xMax && y >= fab0.yMin && y <= fab0.yMax;
    };

    // Node texts - fab 0만
    const nodeTexts: import("@/store/map/textStore").TextItem[] = [];
    const nodeMap = new Map(nodes.map(n => [n.node_name, n]));
    for (const node of nodes) {
      if (node.node_name.startsWith("TMP_")) continue;
      if (!isInFab0(node.editor_x, node.editor_y)) continue;
      nodeTexts.push({
        name: node.node_name,
        position: { x: node.editor_x, y: node.editor_y, z: node.editor_z },
      });
    }

    // Edge texts - fab 0만
    const edgeTexts: import("@/store/map/textStore").TextItem[] = [];
    for (const edge of edges) {
      if (edge.edge_name.startsWith("TMP_")) continue;
      const fromNode = nodeMap.get(edge.from_node);
      const toNode = nodeMap.get(edge.to_node);
      if (!fromNode || !toNode) continue;

      const midX = (fromNode.editor_x + toNode.editor_x) / 2;
      const midY = (fromNode.editor_y + toNode.editor_y) / 2;
      const midZ = (fromNode.editor_z + toNode.editor_z) / 2;
      if (!isInFab0(midX, midY)) continue;

      edgeTexts.push({
        name: edge.edge_name,
        position: { x: midX, y: midY, z: midZ },
      });
    }

    // Station texts - fab 0만
    const stationTexts: import("@/store/map/textStore").TextItem[] = [];
    for (const station of stations) {
      if (!isInFab0(station.position.x, station.position.y)) continue;
      stationTexts.push({
        name: station.station_name,
        position: {
          x: station.position.x,
          y: station.position.y,
          z: station.position.z + stationTextConfig.Z_OFFSET,
        },
      });
    }

    // Store에 저장
    textStore.setNodeTextsArray(nodeTexts);
    textStore.setEdgeTextsArray(edgeTexts);
    textStore.setStationTextsArray(stationTexts);
    textStore.forceUpdate();
  };

  // Handle FAB Clear - reload map to reset to original state (no auto vehicle creation)
  const handleFabClear = async () => {

    // 1. Stop test and cleanup vehicles first
    if (isTestCreated) {
      stopTest();
      setIsTestCreated(false);
    }
    disposeShmSimulator();
    useVehicleGeneralStore.getState().clearAll();

    // 2. Reset FAB state
    setIsFabApplied(false);
    useFabStore.getState().clearFabs();

    // 3. Wait for renderers to unmount before loading new map
    await new Promise(resolve => setTimeout(resolve, 100));

    // 4. Reload map only (no auto vehicle creation)
    await loadTestSetting(selectedSettingId, false);
  };



  // Handle test setting change - load map, set camera, and create vehicles from vehicles.cfg
  const handleSettingChange = async (newSettingId: string) => {
    setSelectedSettingId(newSettingId);
    await loadTestSetting(newSettingId);
  };

  return (
    <>
      {/* Test Setting Selector */}
      <div
        className={twMerge(
          panelContainerVariants({ position: "top", padding: "sm" }),
          "flex items-center gap-4 font-mono text-xs"
        )}
      >
        {/* Test Setting */}
        <label className={panelLabelVariants({ color: "white", size: "sm" })}>
          TEST SETTING:
        </label>
        <select
          value={selectedSettingId}
          onChange={(e) => handleSettingChange(e.target.value)}
          className={panelSelectVariants({ accent: "cyan", size: "sm" })}
        >
          {testSettings.map((setting) => (
            <option key={setting.id} value={setting.id}>
              {setting.name} ({setting.mapName})
            </option>
          ))}
        </select>

        {/* Transfer Mode Selector */}
        <select
          value={transferMode}
          onChange={(e) => setTransferMode(e.target.value as TransferMode)}
          className={panelSelectVariants({ accent: "purple", size: "sm" })}
        >
          <option value={TransferMode.LOOP}>LOOP</option>
          <option value={TransferMode.RANDOM}>RANDOM</option>
          <option value={TransferMode.MQTT_CONTROL}>MQTT</option>
          <option value={TransferMode.AUTO_ROUTE}>AUTO_ROUTE</option>
        </select>

        {/* Vehicles */}
        <div className="flex items-center gap-2">
          <label className={panelLabelVariants({ color: "white", size: "sm" })}>
            VEHICLES:
          </label>
          <input
            type="number"
            min="1"
            max="10000"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className={twMerge(
              panelInputVariants({ size: "sm", width: "fixed" }),
              "text-center"
            )}
          />
          <span className={panelTextVariants({ variant: "muted", size: "xs" })}>
            / {maxVehicleCapacity || "---"}
          </span>
        </div>

        <button
          onClick={handleCreate}
          className={panelButtonVariants({ variant: "success", size: "md" })}
        >
          Create
        </button>

        <button
          onClick={handleDelete}
          className={panelButtonVariants({ variant: "danger", size: "md" })}
        >
          Delete
        </button>

        {/* FAB Controls */}
        <div className="flex items-center gap-2 ml-4 pl-4 border-l border-gray-600">
          <label className={panelLabelVariants({ color: "orange", size: "sm" })}>
            FAB:
          </label>
          <input
            type="number"
            min="1"
            max="100"
            value={fabCountX}
            onChange={(e) => setFabCountX(Math.max(1, Math.min(100, Number.parseInt(e.target.value) || 1)))}
            disabled={isFabApplied}
            className={twMerge(
              panelInputVariants({ size: "sm" }),
              "w-[50px] text-center border-accent-yellow",
              isFabApplied && "opacity-50 cursor-not-allowed"
            )}
            title="가로 개수"
          />
          <span className="text-accent-yellow font-bold">×</span>
          <input
            type="number"
            min="1"
            max="100"
            value={fabCountY}
            onChange={(e) => setFabCountY(Math.max(1, Math.min(100, Number.parseInt(e.target.value) || 1)))}
            disabled={isFabApplied}
            className={twMerge(
              panelInputVariants({ size: "sm" }),
              "w-[50px] text-center border-accent-yellow",
              isFabApplied && "opacity-50 cursor-not-allowed"
            )}
            title="세로 개수"
          />
          <span className={panelTextVariants({ variant: "muted", size: "xs" })}>
            ={fabCountX * fabCountY}
          </span>
          <button
            onClick={handleFabCreate}
            disabled={isFabApplied}
            className={panelButtonVariants({
              variant: isFabApplied ? "ghost" : "warning",
              size: "md",
              disabled: isFabApplied,
            })}
          >
            Create
          </button>
          <button
            onClick={handleFabClear}
            disabled={!isFabApplied}
            className={panelButtonVariants({
              variant: isFabApplied ? "warning" : "ghost",
              size: "md",
              disabled: !isFabApplied,
            })}
          >
            Clear
          </button>
          <button
            onClick={() => useFabConfigStore.getState().setModalOpen(true)}
            className={panelButtonVariants({ variant: "purple", size: "md" })}
            title="Configure simulation parameters per fab"
          >
            <Settings size={14} />
            Params
          </button>
        </div>

        {/* Play/Pause buttons */}
        <div className="flex gap-1 ml-2">
          <button
            onClick={() => setPaused(false)}
            disabled={!isPaused}
            className={twMerge(
              panelButtonVariants({
                variant: isPaused ? "success" : "ghost",
                size: "md",
                disabled: !isPaused,
              }),
              isPaused && "border-2 border-accent-green"
            )}
            title="Play simulation"
          >
            <Play size={14} />
            Play
          </button>

          <button
            onClick={() => setPaused(true)}
            disabled={isPaused}
            className={twMerge(
              panelButtonVariants({
                variant: !isPaused ? "warning" : "ghost",
                size: "md",
                disabled: isPaused,
              }),
              !isPaused && "border-2 border-accent-yellow"
            )}
            title="Pause simulation"
          >
            <Pause size={14} />
            Pause
          </button>
        </div>

        {/* Log Download Section */}
        <div className="flex items-center gap-2 ml-4 pl-4 border-l border-gray-600">
          <button
            onClick={handleDownloadLog}
            disabled={!isSimInitialized}
            className={twMerge(
              panelButtonVariants({
                variant: isSimInitialized ? "primary" : "ghost",
                size: "sm",
                disabled: !isSimInitialized,
              }),
              isSimInitialized && "border-2 border-accent-cyan/50"
            )}
            title={isSimInitialized ? "Download current session log" : "Start simulation first"}
          >
            📥 Latest
          </button>
          <LogFileManager />
          <DevLogFileManager />
        </div>
      </div>

      {/* Test Runner */}
      {isTestCreated && (
        <VehicleTestRunner
          key={testKey}
          mode={mode}
          mapName={selectedSetting.mapName}
          numVehicles={customNumVehicles}
          cameraConfig={selectedSetting.camera}
          useVehicleConfig={useVehicleConfig}
        />
      )}

      {/* Simulation Parameters Modal */}
      <SimulationParamsModal />
    </>
  );
};

export default VehicleTest;
