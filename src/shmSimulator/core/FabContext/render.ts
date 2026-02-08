// FabContext/render.ts
// Render buffer 쓰기 로직

import { MovementData, VEHICLE_DATA_SIZE } from "@/common/vehicle/memory/VehicleDataArrayBase";
import { SENSOR_DATA_SIZE, SENSOR_POINT_SIZE, SensorPoint } from "@/common/vehicle/memory/SensorPointArrayBase";
import { VEHICLE_RENDER_SIZE, SENSOR_ATTR_SIZE } from "../../MemoryLayoutManager";
import type { SensorSectionOffsets } from "./types";

/**
 * Write vehicle and sensor data to render buffer with fab offset applied
 *
 * 센서 렌더 버퍼 레이아웃 (섹션별 연속 - set() 최적화 가능):
 *
 * Section 0: zone0_startEnd - [Veh0_FL,FR | Veh1_FL,FR | ... | VehN_FL,FR]
 * Section 1: zone0_other    - [Veh0_SL,SR | Veh1_SL,SR | ... | VehN_SL,SR]
 * Section 2: zone1_startEnd - [...]
 * Section 3: zone1_other    - [...]
 * Section 4: zone2_startEnd - [...]
 * Section 5: zone2_other    - [...]
 * Section 6: body_other     - [Veh0_BL,BR | Veh1_BL,BR | ... | VehN_BL,BR]
 *
 * 총: 7 sections × totalVehicles × 4 floats
 *
 * 멀티 Fab 환경에서 각 Fab은 전체 버퍼에서 자기 vehicle 위치에 복사
 */
export function writeToRenderRegion(
  vehicleRenderData: Float32Array | null,
  sensorRenderData: Float32Array | null,
  workerVehicleData: Float32Array,
  workerSensorData: Float32Array,
  actualNumVehicles: number,
  fabOffsetX: number,
  fabOffsetY: number,
  sectionOffsets: SensorSectionOffsets | null
): void {
  if (!vehicleRenderData || !sensorRenderData) {
    return;
  }

  const numVeh = actualNumVehicles;

  // === Vehicle Render Data ===
  for (let i = 0; i < numVeh; i++) {
    const workerPtr = i * VEHICLE_DATA_SIZE;
    const renderPtr = i * VEHICLE_RENDER_SIZE;

    vehicleRenderData[renderPtr + 0] = workerVehicleData[workerPtr + MovementData.X] + fabOffsetX;
    vehicleRenderData[renderPtr + 1] = workerVehicleData[workerPtr + MovementData.Y] + fabOffsetY;
    vehicleRenderData[renderPtr + 2] = workerVehicleData[workerPtr + MovementData.Z];
    vehicleRenderData[renderPtr + 3] = workerVehicleData[workerPtr + MovementData.ROTATION];
  }

  // === Sensor Render Data (섹션별 연속 레이아웃) ===

  // 사전 계산된 섹션 오프셋 사용 (매 프레임 재계산 방지)
  if (!sectionOffsets) return; // Early exit if not initialized
  const {
    zone0StartEndBase,
    zone0OtherBase,
    zone1StartEndBase,
    zone1OtherBase,
    zone2StartEndBase,
    zone2OtherBase,
    bodyOtherBase,
  } = sectionOffsets;

  for (let i = 0; i < numVeh; i++) {
    const vehPtr = i * SENSOR_ATTR_SIZE; // 4 floats per vehicle in each section

    // Zone 0
    const zone0Src = i * SENSOR_DATA_SIZE + 0 * SENSOR_POINT_SIZE;
    // startEnd: FL, FR
    sensorRenderData[zone0StartEndBase + vehPtr + 0] = workerSensorData[zone0Src + SensorPoint.FL_X] + fabOffsetX;
    sensorRenderData[zone0StartEndBase + vehPtr + 1] = workerSensorData[zone0Src + SensorPoint.FL_Y] + fabOffsetY;
    sensorRenderData[zone0StartEndBase + vehPtr + 2] = workerSensorData[zone0Src + SensorPoint.FR_X] + fabOffsetX;
    sensorRenderData[zone0StartEndBase + vehPtr + 3] = workerSensorData[zone0Src + SensorPoint.FR_Y] + fabOffsetY;
    // other: SL, SR
    sensorRenderData[zone0OtherBase + vehPtr + 0] = workerSensorData[zone0Src + SensorPoint.SL_X] + fabOffsetX;
    sensorRenderData[zone0OtherBase + vehPtr + 1] = workerSensorData[zone0Src + SensorPoint.SL_Y] + fabOffsetY;
    sensorRenderData[zone0OtherBase + vehPtr + 2] = workerSensorData[zone0Src + SensorPoint.SR_X] + fabOffsetX;
    sensorRenderData[zone0OtherBase + vehPtr + 3] = workerSensorData[zone0Src + SensorPoint.SR_Y] + fabOffsetY;

    // Zone 1
    const zone1Src = i * SENSOR_DATA_SIZE + 1 * SENSOR_POINT_SIZE;
    sensorRenderData[zone1StartEndBase + vehPtr + 0] = workerSensorData[zone1Src + SensorPoint.FL_X] + fabOffsetX;
    sensorRenderData[zone1StartEndBase + vehPtr + 1] = workerSensorData[zone1Src + SensorPoint.FL_Y] + fabOffsetY;
    sensorRenderData[zone1StartEndBase + vehPtr + 2] = workerSensorData[zone1Src + SensorPoint.FR_X] + fabOffsetX;
    sensorRenderData[zone1StartEndBase + vehPtr + 3] = workerSensorData[zone1Src + SensorPoint.FR_Y] + fabOffsetY;
    sensorRenderData[zone1OtherBase + vehPtr + 0] = workerSensorData[zone1Src + SensorPoint.SL_X] + fabOffsetX;
    sensorRenderData[zone1OtherBase + vehPtr + 1] = workerSensorData[zone1Src + SensorPoint.SL_Y] + fabOffsetY;
    sensorRenderData[zone1OtherBase + vehPtr + 2] = workerSensorData[zone1Src + SensorPoint.SR_X] + fabOffsetX;
    sensorRenderData[zone1OtherBase + vehPtr + 3] = workerSensorData[zone1Src + SensorPoint.SR_Y] + fabOffsetY;

    // Zone 2
    const zone2Src = i * SENSOR_DATA_SIZE + 2 * SENSOR_POINT_SIZE;
    sensorRenderData[zone2StartEndBase + vehPtr + 0] = workerSensorData[zone2Src + SensorPoint.FL_X] + fabOffsetX;
    sensorRenderData[zone2StartEndBase + vehPtr + 1] = workerSensorData[zone2Src + SensorPoint.FL_Y] + fabOffsetY;
    sensorRenderData[zone2StartEndBase + vehPtr + 2] = workerSensorData[zone2Src + SensorPoint.FR_X] + fabOffsetX;
    sensorRenderData[zone2StartEndBase + vehPtr + 3] = workerSensorData[zone2Src + SensorPoint.FR_Y] + fabOffsetY;
    sensorRenderData[zone2OtherBase + vehPtr + 0] = workerSensorData[zone2Src + SensorPoint.SL_X] + fabOffsetX;
    sensorRenderData[zone2OtherBase + vehPtr + 1] = workerSensorData[zone2Src + SensorPoint.SL_Y] + fabOffsetY;
    sensorRenderData[zone2OtherBase + vehPtr + 2] = workerSensorData[zone2Src + SensorPoint.SR_X] + fabOffsetX;
    sensorRenderData[zone2OtherBase + vehPtr + 3] = workerSensorData[zone2Src + SensorPoint.SR_Y] + fabOffsetY;

    // Body other: BL, BR from zone0
    sensorRenderData[bodyOtherBase + vehPtr + 0] = workerSensorData[zone0Src + SensorPoint.BL_X] + fabOffsetX;
    sensorRenderData[bodyOtherBase + vehPtr + 1] = workerSensorData[zone0Src + SensorPoint.BL_Y] + fabOffsetY;
    sensorRenderData[bodyOtherBase + vehPtr + 2] = workerSensorData[zone0Src + SensorPoint.BR_X] + fabOffsetX;
    sensorRenderData[bodyOtherBase + vehPtr + 3] = workerSensorData[zone0Src + SensorPoint.BR_Y] + fabOffsetY;
  }
}
