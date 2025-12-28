// shmSimulator/collisionLogic/verifyFollowingCollision.ts

import type { Edge } from "@/types/edge";
import { SensorData, VEHICLE_DATA_SIZE, MovementData } from "../memory/vehicleDataArray";
import { SENSOR_PRESETS } from "../memory/sensorPresets";
import { determineLinearHitZone, applyCollisionZoneLogic } from "./collisionCommon";
import { checkSensorCollision } from "../helpers/sensorCollision";
import type { CollisionCheckContext } from "./collisionCheck";

export function verifyFollowingCollision(
  edgeIdx: number,
  edge: Edge,
  ctx: CollisionCheckContext
) {
  const { vehicleArrayData, edgeVehicleQueue, sensorPointArray, config } = ctx;

  const rawData = edgeVehicleQueue.getData(edgeIdx);
  if (!rawData || rawData[0] <= 1) return;

  const count = rawData[0];
  const vehicleLength = config.bodyLength;

  for (let i = 1; i < count; i++) {
    const frontVehId = rawData[1 + (i - 1)];
    const backVehId = rawData[1 + i];

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

    applyCollisionZoneLogic(hitZone, vehicleArrayData, ptrBack, frontVehId);
  }
}
