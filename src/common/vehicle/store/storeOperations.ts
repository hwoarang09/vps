// common/vehicle/store/storeOperations.ts
// Shared store operations for EngineStore and VehicleArrayStore

import type { VehicleDataArrayBase } from "../memory/VehicleDataArrayBase";
import type { EdgeVehicleQueue } from "../memory/EdgeVehicleQueue";

export interface AddVehicleData {
  x: number;
  y: number;
  z: number;
  edgeIndex: number;
  edgeRatio?: number;
  rotation?: number;
  velocity?: number;
  acceleration?: number;
  deceleration?: number;
  movingStatus?: number;
}

/**
 * Add a vehicle to the store
 */
export function addVehicle(
  vehicleDataArray: VehicleDataArrayBase,
  edgeVehicleQueue: EdgeVehicleQueue,
  vehicleIndex: number,
  data: AddVehicleData
): void {
  const vehicle = vehicleDataArray.get(vehicleIndex);

  vehicle.movement.x = data.x;
  vehicle.movement.y = data.y;
  vehicle.movement.z = data.z;
  vehicle.movement.rotation = data.rotation ?? 0;
  vehicle.movement.velocity = data.velocity ?? 0;
  vehicle.movement.acceleration = data.acceleration ?? 0;
  vehicle.movement.deceleration = data.deceleration ?? 0;
  vehicle.movement.edgeRatio = data.edgeRatio ?? 0;
  vehicle.movement.movingStatus = data.movingStatus ?? 0;
  vehicle.movement.currentEdge = data.edgeIndex;
  vehicle.sensor.hitZone = -1;

  edgeVehicleQueue.addVehicle(data.edgeIndex, vehicleIndex);
}

/**
 * Remove a vehicle from the store
 */
export function removeVehicle(
  vehicleDataArray: VehicleDataArrayBase,
  edgeVehicleQueue: EdgeVehicleQueue,
  vehicleIndex: number
): void {
  const currentEdge = vehicleDataArray.get(vehicleIndex).movement.currentEdge;

  if (currentEdge !== -1) {
    edgeVehicleQueue.removeVehicle(currentEdge, vehicleIndex);
  }

  vehicleDataArray.clearVehicle(vehicleIndex);
}

/**
 * Move a vehicle to a new edge
 */
export function moveVehicleToEdge(
  vehicleDataArray: VehicleDataArrayBase,
  edgeVehicleQueue: EdgeVehicleQueue,
  vehicleIndex: number,
  newEdgeIndex: number,
  edgeRatio: number = 0
): void {
  const vehicle = vehicleDataArray.get(vehicleIndex);
  const oldEdge = vehicle.movement.currentEdge;

  if (oldEdge !== -1) {
    edgeVehicleQueue.removeVehicle(oldEdge, vehicleIndex);
  }

  edgeVehicleQueue.addVehicle(newEdgeIndex, vehicleIndex);
  vehicle.movement.currentEdge = newEdgeIndex;
  vehicle.movement.edgeRatio = edgeRatio;
}

/**
 * Clear all vehicles from the store
 */
export function clearAllVehicles(
  vehicleDataArray: VehicleDataArrayBase,
  edgeVehicleQueue: EdgeVehicleQueue,
  logPrefix: string = "[Store]"
): void {
  edgeVehicleQueue.clearAll();
  vehicleDataArray.clearAll();
  console.log(`${logPrefix} All vehicles cleared`);
}

/**
 * Set vehicle position
 */
export function setVehiclePosition(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number,
  x: number,
  y: number,
  z: number
): void {
  const vehicle = vehicleDataArray.get(vehicleIndex);
  vehicle.movement.x = x;
  vehicle.movement.y = y;
  vehicle.movement.z = z;
}

/**
 * Set vehicle velocity
 */
export function setVehicleVelocity(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number,
  velocity: number
): void {
  vehicleDataArray.get(vehicleIndex).movement.velocity = velocity;
}

/**
 * Set vehicle rotation
 */
export function setVehicleRotation(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number,
  rotation: number
): void {
  vehicleDataArray.get(vehicleIndex).movement.rotation = rotation;
}

/**
 * Set vehicle moving status
 */
export function setVehicleMovingStatus(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number,
  status: number
): void {
  vehicleDataArray.get(vehicleIndex).movement.movingStatus = status;
}

/**
 * Set vehicle acceleration
 */
export function setVehicleAcceleration(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number,
  acceleration: number
): void {
  vehicleDataArray.get(vehicleIndex).movement.acceleration = acceleration;
}

/**
 * Set vehicle deceleration
 */
export function setVehicleDeceleration(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number,
  deceleration: number
): void {
  vehicleDataArray.get(vehicleIndex).movement.deceleration = deceleration;
}

/**
 * Set vehicle edge ratio
 */
export function setVehicleEdgeRatio(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number,
  edgeRatio: number
): void {
  vehicleDataArray.get(vehicleIndex).movement.edgeRatio = edgeRatio;
}

/**
 * Set vehicle current edge
 */
export function setVehicleCurrentEdge(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number,
  edgeIndex: number
): void {
  vehicleDataArray.get(vehicleIndex).movement.currentEdge = edgeIndex;
}

/**
 * Get vehicle current edge
 */
export function getVehicleCurrentEdge(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number
): number {
  return vehicleDataArray.get(vehicleIndex).movement.currentEdge;
}

/**
 * Get vehicle moving status
 */
export function getVehicleMovingStatus(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number
): number {
  return vehicleDataArray.get(vehicleIndex).movement.movingStatus;
}

/**
 * Get vehicle edge ratio
 */
export function getVehicleEdgeRatio(
  vehicleDataArray: VehicleDataArrayBase,
  vehicleIndex: number
): number {
  return vehicleDataArray.get(vehicleIndex).movement.edgeRatio;
}
