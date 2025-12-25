import React, { useEffect, useState } from "react";
import { useMenuStore } from "@store/ui/menuStore";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { useVehicleRapierStore } from "@store/vehicle/rapierMode/vehicleStore";
import { useVehicleArrayStore, TransferMode } from "@store/vehicle/arrayMode/vehicleStore";
import { useCFGStore } from "@store/system/cfgStore";
import { useCameraStore } from "@store/ui/cameraStore";
import VehicleTestRunner from "./VehicleTestRunner";
import { VehicleSystemType } from "../../../types/vehicle";
import { getTestSettings, getDefaultSetting } from "../../../config/testSettingConfig";
import { Play, Pause } from "lucide-react";
import { getLockMgr, resetLockMgr } from "@/components/three/entities/vehicle/vehicleArrayMode/logic/LockMgr";
import { useEdgeStore } from "@/store/map/edgeStore";

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
  const { maxPlaceableVehicles } = useVehicleRapierStore();
  const { transferMode, setTransferMode } = useVehicleArrayStore();
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

  useEffect(() => {
    setInputValue(selectedSetting.numVehicles.toString());
    setCustomNumVehicles(selectedSetting.numVehicles);
  }, [selectedSettingId, selectedSetting.numVehicles]);

  const loadTestSetting = async (settingId: string) => {
    const setting = testSettings.find(s => s.id === settingId);
    if (!setting) return;

    resetLockMgr();
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

      // Wait for map to render and edges renderingPoints to be calculated
      console.log(`[VehicleTest] Waiting for edges to calculate renderingPoints...`);
      setTimeout(() => {
        // Auto-create vehicles using vehicles.cfg
        console.log(`[VehicleTest] ✓ Creating vehicles from vehicles.cfg`);
        setUseVehicleConfig(true); // Use vehicles.cfg
        setIsTestCreated(true);
        setTestKey(prev => prev + 1); // Force remount to create vehicles
      }, 800);
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
            / {maxPlaceableVehicles || "---"}
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
    </>
  );
};

export default VehicleTest;
