import { useVehicleRapierStore } from "@/store/vehicle/rapierMode/vehicleStore";
import VehicleRapierRenderer from "./VehicleRapierRenderer";
import VehicleArrayRenderer from "./VehicleArrayRenderer";
import { VehicleSystemType } from "@/types/vehicle";

/**
 * VehiclesRenderer
 * - Router component that selects the appropriate renderer based on mode
 * - Supports 3 modes: rapier-dict, array-single, shared-memory
 * - array-single and shared-memory use unified VehicleArrayRenderer
 */

interface VehiclesRendererProps {
  mode: VehicleSystemType;
  numVehicles: number;
}

const VehiclesRenderer: React.FC<VehiclesRendererProps> = ({
  mode,
  numVehicles,
}) => {
  // Get actualNumVehicles from rapierStore for rapier-dict mode
  const rapierActualNumVehicles = useVehicleRapierStore((state) => state.actualNumVehicles);


  // Route to appropriate renderer based on mode
  if (mode === VehicleSystemType.RapierDict) {
    return <VehicleRapierRenderer actualNumVehicles={rapierActualNumVehicles} />;
  } else if (mode === VehicleSystemType.ArraySingle || mode === VehicleSystemType.SharedMemory) {
    // Unified renderer for both array-single and shared-memory modes
    return <VehicleArrayRenderer mode={mode} />;
  }

  return null;
};

export default VehiclesRenderer;

