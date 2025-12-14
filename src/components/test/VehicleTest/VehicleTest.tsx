import React, { useEffect, useState } from "react";
import { useMenuStore } from "@store/ui/menuStore";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { useVehicleRapierStore } from "@store/vehicle/rapierMode/vehicleStore";
import { useVehicleArrayStore, TransferMode } from "@store/vehicle/arrayMode/vehicleStore";
import VehicleTestRunner from "./VehicleTestRunner";
import { VehicleSystemType } from "../../../types/vehicle";
import { getTestSettings, getDefaultSetting } from "../../../config/testSettingConfig";
import { Play, Pause } from "lucide-react";

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

  const [selectedSettingId, setSelectedSettingId] = useState<string>(getDefaultSetting());
  const testSettings = getTestSettings();

  // Get selected test setting
  const selectedSetting = testSettings.find(s => s.id === selectedSettingId) || testSettings[0];

  // Input field local state (doesn't trigger re-render)
  const [inputValue, setInputValue] = useState<string>(selectedSetting.numVehicles.toString());

  // Actual vehicle count used for test creation
  const [customNumVehicles, setCustomNumVehicles] = useState<number>(selectedSetting.numVehicles);

  // Key to force remount of VehicleTestRunner when settings change
  const [testKey, setTestKey] = useState<number>(0);

  // Control whether test is active (vehicles created)
  const [isTestCreated, setIsTestCreated] = useState<boolean>(false);

  // Don't stop test when menu changes - let it keep running!
  // User can manually stop test with Delete button or Stop Test button

  // Update both input and vehicle count when setting changes
  useEffect(() => {
    setInputValue(selectedSetting.numVehicles.toString());
    setCustomNumVehicles(selectedSetting.numVehicles);
  }, [selectedSettingId, selectedSetting.numVehicles]);

  // Only render UI when Test menu is active
  // But test keeps running in background even when menu is closed
  if (activeMainMenu !== "Test") {
    return null;
  }

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
    setTestKey(prev => prev + 1); // Force remount to clear vehicles
  };

  // Handle create - create vehicles with current count
  const handleCreate = () => {
    const numVehicles = parseInt(inputValue) || 1;
    setCustomNumVehicles(numVehicles);
    setIsTestCreated(true);
    setTestKey(prev => prev + 1); // Force remount to create vehicles
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
          onChange={(e) => setSelectedSettingId(e.target.value)}
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
        />
      )}
    </>
  );
};

export default VehicleTest;

