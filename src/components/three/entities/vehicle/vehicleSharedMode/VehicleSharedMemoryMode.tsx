import { useEffect, useRef } from "react";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useStationStore } from "@/store/map/stationStore";
import {
  getLinearMaxSpeed,
  getLinearAcceleration,
  getLinearDeceleration,
  getCurveMaxSpeed,
  getApproachMinSpeed,
  getBrakeMinSpeed,
} from "@/config/movementConfig";
import { getBodyLength, getBodyWidth } from "@/config/vehicleConfig";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";

/**
 * VehicleSharedMemoryMode
 * - Uses ShmSimulator with Worker Thread
 * - SharedArrayBuffer for Main-Worker communication
 * - Only handles initialization and play/pause control
 * - Rendering is done by VehiclesRenderer
 */

interface VehicleSharedMemoryModeProps {
  numVehicles?: number;
}

const VehicleSharedMemoryMode: React.FC<VehicleSharedMemoryModeProps> = ({
  numVehicles = 100,
}) => {
  const initRef = useRef(false);
  const edges = useEdgeStore((state) => state.edges);
  const nodes = useNodeStore((state) => state.nodes);
  const isPaused = useVehicleTestStore((state) => state.isPaused);
  const transferMode = useVehicleArrayStore((state) => state.transferMode);
  const stations = useStationStore((state) => state.stations);

  const {
    init: initSimulator,
    pause: pauseSimulator,
    resume: resumeSimulator,
    dispose: disposeSimulator,
    isInitialized,
    isRunning,
  } = useShmSimulatorStore();

  // Initialize simulator when component mounts
  useEffect(() => {
    if (initRef.current) return;
    if (edges.length === 0 || nodes.length === 0) return;

    initRef.current = true;

    console.log("[VehicleSharedMemoryMode] Initializing SHM Simulator...");
    console.log(`[VehicleSharedMemoryMode] Edges: ${edges.length}, Nodes: ${nodes.length}`);

    // Build config from cfgStore values
    const config = {
      bodyLength: getBodyLength(),
      bodyWidth: getBodyWidth(),
      linearMaxSpeed: getLinearMaxSpeed(),
      linearAcceleration: getLinearAcceleration(),
      linearDeceleration: getLinearDeceleration(),
      curveMaxSpeed: getCurveMaxSpeed(),
      approachMinSpeed: getApproachMinSpeed(),
      brakeMinSpeed: getBrakeMinSpeed(),
    };

    initSimulator({
      edges,
      nodes,
      numVehicles,
      config,
      transferMode,
      stations,
    })
      .then(() => {
        console.log("[VehicleSharedMemoryMode] SHM Simulator initialized");
        // Don't auto-start - wait for play button
      })
      .catch((error) => {
        console.error("[VehicleSharedMemoryMode] Failed to initialize:", error);
      });

    // Cleanup on unmount
    return () => {
      console.log("[VehicleSharedMemoryMode] Disposing SHM Simulator...");
      disposeSimulator();
      initRef.current = false;
    };
  }, [edges, nodes, stations, numVehicles, initSimulator, disposeSimulator]);

  // Handle play/pause state changes
  useEffect(() => {
    if (!isInitialized) return;

    if (isPaused) {
      if (isRunning) {
        pauseSimulator();
      }
    } else if (!isRunning) {
        resumeSimulator();
      }    
  }, [isPaused, isInitialized, isRunning, pauseSimulator, resumeSimulator]);

  // This component doesn't render anything - rendering is done by VehiclesRenderer
  return null;
};

export default VehicleSharedMemoryMode;

