import React, { useEffect, useState, useRef } from "react";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { useVehicleArrayStore } from "@store/vehicle/arrayMode/vehicleStore";
import { useVehicleGeneralStore } from "@store/vehicle/vehicleGeneralStore";
import { useShmSimulatorStore } from "@store/vehicle/shmMode/shmSimulatorStore";
import { useCFGStore } from "@store/system/cfgStore";
import { useCameraStore } from "@store/ui/cameraStore";
import VehicleTestRunner from "./VehicleTestRunner";
import { VehicleSystemType } from "@/types/vehicle";
import { getTestSettings } from "@/config/react/testSettingConfig";
import SimulationParamsModal from "./SimulationParamsModal";
import TopControlBar from "./TopControlBar";
import WelcomeHint from "./WelcomeHint";
import AppBranding from "./AppBranding";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import { getLockMgr, resetLockMgr } from "@/common/vehicle/logic/LockMgr/index";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useStationStore } from "@/store/map/stationStore";
import { useTextStore } from "@/store/map/textStore";
import { getNodeBounds, createFabInfos } from "@/utils/fab/fabUtils";
import { useFabStore } from "@/store/map/fabStore";
import { getMaxVehicleCapacity } from "@/utils/vehicle/vehiclePlacement";
import { getStationTextConfig } from "@/config/threejs/stationConfig";
import { getPersistedConfig } from "@/config/persistedConfig";

/**
 * VehicleTest
 * - Router component for vehicle performance tests
 * - Routes to appropriate test based on selected submenu
 * - Allows test setting selection (map + vehicle count)
 * - Stops test when menu is changed or deactivated
 */

const VehicleTest: React.FC = () => {
  const { stopTest, isPaused, setPaused, selectedSettingId, settingChangeSeq, recreateSeq } = useVehicleTestStore();
  const edges = useEdgeStore((state) => state.edges);
  const { setTransferMode } = useVehicleArrayStore();

  const { dispose: disposeShmSimulator } = useShmSimulatorStore();
  const { loadCFGFiles } = useCFGStore();
  const { setCameraView } = useCameraStore();

  const testSettings = getTestSettings();

  // Get selected test setting
  const selectedSetting = testSettings.find(s => s.id === selectedSettingId) || testSettings[0];
  const [inputValue, setInputValue] = useState<string>(selectedSetting.numVehicles.toString());
  const [customNumVehicles, setCustomNumVehicles] = useState<number>(selectedSetting.numVehicles);
  const [testKey, setTestKey] = useState<number>(0);
  const [isTestCreated, setIsTestCreated] = useState<boolean>(false);
  const [useVehicleConfig, setUseVehicleConfig] = useState<boolean>(false);
  const persistedCfg = getPersistedConfig();
  const [fabCountX, setFabCountX] = useState<number>(persistedCfg.fabCountX);
  const [fabCountY, setFabCountY] = useState<number>(persistedCfg.fabCountY);
  const [isFabApplied, setIsFabApplied] = useState<boolean>(false);

  // Calculate max vehicle capacity from edges (fab 개수 반영)
  const maxVehicleCapacity = React.useMemo(() => {
    if (edges.length === 0) return 0;
    const baseCapacity = getMaxVehicleCapacity(edges);
    if (isFabApplied) {
      return baseCapacity * fabCountX * fabCountY;
    }
    return baseCapacity;
  }, [edges, isFabApplied, fabCountX, fabCountY]);

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
          // Persisted config에 multi-fab이면 자동 적용
          const cfg = getPersistedConfig();
          // UI state도 동기화
          setFabCountX(cfg.fabCountX);
          setFabCountY(cfg.fabCountY);
          const totalFabs = cfg.fabCountX * cfg.fabCountY;
          if (totalFabs > 1) {
            applyFabGrid(cfg.fabCountX, cfg.fabCountY);
            // applyFabGrid 후 추가 대기 — fab grid 렌더링 완료 후 차량 생성
            setTimeout(() => {
              setInputValue(cfg.numVehicles.toString());
              setCustomNumVehicles(cfg.numVehicles);
              setUseVehicleConfig(false);
              setIsTestCreated(true);
              setTestKey(prev => prev + 1);
            }, 300);
          } else {
            setInputValue(cfg.numVehicles.toString());
            setCustomNumVehicles(cfg.numVehicles);
            setUseVehicleConfig(false);
            setIsTestCreated(true);
            setTestKey(prev => prev + 1);
          }
          vehicleCreateTimeoutRef.current = null;
        }, 800);
      }
    } catch (error) {
    }
  };

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

  // Fab grid 생성 core 로직 (handleFabCreate, 자동 복원 공용)
  const applyFabGrid = (countX: number, countY: number) => {
    const nodes = useNodeStore.getState().nodes;
    const edges = useEdgeStore.getState().edges;
    const stations = useStationStore.getState().stations;

    if (nodes.length === 0 || edges.length === 0) return;

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
    const fabInfos = createFabInfos(countX, countY, bounds);
    useFabStore.getState().setFabGrid(countX, countY, fabInfos);

    // Initialize render slots (슬롯 기반 렌더링용)
    useFabStore.getState().initSlots();

    // Store에는 원본만 저장 (메모리 절약)
    useNodeStore.getState().setNodes(nodes);
    useEdgeStore.getState().setEdges(edges);
    useStationStore.getState().setStations(stations);

    // Update text store with fab 0 data only
    updateTextsForFab(nodes, edges, stations);

    // Re-initialize LockMgr with original edges
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

  // Handle FAB Create - UI 버튼에서 호출
  const handleFabCreate = () => {
    applyFabGrid(fabCountX, fabCountY);
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



  // React to setting changes from Operation panel (store-based)
  const settingChangeSeqRef = useRef(settingChangeSeq);
  useEffect(() => {
    // Skip initial render (already handled by mount effect)
    if (settingChangeSeqRef.current === settingChangeSeq) return;
    settingChangeSeqRef.current = settingChangeSeq;
    loadTestSetting(selectedSettingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingChangeSeq]);

  // React to recreate request from Veh panel — 차량 삭제 후 재생성 (변경값 즉시 적용)
  const recreateSeqRef = useRef(recreateSeq);
  useEffect(() => {
    if (recreateSeqRef.current === recreateSeq) return;
    recreateSeqRef.current = recreateSeq;
    handleDelete();
    handleCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recreateSeq]);

  return (
    <>
      {/* 상단 좌측 VPS 제목 + 우하단 버전 */}
      <AppBranding />

      {/* Top Control Bar - MenuLevel1/2 style */}
      <TopControlBar
        vehicleCount={inputValue}
        onVehicleCountChange={setInputValue}
        maxVehicleCapacity={maxVehicleCapacity}
        onCreateVehicles={handleCreate}
        onDeleteVehicles={handleDelete}
        fabCountX={fabCountX}
        fabCountY={fabCountY}
        onFabCountXChange={setFabCountX}
        onFabCountYChange={setFabCountY}
        isFabApplied={isFabApplied}
        onFabCreate={handleFabCreate}
        onFabClear={handleFabClear}
        isPaused={isPaused}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
      />

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

      {/* 첫 로딩 완료 시 1회 노출되는 온보딩 안내 모달 */}
      <WelcomeHint
        isTestCreated={isTestCreated}
        fabCountX={fabCountX}
        fabCountY={fabCountY}
        numVehicles={customNumVehicles}
      />
    </>
  );
};

export default VehicleTest;
