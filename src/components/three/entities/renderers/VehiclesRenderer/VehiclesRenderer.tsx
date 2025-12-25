import { useVehicleRapierStore } from "../../../../../store/vehicle/rapierMode/vehicleStore";
import VehicleRapierRenderer from "./VehicleRapierRenderer";
import VehicleArrayRenderer from "./VehicleArrayRenderer";
import VehicleSharedRenderer from "./VehicleSharedRenderer";
import { VehicleSystemType } from "../../../../../types/vehicle";

/**
 * VehiclesRenderer
 * - Router component that selects the appropriate renderer based on mode
 * - Supports 3 modes: rapier-dict, array-single, shared-memory
 * - Each mode has its own dedicated renderer
 */

interface VehiclesRendererProps {
  mode: VehicleSystemType;
  numVehicles: number;
  actualNumVehicles?: number; // For array-single mode
}

const VehiclesRenderer: React.FC<VehiclesRendererProps> = ({
  mode,
  numVehicles,
  actualNumVehicles: propActualNumVehicles,
}) => {
  // Get actualNumVehicles from rapierStore for rapier-dict mode
  const rapierActualNumVehicles = useVehicleRapierStore((state) => state.actualNumVehicles);

  console.log(`[VehiclesRenderer] mode: ${mode}, numVehicles: ${numVehicles}, propActualNumVehicles: ${propActualNumVehicles}, rapierActualNumVehicles: ${rapierActualNumVehicles}`);

  // Route to appropriate renderer based on mode
  if (mode === VehicleSystemType.RapierDict) {
    return <VehicleRapierRenderer actualNumVehicles={rapierActualNumVehicles} />;
  } else if (mode === VehicleSystemType.ArraySingle) {
    // VehicleArrayRenderer will read actualNumVehicles from store
    return <VehicleArrayRenderer />;
  } else if (mode === VehicleSystemType.SharedMemory) {
    return <VehicleSharedRenderer numVehicles={numVehicles} />;
  }

  console.warn(`[VehiclesRenderer] Unknown mode: ${mode}`);
  return null;
};

export default VehiclesRenderer;

