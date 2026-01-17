import React, { useEffect, useState, useRef } from "react";
import { useMenuStore } from "@store/ui/menuStore";
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

/**
 * VehicleTest
 * - Router component for vehicle performance tests
 * - Routes to appropriate test based on selected submenu
 * - Allows test setting selection (map + vehicle count)
 * - Stops test when menu is changed or deactivated
 */

const VehicleTest: React.FC = () => {
  const { activeMainMenu, activeSubMenu } = useMenuStore();
  const { stopTest, isPaused, setPaused } = useVehicleTestStore();
  const edges = useEdgeStore((state) => state.edges);
  const { transferMode, setTransferMode } = useVehicleArrayStore();

  const { dispose: disposeShmSimulator } = useShmSimulatorStore();
  const { loadCFGFiles } = useCFGStore();
  const { setCameraView } = useCameraStore();
  const prevModeRef = useRef<string | null>(null);

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
      console.error("Failed to download log:", error);
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
      console.log(`[VehicleTest] Loading map: ${setting.mapName}...`);
      await loadCFGFiles(setting.mapName);
      console.log(`[VehicleTest] ✓ Map loaded successfully: ${setting.mapName}`);

      // Initialize LockMgr
      const edges = useEdgeStore.getState().edges;
      getLockMgr().initFromEdges(edges);

      // Set camera position if configured
      if (setting.camera) {
        setCameraView(setting.camera.position, setting.camera.target);
        console.log(`[VehicleTest] ✓ Camera positioned`);
      }

      // Auto-create vehicles only if requested
      if (autoCreateVehicles) {
        // Wait for map to render and edges renderingPoints to be calculated
        console.log(`[VehicleTest] Waiting for edges to calculate renderingPoints...`);
        vehicleCreateTimeoutRef.current = setTimeout(() => {
          // Auto-create vehicles using vehicles.cfg
          console.log(`[VehicleTest] ✓ Creating vehicles from vehicles.cfg`);
          setUseVehicleConfig(true); // Use vehicles.cfg
          setIsTestCreated(true);
          setTestKey(prev => prev + 1); // Force remount to create vehicles
          vehicleCreateTimeoutRef.current = null;
        }, 800);
      }
    } catch (error) {
      console.error("[VehicleTest] ✗ Failed to load map:", error);
    }
  };

  // Initial load effect
  useEffect(() => {
    // Check if we should auto-load (only once on mount)
    loadTestSetting(selectedSettingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // Cleanup on mode change
  useEffect(() => {
    if (prevModeRef.current && prevModeRef.current !== activeSubMenu) {
      // Mode changed - cleanup previous mode
      console.log(`[VehicleTest] Mode changed: ${prevModeRef.current} -> ${activeSubMenu}`);

      // Dispose SHM simulator if switching away from shared-memory mode
      if (prevModeRef.current === "test-shared-memory") {
        disposeShmSimulator();
      }

      // Reset test state
      if (isTestCreated) {
        stopTest();
        setIsTestCreated(false);
        setTestKey((prev) => prev + 1);
      }
    }
    prevModeRef.current = activeSubMenu;
  }, [activeSubMenu, isTestCreated, stopTest, disposeShmSimulator]);

  // Only render UI when Test menu is active
  // But test keeps running in background even when menu is closed
  // Move early return to AFTER effects
  // if (activeMainMenu !== "Test") {
  //   return null;
  // ]

  // Route to appropriate test based on submenu
  let mode: VehicleSystemType | null = null;

  switch (activeSubMenu) {
    case "test-rapier-array":
      mode = VehicleSystemType.RapierDict;
      break;
    case "test-rapier-dict":
      mode = VehicleSystemType.ArraySingle;
      break;
    case "test-shared-memory":
      mode = VehicleSystemType.SharedMemory;
      break;
    default:
      return null;
  }

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
      console.warn("[FAB] No nodes or edges to clone");
      return;
    }

    // Stop existing test and dispose simulator before FAB creation
    if (isTestCreated) {
      stopTest();
      setIsTestCreated(false);
    }
    disposeShmSimulator();

    const totalFabs = fabCountX * fabCountY;
    console.log(`[FAB] Creating ${fabCountX}x${fabCountY}=${totalFabs} fabs from ${nodes.length} nodes, ${edges.length} edges, ${stations.length} stations`);

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
    console.log(`[FAB] Created ${fabInfos.length} fab infos`);

    // Initialize render slots (슬롯 기반 렌더링용)
    useFabStore.getState().initSlots();
    console.log(`[FAB] Initialized render slots`);

    // Store에는 원본만 저장 (메모리 절약)
    // Worker는 sharedMapData로 원본을 받아서 자체적으로 fab별 offset 계산
    useNodeStore.getState().setNodes(nodes);
    useEdgeStore.getState().setEdges(edges);
    useStationStore.getState().setStations(stations);

    // Update text store with original data (fab별 분리는 위치 기반으로 수행)
    updateTextsForFab(nodes, edges, stations, fabCountX, fabCountY);

    // Re-initialize LockMgr with original edges
    // 메인 스레드 LockMgr는 원본 기준, Worker는 각자 fab별 LockMgr 사용
    resetLockMgr();
    getLockMgr().initFromEdges(edges);

    setIsFabApplied(true);
    console.log(`[FAB] ✓ Created ${totalFabs} fabs (using original: ${nodes.length} nodes, ${edges.length} edges, ${stations.length} stations)`);
  };

  // Update text store with fab-separated data
  const updateTextsForFab = (
    nodes: ReturnType<typeof useNodeStore.getState>["nodes"],
    edges: ReturnType<typeof useEdgeStore.getState>["edges"],
    stations: ReturnType<typeof useStationStore.getState>["stations"],
    gridX: number,
    gridY: number,
  ) => {
    const textStore = useTextStore.getState();
    const fabInfos = useFabStore.getState().fabs;
    textStore.clearAllTexts();

    const totalFabs = gridX * gridY;
    const stationTextConfig = getStationTextConfig();

    // 각 텍스트가 어느 fab에 속하는지 판별하는 함수
    const getFabIndex = (x: number, y: number): number => {
      for (let i = 0; i < fabInfos.length; i++) {
        const fab = fabInfos[i];
        if (x >= fab.xMin && x <= fab.xMax && y >= fab.yMin && y <= fab.yMax) {
          return i;
        }
      }
      return 0; // fallback
    };

    // Fab별 텍스트 배열 초기화
    const textsByFab: import("@/store/map/textStore").FabTextData[] = [];
    for (let i = 0; i < totalFabs; i++) {
      textsByFab.push({ nodeTexts: [], edgeTexts: [], stationTexts: [] });
    }

    // Node texts - fab별 분리
    const nodeMap = new Map(nodes.map(n => [n.node_name, n]));
    for (const node of nodes) {
      if (node.node_name.startsWith("TMP_")) continue;
      const fabIdx = getFabIndex(node.editor_x, node.editor_y);
      textsByFab[fabIdx].nodeTexts.push({
        name: node.node_name,
        position: { x: node.editor_x, y: node.editor_y, z: node.editor_z },
      });
    }

    // Edge texts - fab별 분리
    for (const edge of edges) {
      if (edge.edge_name.startsWith("TMP_")) continue;
      const fromNode = nodeMap.get(edge.from_node);
      const toNode = nodeMap.get(edge.to_node);
      if (!fromNode || !toNode) continue;

      const midX = (fromNode.editor_x + toNode.editor_x) / 2;
      const midY = (fromNode.editor_y + toNode.editor_y) / 2;
      const midZ = (fromNode.editor_z + toNode.editor_z) / 2;
      const fabIdx = getFabIndex(midX, midY);

      textsByFab[fabIdx].edgeTexts.push({
        name: edge.edge_name,
        position: { x: midX, y: midY, z: midZ },
      });
    }

    // Station texts - fab별 분리
    for (const station of stations) {
      const fabIdx = getFabIndex(station.position.x, station.position.y);
      textsByFab[fabIdx].stationTexts.push({
        name: station.station_name,
        position: {
          x: station.position.x,
          y: station.position.y,
          z: station.position.z + stationTextConfig.Z_OFFSET,
        },
      });
    }

    // Store에 저장
    textStore.setTextsByFab(textsByFab);

    // 기존 array도 업데이트 (호환성)
    const allNodes = textsByFab.flatMap(f => f.nodeTexts);
    const allEdges = textsByFab.flatMap(f => f.edgeTexts);
    const allStations = textsByFab.flatMap(f => f.stationTexts);
    textStore.setNodeTextsArray(allNodes);
    textStore.setEdgeTextsArray(allEdges);
    textStore.setStationTextsArray(allStations);

    textStore.forceUpdate();

    // 로그
    console.log(`[FAB] Text stored for ${totalFabs} fabs (first fab: ${textsByFab[0].nodeTexts.length} nodes)`);
  };

  // Handle FAB Clear - reload map to reset to original state (no auto vehicle creation)
  const handleFabClear = async () => {
    console.log("[FAB] Clearing FAB, reloading map...");

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



  // Only render UI when Test menu is active
  // But test keeps running in background even when menu is closed
  if (activeMainMenu !== "Test") {
    return null;
  }

  // Handle test setting change - load map, set camera, and create vehicles from vehicles.cfg
  const handleSettingChange = async (newSettingId: string) => {
    setSelectedSettingId(newSettingId);
    await loadTestSetting(newSettingId);
  };

  return (
    <>
      {/* Test Setting Selector */}
      <div
        style={{
          position: "fixed",
          top: "10px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0, 0, 0, 0.8)",
          color: "white",
          padding: "10px 20px",
          borderRadius: "8px",
          fontFamily: "monospace",
          fontSize: "12px",
          zIndex: 1001,
          display: "flex",
          alignItems: "center",
          gap: "15px",
        }}
      >
        <label style={{ fontWeight: "bold" }}>TEST SETTING:</label>
        <select
          value={selectedSettingId}
          onChange={(e) => handleSettingChange(e.target.value)}
          style={{
            padding: "5px 10px",
            background: "#333",
            color: "white",
            border: "1px solid #4ecdc4",
            borderRadius: "4px",
            fontSize: "12px",
            cursor: "pointer",
          }}
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
          style={{
            padding: "5px 10px",
            background: "#333",
            color: "white",
            border: "1px solid #9b59b6",
            borderRadius: "4px",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          <option value={TransferMode.LOOP}>LOOP</option>
          <option value={TransferMode.RANDOM}>RANDOM</option>
          <option value={TransferMode.MQTT_CONTROL}>MQTT</option>
          <option value={TransferMode.AUTO_ROUTE}>AUTO_ROUTE</option>
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label style={{ fontWeight: "bold" }}>VEHICLES:</label>
          <input
            type="number"
            min="1"
            max="10000"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            style={{
              width: "70px",
              padding: "5px 8px",
              background: "#333",
              color: "white",
              border: "1px solid #4ecdc4",
              borderRadius: "4px",
              fontSize: "12px",
              textAlign: "center",
            }}
          />
          <span style={{ color: "#aaa", fontSize: "11px" }}>
            / {maxVehicleCapacity || "---"}
          </span>
        </div>

        <button
          onClick={handleCreate}
          style={{
            padding: "5px 15px",
            background: "#27ae60",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontSize: "12px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          Create
        </button>

        <button
          onClick={handleDelete}
          style={{
            padding: "5px 15px",
            background: "#e74c3c",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontSize: "12px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          Delete
        </button>

        {/* FAB Controls */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginLeft: "15px",
          paddingLeft: "15px",
          borderLeft: "1px solid #555",
        }}>
          <label style={{ fontWeight: "bold", color: "#f39c12" }}>FAB:</label>
          <input
            type="number"
            min="1"
            max="100"
            value={fabCountX}
            onChange={(e) => setFabCountX(Math.max(1, Math.min(100, Number.parseInt(e.target.value) || 1)))}
            disabled={isFabApplied}
            style={{
              width: "50px",
              padding: "5px 4px",
              background: isFabApplied ? "#555" : "#333",
              color: "white",
              border: "1px solid #f39c12",
              borderRadius: "4px",
              fontSize: "12px",
              textAlign: "center",
            }}
            title="가로 개수"
          />
          <span style={{ color: "#f39c12", fontWeight: "bold" }}>×</span>
          <input
            type="number"
            min="1"
            max="100"
            value={fabCountY}
            onChange={(e) => setFabCountY(Math.max(1, Math.min(100, Number.parseInt(e.target.value) || 1)))}
            disabled={isFabApplied}
            style={{
              width: "50px",
              padding: "5px 4px",
              background: isFabApplied ? "#555" : "#333",
              color: "white",
              border: "1px solid #f39c12",
              borderRadius: "4px",
              fontSize: "12px",
              textAlign: "center",
            }}
            title="세로 개수"
          />
          <span style={{ color: "#888", fontSize: "11px" }}>
            ={fabCountX * fabCountY}
          </span>
          <button
            onClick={handleFabCreate}
            style={{
              padding: "5px 12px",
              background: isFabApplied ? "#7f8c8d" : "#f39c12",
              color: "white",
              border: "none",
              borderRadius: "4px",
              fontSize: "12px",
              cursor: isFabApplied ? "not-allowed" : "pointer",
              fontWeight: "bold",
            }}
            disabled={isFabApplied}
          >
            Create
          </button>
          <button
            onClick={handleFabClear}
            style={{
              padding: "5px 12px",
              background: isFabApplied ? "#e67e22" : "#7f8c8d",
              color: "white",
              border: "none",
              borderRadius: "4px",
              fontSize: "12px",
              cursor: isFabApplied ? "pointer" : "not-allowed",
              fontWeight: "bold",
            }}
            disabled={!isFabApplied}
          >
            Clear
          </button>
          <button
            onClick={() => useFabConfigStore.getState().setModalOpen(true)}
            style={{
              padding: "5px 12px",
              background: "#9b59b6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
            title="Configure simulation parameters per fab"
          >
            <Settings size={14} />
            Params
          </button>
        </div>

        {/* Play/Pause buttons */}
        <div style={{ display: "flex", gap: "5px", marginLeft: "10px" }}>
          <button
            onClick={() => setPaused(false)}
            disabled={!isPaused}
            style={{
              padding: "5px 10px",
              background: isPaused ? "#27ae60" : "#555",
              color: "white",
              border: isPaused ? "2px solid #2ecc71" : "1px solid #666",
              borderRadius: "4px",
              fontSize: "12px",
              cursor: isPaused ? "pointer" : "not-allowed",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              opacity: isPaused ? 1 : 0.5,
            }}
            title="Play simulation"
          >
            <Play size={14} />
            Play
          </button>

          <button
            onClick={() => setPaused(true)}
            disabled={isPaused}
            style={{
              padding: "5px 10px",
              background: !isPaused ? "#f39c12" : "#555",
              color: "white",
              border: !isPaused ? "2px solid #f1c40f" : "1px solid #666",
              borderRadius: "4px",
              fontSize: "12px",
              cursor: !isPaused ? "pointer" : "not-allowed",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              opacity: !isPaused ? 1 : 0.5,
            }}
            title="Pause simulation"
          >
            <Pause size={14} />
            Pause
          </button>
        </div>

        {/* Log Download Section */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginLeft: "15px",
          paddingLeft: "15px",
          borderLeft: "1px solid #555",
        }}>
          <button
            onClick={handleDownloadLog}
            disabled={!isSimInitialized}
            style={{
              padding: "5px 12px",
              background: isSimInitialized ? "#3498db" : "#555",
              color: "white",
              border: isSimInitialized ? "2px solid #2980b9" : "1px solid #666",
              borderRadius: "4px",
              fontSize: "11px",
              cursor: isSimInitialized ? "pointer" : "not-allowed",
              fontWeight: "bold",
              opacity: isSimInitialized ? 1 : 0.5,
            }}
            title={isSimInitialized ? "Download current session log" : "Start simulation first"}
          >
            📥 Latest
          </button>
          <LogFileManager />
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
