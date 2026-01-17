import { useEffect, useRef } from "react";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { useStationStore } from "@/store/map/stationStore";
import { useFabStore } from "@/store/map/fabStore";
import { useFabConfigStore } from "@/store/simulation/fabConfigStore";
import {
  getLinearMaxSpeed,
  getLinearAcceleration,
  getLinearDeceleration,
  getCurveMaxSpeed,
  getApproachMinSpeed,
  getBrakeMinSpeed,
} from "@/config/simulationConfig";
import { getWorkerCount } from "@/config/workerConfig";
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
      // 멀티 Fab 모드: 원본 맵 데이터를 한 번만 전송하여 메모리 절약
      const { fabCountX, fabCountY } = fabStore;
      const totalFabs = fabCountX * fabCountY;
      const vehiclesPerFab = Math.floor(numVehicles / totalFabs);
      // 버퍼 오버플로우 방지를 위해 10% 여유 추가
      const maxVehiclesPerFab = Math.ceil(vehiclesPerFab * 1.1);


      // 각 Fab별로 분리된 데이터 생성 (fabId만 필요)
      const fabDataList = createFabGridSeparated(
        originalMapData.nodes,
        originalMapData.edges,
        originalMapData.stations,
        fabCountX,
        fabCountY
      );

      // initMultiFab 호출
      // edges/nodes/stations를 각 fab에 포함하지 않고, sharedMapData로 한 번만 전송
      const fabConfigStore = useFabConfigStore.getState();
      // simulationConfig.json에서 최신 값 동기화
      fabConfigStore.syncFromSimulationConfig();

      const fabs = fabDataList.map(fabData => {
        // Fab별 설정 적용 (baseConfig + override)
        const fabConfig = fabConfigStore.getFabConfig(fabData.fabIndex);

        // Fab별 config override 생성 (SimulationConfig의 Partial)
        const configOverride = fabConfigStore.hasOverride(fabData.fabIndex) ? {
          linearMaxSpeed: fabConfig.movement.linear.maxSpeed,
          linearAcceleration: fabConfig.movement.linear.acceleration,
          linearDeceleration: fabConfig.movement.linear.deceleration,
          curveMaxSpeed: fabConfig.movement.curve.maxSpeed,
          curveAcceleration: fabConfig.movement.curve.acceleration,
          lockWaitDistance: fabConfig.lock.waitDistance,
          lockRequestDistance: fabConfig.lock.requestDistance,
          lockGrantStrategy: fabConfig.lock.grantStrategy,
        } : undefined;

        if (configOverride) {
        }

        return {
          fabId: fabData.fabId,
          edges: [], // sharedMapData 사용하므로 빈 배열
          nodes: [], // sharedMapData 사용하므로 빈 배열
          numVehicles: vehiclesPerFab,
          maxVehicles: maxVehiclesPerFab,  // 실제 차량 수 + 10% 여유
          transferMode,
          stations: [], // sharedMapData 사용하므로 빈 배열
          fabOffset: {
            fabIndex: fabData.fabIndex,
            col: fabData.col,
            row: fabData.row,
          },
          config: configOverride,
        };
      });

      // 공유 맵 데이터 생성 (원본 데이터 한 번만 전송)
      const sharedMapData = {
        originalEdges: originalMapData.edges,
        originalNodes: originalMapData.nodes,
        originalStations: originalMapData.stations,
        gridX: fabCountX,
        gridY: fabCountY,
      };

      const workerCount = getWorkerCount(fabs.length);

      initMultiFab({ fabs, config, sharedMapData, workerCount })
        .then(() => {
        })
        .catch((error) => {
        });
    } else {
      // 단일 Fab 모드: 기존 방식

      initSimulator({
        edges,
        nodes,
        numVehicles,
        config,
        transferMode,
        stations,
      })
        .then(() => {
        })
        .catch((error) => {
        });
    }

    // Cleanup on unmount
    return () => {
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

