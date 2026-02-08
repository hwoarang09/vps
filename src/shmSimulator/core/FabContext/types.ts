// FabContext/types.ts
// Type definitions for FabContext

import type { Edge } from "@/types/edge";
import type { Node } from "@/types";
import type {
  SimulationConfig,
  TransferMode,
  VehicleInitConfig,
  FabMemoryAssignment,
  SharedMapRef,
  FabRenderOffset,
} from "../../types";
import type { StationRawData } from "@/types/station";

export interface FabInitParams {
  fabId: string;
  sharedBuffer: SharedArrayBuffer;
  sensorPointBuffer: SharedArrayBuffer;
  pathBuffer: SharedArrayBuffer;
  checkpointBuffer: SharedArrayBuffer;
  edges?: Edge[];
  nodes?: Node[];
  stationData?: StationRawData[];
  sharedMapRef?: SharedMapRef;
  fabOffset?: FabRenderOffset;
  config: SimulationConfig;
  vehicleConfigs: VehicleInitConfig[];
  numVehicles: number;
  transferMode: TransferMode;
  memoryAssignment?: FabMemoryAssignment;
}

/**
 * Sensor 섹션 오프셋 (매 프레임 재계산 방지용)
 */
export interface SensorSectionOffsets {
  sectionSize: number;
  fabOffsetValue: number;
  zone0StartEndBase: number;
  zone0OtherBase: number;
  zone1StartEndBase: number;
  zone1OtherBase: number;
  zone2StartEndBase: number;
  zone2OtherBase: number;
  bodyOtherBase: number;
}
