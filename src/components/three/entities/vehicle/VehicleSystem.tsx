import { Physics } from "@react-three/rapier";
import VehicleRapierMode from "./vehicleRapierMode/VehicleRapierMode";
import VehicleArrayMode from "./vehicleArrayMode/vehicleArrayMode";
import VehicleSharedMemoryMode from "./vehicleSharedMode/VehicleSharedMemoryMode";
import VehiclesRenderer from "../renderers/VehiclesRenderer/VehiclesRenderer";
import { VehicleSystemType } from '@/types/vehicle';
import { getRapierModeConfig } from "@/config/visualizationConfig";
import VehicleSelector from "../../interaction/VehicleSelector";

/**
 * VehicleSystem
 * - Unified component that combines vehicle logic and rendering
 * - Supports 3 modes: rapier-dict, array-single, shared-memory
 * - Easy mode switching for performance comparison
 */

interface VehicleSystemProps {
  mode: VehicleSystemType;
  numVehicles?: number;
  maxVehicles?: number;
}

const VehicleSystem: React.FC<VehicleSystemProps> = ({
  mode,
  numVehicles = 100,
}) => {
  const needsPhysics = mode === VehicleSystemType.RapierDict;
  const rapierConfig = getRapierModeConfig();

  const content = (
    <>
      {/* Rapier Dict mode: logic + rendering separated */}
      {mode === VehicleSystemType.RapierDict && (
        <>
          <VehicleRapierMode
            numVehicles={numVehicles}
            mode="rapier"
          />
          <VehiclesRenderer
            mode={mode}
            numVehicles={numVehicles}
          />
        </>
      )}

      {/* Array Single mode: logic + rendering separated */}
      {mode === VehicleSystemType.ArraySingle && (
        <>
          <VehicleArrayMode numVehicles={numVehicles} />
          <VehiclesRenderer
            mode={mode}
            numVehicles={numVehicles}
          />
          <VehicleSelector />
        </>
      )}

      {/* Shared Memory mode: logic + rendering separated */}
      {mode === VehicleSystemType.SharedMemory && (
        <>
          <VehicleSharedMemoryMode numVehicles={numVehicles} />
          <VehiclesRenderer
            mode={mode}
            numVehicles={numVehicles}
          />
          <VehicleSelector />
        </>
      )}
    </>
  );

  if (needsPhysics) {
    return (
      <Physics gravity={[0, 0, 0]} debug={rapierConfig.SHOW_PHYSICS_DEBUG}>
        {content}
      </Physics>
    );
  }

  return content;
};

export default VehicleSystem;