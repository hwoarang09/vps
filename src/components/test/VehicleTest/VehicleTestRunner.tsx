import React, { useEffect } from "react";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { VehicleSystemType } from "@/types/vehicle";


/**
 * VehicleTestRunner
 * - Automatically loads test map and starts vehicle test when test menu is selected
 * - Manages test lifecycle: map loading -> vehicle initialization -> test running
 * - Manages test lifecycle: map loading -> vehicle initialization -> test running
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
  const { startTest } = useVehicleTestStore();

  // Start test (map is already loaded by VehicleTest.tsx)
  useEffect(() => {
    const startTestAsync = async () => {
      try {
        console.log(`[VehicleTestRunner] Starting test: ${mode} with ${numVehicles} vehicles (useVehicleConfig: ${useVehicleConfig})`);

        // Wait a bit for map to render and settle
        setTimeout(() => {
          // Start the test in the store
          startTest(mode, numVehicles, useVehicleConfig);
          console.log(`[VehicleTestRunner] Test started on ${mapName}`);
        }, 100);
      } catch (err) {
        console.error("[VehicleTestRunner] Failed to start test:", err);
      }
    };

    startTestAsync();

    // Don't stop test on unmount - let it keep running!
    // User can manually stop with Delete or Stop Test button
  }, [mode, mapName, numVehicles, useVehicleConfig, startTest]);

  return null;
};

export default VehicleTestRunner;

