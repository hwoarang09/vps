// shmSimulator/collisionLogic/collisionCheck.ts

import EdgeVehicleQueue from "../memory/edgeVehicleQueue";
import SensorPointArray from "../memory/sensorPointArray";
import type { Edge } from "@/types/edge";
import { EdgeType } from "@/types";
import type { SimulationConfig } from "../types";

import { verifyLinearCollision } from "./verifyLinearCollision";
import { verifyCurveCollision } from "./verifyCurveCollision";

export interface CollisionCheckContext {
  vehicleArrayData: Float32Array;
  edgeArray: Edge[];
  edgeVehicleQueue: EdgeVehicleQueue;
  sensorPointArray: SensorPointArray;
  config: SimulationConfig;
}

export function checkCollisions(ctx: CollisionCheckContext) {
  const { vehicleArrayData, edgeArray, edgeVehicleQueue } = ctx;

  for (let edgeIdx = 0; edgeIdx < edgeArray.length; edgeIdx++) {
    const edge = edgeArray[edgeIdx];
    if (!edge) continue;

    const count = edgeVehicleQueue.getCount(edgeIdx);
    if (count === 0) continue;

    if (edge.vos_rail_type === EdgeType.LINEAR) {
      verifyLinearCollision(edgeIdx, edge, ctx);
    } else {
      verifyCurveCollision(edgeIdx, edge, ctx);
    }
  }
}
