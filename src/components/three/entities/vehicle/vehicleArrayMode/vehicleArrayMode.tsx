// VehicleArrayMode.tsx
// Array-based vehicle simulation with Direct Memory Access (No GC overhead)
// Only handles coordinate calculation and collision detection
// Rendering is done by VehiclesRenderer

import { useEffect, useRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useEdgeStore } from "@/store/map/edgeStore";

import { useVehicleGeneralStore } from "@/store/vehicle/vehicleGeneralStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { useCFGStore } from "@/store/system/cfgStore";
import { getVehicleConfigSync, waitForConfig, getBodyLength, getBodyWidth } from "@/config/vehicleConfig";
import {
  getMaxDelta,
  getApproachMinSpeed,
  getBrakeMinSpeed,
  getLinearMaxSpeed,
  getCurveMaxSpeed,
  getCurveAcceleration,
  getLinearPreBrakeDeceleration,
  getSimulationConfig
} from "@/config/simulationConfig";
import { initializeVehicles } from "./initializeVehicles";
import { checkCollisions, type CollisionCheckContext } from "@/common/vehicle/collision/collisionCheck";
import { updateMovement, type MovementUpdateContext, type MovementConfig } from "@/common/vehicle/movement/movementUpdate";
import { getLockMgr } from "@/common/vehicle/logic/LockMgr";
import { TransferMgr } from "@/common/vehicle/logic/TransferMgr";
import { sensorPointArray } from "@/store/vehicle/arrayMode/sensorPointArray";
import { VehicleLoop } from "@/utils/vehicle/loopMaker";
import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { useVehicleArrayStore } from "@/store/vehicle/arrayMode/vehicleStore";

/**
 * Log safety configuration on mount
 */
function logSafetyConfig(bodyLength: number, sensorLength: number, vehicleSpacing: number, sameEdgeSafeDistance: number, resumeDistance: number) {
}

interface VehicleArrayModeProps {
  numVehicles?: number;
}

const VehicleArrayMode: React.FC<VehicleArrayModeProps> = ({
  numVehicles = 100,
}) => {
  const initRef = useRef(false);
  const [initialized, setInitialized] = useState(false);
  const edges = useEdgeStore((state) => state.edges);
  const vehicleConfigs = useCFGStore((state) => state.vehicleConfigs);
  const useVehicleConfig = useVehicleTestStore((state) => state.useVehicleConfig);
  const store = useVehicleArrayStore();
  const vehicleLoopMapRef = useRef<Map<number, VehicleLoop>>(new Map());
  const edgeNameToIndexRef = useRef<Map<string, number>>(new Map());
  const edgeArrayRef = useRef<any[]>([]);
  const actualNumVehiclesRef = useRef(0);
  const transferMgrRef = useRef(new TransferMgr());
  const collisionCheckTimersRef = useRef(new Map<number, number>());
  const curveBrakeCheckTimersRef = useRef(new Map<number, number>());
  const [config, setConfig] = useState(() => getVehicleConfigSync());

  // Wait for config to load from JSON
  useEffect(() => {
    waitForConfig().then(loadedConfig => {
      setConfig(loadedConfig);
    });
  }, []);

  const {
    BODY: { LENGTH: bodyLength },
    SENSOR: { LENGTH: sensorLength },
    VEHICLE_SPACING: vehicleSpacing,
  } = config;

  const sameEdgeSafeDistance = useMemo(() => bodyLength + sensorLength, [bodyLength, sensorLength]);
  const resumeDistance = useMemo(() => sameEdgeSafeDistance * 1, [sameEdgeSafeDistance]);

  // Log safety configuration when config changes
  useEffect(() => {
    logSafetyConfig(bodyLength, sensorLength, vehicleSpacing, sameEdgeSafeDistance, resumeDistance);
  }, [bodyLength, sensorLength, vehicleSpacing, sameEdgeSafeDistance, resumeDistance]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      store.clearAllVehicles();
      useVehicleGeneralStore.getState().clearAll();
      initRef.current = false;
    };
  }, []);

  // Initialize vehicles once (prevent double execution in React Strict Mode)
  useEffect(() => {
    if (!initRef.current) {
      // Check if edges are ready (must have edges with renderingPoints)
      if (edges.length === 0) {
        return;
      }

      // Check if edges have renderingPoints
      const edgesWithPoints = edges.filter(e => e.renderingPoints && e.renderingPoints.length > 0);
      if (edgesWithPoints.length === 0) {
        return;
      }


      const result = initializeVehicles({
        edges,
        numVehicles,
        store,
        vehicleConfigs: (useVehicleConfig && vehicleConfigs.length > 0) ? vehicleConfigs : undefined,
        transferMode: store.transferMode,
      });


      // Store results in refs for use in useFrame
      edgeNameToIndexRef.current = result.edgeNameToIndex;
      edgeArrayRef.current = result.edgeArray;
      actualNumVehiclesRef.current = result.actualNumVehicles;

      // Store actualNumVehicles in store for renderer access
      store.setActualNumVehicles(result.actualNumVehicles);

      // Store initial vehicle distribution for UI display
      const distribution = new Map<number, number[]>();
      for (let edgeIdx = 0; edgeIdx < edgeArrayRef.current.length; edgeIdx++) {
        const vehicles = edgeVehicleQueue.getVehicles(edgeIdx);
        if (vehicles.length > 0) {
          distribution.set(edgeIdx, vehicles);
        }
      }
      useVehicleTestStore.getState().setInitialVehicleDistribution(distribution);

      initRef.current = true;
      setInitialized(true);
    }
  }, [numVehicles, edges, store]);

  // ==================================================================================
  // Real-time Loop - Coordinate Calculation Only
  // ==================================================================================
  useFrame((_state, delta) => {
    const clampedDelta = Math.min(delta, getMaxDelta());

    // Check if simulation is paused
    const isPaused = useVehicleTestStore.getState().isPaused;
    if (isPaused) return;

    // Early return if not ready
    if (!initialized || !store.vehicleDataRef || edgeArrayRef.current.length === 0 || actualNumVehiclesRef.current === 0) return;

    const edgeArray = edgeArrayRef.current;
    const vehicleArrayData = store.vehicleDataRef;
    const actualNumVehicles = actualNumVehiclesRef.current;

    // 1. Collision Check
    const simConfig = getSimulationConfig();
    const collisionCtx: CollisionCheckContext = {
      vehicleArrayData,
      edgeArray,
      edgeVehicleQueue,
      sensorPointArray,
      config: {
        approachMinSpeed: getApproachMinSpeed(),
        brakeMinSpeed: getBrakeMinSpeed(),
        bodyLength: getBodyLength(),
        collisionCheckInterval: simConfig.collisionCheckInterval,
      },
      delta: clampedDelta,
      collisionCheckTimers: collisionCheckTimersRef.current,
    };
    checkCollisions(collisionCtx);

    // 2. Movement Update
    const movementConfig: MovementConfig = {
      linearMaxSpeed: getLinearMaxSpeed(),
      curveMaxSpeed: getCurveMaxSpeed(),
      curveAcceleration: getCurveAcceleration(),
      vehicleZOffset: 0.15,
      bodyLength: getBodyLength(),
      bodyWidth: getBodyWidth(),
      linearPreBrakeDeceleration: getLinearPreBrakeDeceleration(), // 곡선 사전 감속용 (음수) - 직선에서 적용
      curvePreBrakeCheckInterval: simConfig.curvePreBrakeCheckInterval,
    };

    const transferModeValue = store.transferMode;

    const movementCtx: MovementUpdateContext = {
      vehicleDataArray: { getData: () => vehicleArrayData },
      sensorPointArray,
      edgeArray,
      actualNumVehicles,
      vehicleLoopMap: vehicleLoopMapRef.current,
      edgeNameToIndex: edgeNameToIndexRef.current,
      store: {
        moveVehicleToEdge: store.moveVehicleToEdge,
        transferMode: transferModeValue,
      },
      lockMgr: getLockMgr(),
      transferMgr: transferMgrRef.current,
      clampedDelta,
      config: movementConfig,
      curveBrakeCheckTimers: curveBrakeCheckTimersRef.current,
    };

    updateMovement(movementCtx);
  });

  // This component doesn't render anything - rendering is done by VehiclesRenderer
  return null;
};

export default VehicleArrayMode;
