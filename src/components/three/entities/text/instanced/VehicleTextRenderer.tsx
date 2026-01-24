import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { vehicleDataArray, VEHICLE_DATA_SIZE, MovementData } from "@/store/vehicle/arrayMode/vehicleDataArray";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";
import { VEHICLE_RENDER_SIZE } from "@/shmSimulator/MemoryLayoutManager";
import { CHAR_COUNT } from "./useDigitMaterials";
import {
  applyHighAltitudeCulling,
  updateVehicleTextTransforms,
  buildVehicleSlotData,
  SlotData
} from "./instancedTextUtils";
import { BaseInstancedText } from "./BaseInstancedText";
import { VehicleSystemType } from "@/types/vehicle";
import { RENDER_ORDER_TEXT } from "@/utils/renderOrder";
import { getVehicleRenderConfig } from "@/config/renderConfig";

const LOD_DIST_SQ = 20 * 20;
const CAM_HEIGHT_CUTOFF = 50;
const LABEL_LENGTH = 8; // VEH00001

// SharedMemory 모드 레이아웃: [x, y, z, rotation]
const SHM_LAYOUT = {
  VEHICLE_DATA_SIZE: VEHICLE_RENDER_SIZE,
  MovementData_X: 0,
  MovementData_Y: 1,
  MovementData_Z: 2,
};

// Array 모드 레이아웃
const ARRAY_LAYOUT = {
  VEHICLE_DATA_SIZE,
  MovementData_X: MovementData.X,
  MovementData_Y: MovementData.Y,
  MovementData_Z: MovementData.Z,
};

interface Props {
  numVehicles: number;
  mode: VehicleSystemType;
  scale?: number;
  color?: string;
  zOffset?: number;
}

const VehicleTextRenderer: React.FC<Props> = ({
  numVehicles,
  mode,
  scale = 0.5,
  color = "#ffffff",
  zOffset = 1,
}) => {
  const vehicleConfig = getVehicleRenderConfig();
  const isSharedMemory = mode === VehicleSystemType.SharedMemory;
  const isVisible = vehicleConfig.text.visible;

  // 슬롯 데이터 계산 (Render Phase) - hooks는 항상 호출되어야 함
  const slotData = useMemo(() => {
    if (!isVisible) return null;
    return buildVehicleSlotData(numVehicles, LABEL_LENGTH);
  }, [numVehicles, isVisible]);

  const instRefs = useRef<(THREE.InstancedMesh | null)[]>(new Array(CHAR_COUNT).fill(null));

  // 렌더링 루프 - hooks는 항상 호출되어야 함
  useFrame(({ camera }) => {
    // visibility 체크는 hook 내부에서
    if (!isVisible) return;
    const D = slotData;
    if (!D || numVehicles === 0) return;

    const vehicleData = isSharedMemory
      ? useShmSimulatorStore.getState().getVehicleData()
      : vehicleDataArray.getData();
    if (!vehicleData) return;

    const { z: cz } = camera.position;

    // 고도 컬링
    if (applyHighAltitudeCulling(cz, CAM_HEIGHT_CUTOFF, D, instRefs.current)) {
      return;
    }

    const charSpacing = 0.15 * scale;
    const halfLen = (LABEL_LENGTH - 1) / 2;

    updateVehicleTextTransforms(
      D as Required<SlotData>,
      vehicleData,
      camera,
      instRefs.current,
      {
        scale,
        charSpacing,
        halfLen,
        zOffset,
        lodDistSq: LOD_DIST_SQ,
      },
      isSharedMemory ? SHM_LAYOUT : ARRAY_LAYOUT
    );
  });

  // Early return AFTER all hooks have been called
  if (!isVisible) {
    return null;
  }

  return (
    <BaseInstancedText
      data={slotData}
      instRefs={instRefs}
      color={color}
      renderOrder={RENDER_ORDER_TEXT}
    />
  );
};

export default VehicleTextRenderer;