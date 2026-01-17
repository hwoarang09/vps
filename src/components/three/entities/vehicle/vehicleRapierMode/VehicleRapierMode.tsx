import { useEffect, useRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import VehicleRapierModeVehicle from "./VehicleRapierModeVehicle";
import { initializeRapierVehicles } from "../vehicleArrayMode/initializeVehicles";
import { useVehicleRapierStore } from "@/store/vehicle/rapierMode/vehicleStore";
import { useVehicleTestStore } from "@/store/vehicle/vehicleTestStore";
import { useEdgeStore } from "@/store/map/edgeStore";
import { getLinearMaxSpeed, getLinearAcceleration, getCurveMaxSpeed, getMaxDelta } from "@/config/simulationConfig";
import { getNextEdgeInLoop, VehicleLoop } from "@/utils/vehicle/loopMaker";
import { EdgeType } from "@/types";

import { getMarkerConfig } from "@/config/renderConfig";
import { MovingStatus } from "@/common/vehicle/initialize/constants";

interface VehicleRapierModeProps {
  numVehicles?: number;
  mode?: "rapier" | "array_single" | "array_shared";
}

const VehicleRapierMode: React.FC<VehicleRapierModeProps> = ({
  numVehicles = 100,
  mode = "rapier",
}) => {
  const initRef = useRef(false);
  const [initialized, setInitialized] = useState(false);
  const actualNumVehicles = useVehicleRapierStore((state) => state.actualNumVehicles);
  const edges = useEdgeStore((state) => state.edges);
  const loopsRef = useRef<VehicleLoop[]>([]);
  const edgeNameToIndexRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!initRef.current) {
      initializeRapierVehicles({
        numVehicles,
        mode,
        edges: Array.from(edges.values()),
        setInitialized,
        onPlacementComplete: (result: any) => {
          loopsRef.current = result.vehicleLoops;
          edgeNameToIndexRef.current = result.edgeNameToIndex;
        }
      });
      initRef.current = true;
    }
  }, [numVehicles, edges, mode]);

  useFrame((_state, delta) => {
    const clampedDelta = Math.min(delta, getMaxDelta());

    // Check if simulation is paused
    const isPaused = useVehicleTestStore.getState().isPaused;
    const store = useVehicleRapierStore.getState();
    const edgeArray = Array.from(edges.values());
    if (edgeArray.length === 0 || actualNumVehicles === 0 || isPaused || !initialized) return;

    for (let i = 0; i < actualNumVehicles; i++) {
      const status = store.getVehicleStatus(i);
      const velocity = store.getVehicleVelocity(i);
      const edgeRatioNullable = store.getEdgeRatio(i);
      const currentEdgeIndexNullable = store.getCurrentEdge(i);

      // For rapier mode, check rigidBody; for array mode, skip rigidBody check
      const rigidBody = store.getRigidBody(i);
      if (!rigidBody || velocity === null || edgeRatioNullable === null || currentEdgeIndexNullable === null) continue;

      let edgeRatio = edgeRatioNullable;
      let currentEdgeIndex = currentEdgeIndexNullable;

      if (status === MovingStatus.STOPPED) {
        store.setVehicleVelocity(i, 0);
        rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }

      let edge = edgeArray[currentEdgeIndex];
      if (!edge?.renderingPoints?.length) continue;

      const isCurve = edge.vos_rail_type !== EdgeType.LINEAR;
      const { currentSpeed } = calculateMovementParameters(
        isCurve,
        velocity,
        clampedDelta
      );

      store.setVehicleVelocity(i, currentSpeed);

      let newRatio = edgeRatio + (currentSpeed * clampedDelta) / edge.distance;

      const transitionResult = processEdgeTransitions(
        newRatio,
        edge,
        currentEdgeIndex,
        i,
        loopsRef.current,
        edgeNameToIndexRef.current,
        edgeArray
      );

      newRatio = transitionResult.ratio;
      edge = transitionResult.edge;
      currentEdgeIndex = transitionResult.edgeIndex;

      store.setCurrentEdge(i, currentEdgeIndex);
      store.setEdgeRatio(i, newRatio);

      const points = edge.renderingPoints;
      if (!points?.length) continue;

      const pointIndex = Math.floor(newRatio * (points.length - 1));
      const nextPointIndex = Math.min(pointIndex + 1, points.length - 1);
      const localRatio = (newRatio * (points.length - 1)) - pointIndex;

      const p1 = points[pointIndex];
      const p2 = points[nextPointIndex];

      const x = p1.x + (p2.x - p1.x) * localRatio;
      const y = p1.y + (p2.y - p1.y) * localRatio;
      const z = getMarkerConfig().Z; // Fixed vehicle height

      let dx = p2.x - p1.x;
      let dy = p2.y - p1.y;

      const dirMagnitude = Math.hypot(dx, dy);
      if (dirMagnitude < 0.01 && pointIndex + 2 < points.length) {
        const p3 = points[pointIndex + 2];
        dx = p3.x - p1.x;
        dy = p3.y - p1.y;
      }

      const angle = Math.atan2(dy, dx);
      if (rigidBody) {
        const halfAngle = angle / 2;
        const quat = {
          x: 0,
          y: 0,
          z: Math.sin(halfAngle),
          w: Math.cos(halfAngle)
        };
        rigidBody.setTranslation({ x, y, z }, true);
        rigidBody.setRotation(quat, true);
      }
    }
  });

  // Only render VehicleRapierModeVehicle components in rapier mode
  // In array mode, VehiclesRenderer handles rendering
  return (
    <>
      {initialized && (
        <RapierVehiclesRenderer count={actualNumVehicles} />
      )}
    </>
  );
};

// Helper component to avoid "Array index in keys" lint error by abstracting the loop or using a stable ID source
// But since we just need 0..N, we can memoize the array of indices.
const RapierVehiclesRenderer = ({ count }: { count: number }) => {
  const vehicleIndices = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);

  return (
    <>
      {vehicleIndices.map((i) => (
        <VehicleRapierModeVehicle
          key={i} 
          vehicleIndex={i}
        />
      ))}
    </>
  );
};



function calculateMovementParameters(
  isCurve: boolean,
  velocity: number,
  delta: number
) {
  if (isCurve) {
    return {
      currentSpeed: getCurveMaxSpeed(),
      acceleration: 0,
    };
  }

  const linearMaxSpeed = getLinearMaxSpeed();
  const linearAccel = getLinearAcceleration();
  const currentSpeed = Math.min(linearMaxSpeed, velocity + linearAccel * delta);

  return {
    currentSpeed,
  };
}

function processEdgeTransitions(
  startRatio: number,
  startEdge: any,
  startEdgeIndex: number,
  vehicleIndex: number,
  loops: VehicleLoop[],
  edgeNameToIndex: Map<string, number>,
  edgeArray: any[]
) {
  let ratio = startRatio;
  let edge = startEdge;
  let edgeIndex = startEdgeIndex;

  while (ratio >= 1) {
    const overflow = (ratio - 1) * edge.distance;
    const vehicleLoop = loops.find((vl) => vl.vehicleIndex === vehicleIndex);
    if (!vehicleLoop) {
      break;
    }

    const currentEdgeName = edge.edge_name;
    const nextEdgeName = getNextEdgeInLoop(
      currentEdgeName,
      vehicleLoop.edgeSequence
    );
    const nextEdgeIndex = edgeNameToIndex.get(nextEdgeName);
    if (nextEdgeIndex === undefined) {
      break;
    }

    const nextEdge = edgeArray[nextEdgeIndex];
    if (!nextEdge?.distance) break;

    edgeIndex = nextEdgeIndex;
    edge = nextEdge;
    ratio = overflow / edge.distance;
  }

  return { edge, edgeIndex, ratio };
}

export default VehicleRapierMode;