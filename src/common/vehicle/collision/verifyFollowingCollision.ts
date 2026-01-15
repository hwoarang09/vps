// common/vehicle/collision/verifyFollowingCollision.ts

import type { Edge } from "@/types/edge";
import { SensorData, VEHICLE_DATA_SIZE, MovementData } from "@/common/vehicle/initialize/constants";
import { SENSOR_PRESETS } from "./sensorPresets";
import { determineLinearHitZone, applyCollisionZoneLogic } from "./collisionCommon";
import { checkSensorCollision } from "./sensorCollision";
import type { CollisionCheckContext } from "./collisionCheck";

export function verifyFollowingCollision(
  edgeIdx: number,
  edge: Edge,
  ctx: CollisionCheckContext
) {
  const { vehicleArrayData, edgeVehicleQueue, sensorPointArray, config } = ctx;

  // Direct access for performance (avoid subarray overhead)
  const queueData = edgeVehicleQueue.getDataDirect();
  const offset = edgeVehicleQueue.getOffsetForEdge(edgeIdx);
  const count = queueData[offset];

  if (count <= 1) return;

  const vehicleLength = config.bodyLength;

  for (let i = 1; i < count; i++) {
    const frontVehId = queueData[offset + 1 + (i - 1)];
    const backVehId = queueData[offset + 1 + i];

    const ptrFront = frontVehId * VEHICLE_DATA_SIZE;
    const ptrBack = backVehId * VEHICLE_DATA_SIZE;

    let hitZone = -1;

    if (edge.vos_rail_type) {
      hitZone = checkSensorCollision(sensorPointArray, backVehId, frontVehId);
    } else {
      const axisIdx = edge.axis === "y" ? MovementData.Y : MovementData.X;
      const frontPos = vehicleArrayData[ptrFront + axisIdx];
      const backPos = vehicleArrayData[ptrBack + axisIdx];

      const distance = Math.abs(frontPos - backPos);

      const presetIdx = Math.trunc(vehicleArrayData[ptrBack + SensorData.PRESET_IDX]);
      const preset = SENSOR_PRESETS[presetIdx] ?? SENSOR_PRESETS[0];

      const stopDist = preset.zones.stop.leftLength + vehicleLength;
      const brakeDist = preset.zones.brake.leftLength + vehicleLength;
      const approachDist = preset.zones.approach.leftLength + vehicleLength;

      hitZone = determineLinearHitZone(distance, stopDist, brakeDist, approachDist);
    }

    applyCollisionZoneLogic(hitZone, vehicleArrayData, ptrBack, frontVehId, {
      approachMinSpeed: config.approachMinSpeed,
      brakeMinSpeed: config.brakeMinSpeed,
    });
  }
}
