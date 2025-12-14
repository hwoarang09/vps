import { edgeVehicleQueue } from "@/store/vehicle/arrayMode/edgeVehicleQueue";
import { Edge } from "@/types/edge";
import { SensorData, VEHICLE_DATA_SIZE, MovementData } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { getBodyLength } from "@/config/vehicleConfig";
import { SENSOR_PRESETS } from "@/store/vehicle/arrayMode/sensorPresets";
import { determineLinearHitZone, applyCollisionZoneLogic } from "./collisionCommon";
import { checkSensorCollision } from "@/components/three/entities/vehicle/vehicleArrayMode/helpers/sensorCollision";

/**
 * 직선/곡선 공용 Following Collision 로직
 * 거리 계산 방식(Strategy)만 다름.
 */
export function verifyFollowingCollision(edgeIdx: number, edge: Edge, data: Float32Array) {
  const rawData = edgeVehicleQueue.getData(edgeIdx);
  if (!rawData || rawData[0] <= 1) return;

  const count = rawData[0];
  const vehicleLength = getBodyLength(); 

  // Iterate from 1 to count - 1 (앞차 vs 뒷차 쌍 비교)
  for (let i = 1; i < count; i++) {
    const frontVehId = rawData[1 + (i - 1)];
    const backVehId = rawData[1 + i];
    
    const ptrFront = frontVehId * VEHICLE_DATA_SIZE;
    const ptrBack = backVehId * VEHICLE_DATA_SIZE;
    
    // [핵심 변경점] 엣지 타입에 따라 검사 방식 분기
    let hitZone = -1;

    if (edge.vos_rail_type) {
       // --- 곡선인 경우: 센서 로직 직접 사용 ---
       // 거리 계산 없이 SAT 등 정밀 센서 로직 수행
       hitZone = checkSensorCollision(backVehId, frontVehId);

    } else {
       // --- 직선인 경우: 좌표 차이로 거리 계산 (최적화) ---
       const axisIdx = edge.axis === 'y' ? MovementData.Y : MovementData.X;
       const frontPos = data[ptrFront + axisIdx];
       const backPos = data[ptrBack + axisIdx];
       
       const distance = Math.abs(frontPos - backPos);
       
       const presetIdx = Math.trunc(data[ptrBack + SensorData.PRESET_IDX]);
       const preset = SENSOR_PRESETS[presetIdx] ?? SENSOR_PRESETS[0];

       const stopDist = preset.zones.stop.leftLength + vehicleLength;
       const brakeDist = preset.zones.brake.leftLength + vehicleLength;
       const approachDist = preset.zones.approach.leftLength + vehicleLength;

       hitZone = determineLinearHitZone(distance, stopDist, brakeDist, approachDist);
    }

    applyCollisionZoneLogic(hitZone, data, ptrBack);
  }
}
