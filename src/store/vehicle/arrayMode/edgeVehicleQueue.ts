// store/vehicle/arrayMode/edgeVehicleQueue.ts
// Re-export from common with singleton instance

import { EdgeVehicleQueue } from "@/common/vehicle/memory/EdgeVehicleQueue";

export { EdgeVehicleQueue };
export default EdgeVehicleQueue;

// Singleton instance (200000 edges max)
export const edgeVehicleQueue = new EdgeVehicleQueue(200000);
