import React, { useEffect, useState } from "react";
import { useMenuStore } from "@store/ui/menuStore";
import { useCFGStore } from "@store/system/cfgStore";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { useCameraStore } from "@store/ui/cameraStore";
import { VehicleSystemType } from "../../../types/vehicle";
import VehicleTestUI from "./VehicleTestUI";

/**
 * VehicleTestRunner
 * - Automatically loads test map and starts vehicle test when test menu is selected
 * - Manages test lifecycle: map loading -> vehicle initialization -> test running
 * - Delegates UI rendering to VehicleTestUI
 */

interface VehicleTestRunnerProps {
  mode: VehicleSystemType;
  mapName: string;
  numVehicles: number;
  cameraConfig?: {
    position: [number, number, number];
    target: [number, number, number];
  };
  useVehicleConfig?: boolean; // If true, use vehicles.cfg; if false, use numVehicles
}

const VehicleTestRunner: React.FC<VehicleTestRunnerProps> = ({
  mode,
  mapName,
  numVehicles,
  cameraConfig,
  useVehicleConfig = false,
}) => {
  const { setActiveMainMenu } = useMenuStore();
  const { loadCFGFiles, getVehicleConfigs } = useCFGStore();
  const { startTest, stopTest, isPanelVisible, setPanelVisible } = useVehicleTestStore();
  const { setCameraView } = useCameraStore();
  const [testState, setTestState] = useState<
    "loading-map" | "initializing" | "running" | "error"
  >("loading-map");

  // Start test (map is already loaded by VehicleTest.tsx)
  useEffect(() => {
    const startTestAsync = async () => {
      try {
        setTestState("initializing");
        console.log(`[VehicleTestRunner] Starting test: ${mode} with ${numVehicles} vehicles (useVehicleConfig: ${useVehicleConfig})`);

        // Wait a bit for map to render and settle
        setTimeout(() => {
          setTestState("running");
          // Start the test in the store
          startTest(mode, numVehicles, useVehicleConfig);
          console.log(`[VehicleTestRunner] Test started on ${mapName}`);
        }, 100);
      } catch (err) {
        console.error("[VehicleTestRunner] Failed to start test:", err);
        setTestState("error");
      }
    };

    startTestAsync();

    // Don't stop test on unmount - let it keep running!
    // User can manually stop with Delete or Stop Test button
  }, [mode, mapName, numVehicles, useVehicleConfig, startTest]);

  const handleClose = () => {
    // Just hide the panel, don't stop the test
    setPanelVisible(false);
  };

  const handleStopTest = () => {
    // Stop the test and close menu
    stopTest();
    setActiveMainMenu(null);
  };

  return (
    <VehicleTestUI
      testState={testState}
      mode={mode}
      mapName={mapName}
      numVehicles={numVehicles}
      isPanelVisible={isPanelVisible}
      onClose={handleClose}
      onStopTest={handleStopTest}
    />
  );
};

export default VehicleTestRunner;

