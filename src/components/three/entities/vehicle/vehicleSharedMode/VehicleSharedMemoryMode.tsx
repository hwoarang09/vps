import { useEffect, useRef } from "react";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useStationStore } from "@/store/map/stationStore";
import { useFabStore } from "@/store/map/fabStore";
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
import { createFabGridSeparated } from "@/utils/fab/fabUtils";

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
    initMultiFab,
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

    // 멀티 Fab 확인
    const fabStore = useFabStore.getState();
    const isMultiFab = fabStore.isMultiFab();
    const originalMapData = fabStore.originalMapData;

    if (isMultiFab && originalMapData) {
      // 멀티 Fab 모드: 각 Fab별로 분리된 데이터로 초기화
      const { fabCountX, fabCountY } = fabStore;
      const totalFabs = fabCountX * fabCountY;
      const vehiclesPerFab = Math.floor(numVehicles / totalFabs);

      console.log(`[VehicleSharedMemoryMode] Multi-Fab mode: ${fabCountX}x${fabCountY}=${totalFabs} fabs, ${vehiclesPerFab} vehicles per fab`);

      // 각 Fab별로 분리된 데이터 생성
      const fabDataList = createFabGridSeparated(
        originalMapData.nodes,
        originalMapData.edges,
        originalMapData.stations,
        fabCountX,
        fabCountY
      );

      // initMultiFab 호출
      // maxVehicles를 실제 차량 수로 맞춤 (메모리 효율 + 렌더링 연속성)
      const fabs = fabDataList.map(fabData => ({
        fabId: fabData.fabId,
        edges: fabData.edges,
        nodes: fabData.nodes,
        numVehicles: vehiclesPerFab,
        maxVehicles: vehiclesPerFab,  // 메모리 할당을 실제 차량 수로 제한
        transferMode,
        stations: fabData.stations,
      }));

      initMultiFab({ fabs, config })
        .then(() => {
          console.log(`[VehicleSharedMemoryMode] Multi-Fab SHM Simulator initialized with ${totalFabs} fabs`);
        })
        .catch((error) => {
          console.error("[VehicleSharedMemoryMode] Failed to initialize multi-fab:", error);
        });
    } else {
      // 단일 Fab 모드: 기존 방식
      console.log("[VehicleSharedMemoryMode] Single-Fab mode");

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
        })
        .catch((error) => {
          console.error("[VehicleSharedMemoryMode] Failed to initialize:", error);
        });
    }

    // Cleanup on unmount
    return () => {
      console.log("[VehicleSharedMemoryMode] Disposing SHM Simulator...");
      disposeSimulator();
      initRef.current = false;
    };
  }, [edges, nodes, stations, numVehicles, initSimulator, initMultiFab, disposeSimulator]);

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

