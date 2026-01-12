// shmSimulator/worker.entry.ts
// Worker thread entry point

import { SimulationEngine } from "./core/SimulationEngine";
import type { WorkerMessage, MainMessage, InitPayload, FabInitData, SimulationConfig, FabRenderAssignment } from "./types";

let engine: SimulationEngine | null = null;

function handleInit(payload: InitPayload): void {
  try {
    console.log("[Worker] Received INIT message");

    engine = new SimulationEngine();
    const fabVehicleCounts = engine.init(payload);

    const response: MainMessage = {
      type: "INITIALIZED",
      fabVehicleCounts,
    };
    globalThis.postMessage(response);

    console.log("[Worker] Engine initialized, sending INITIALIZED response");
  } catch (error) {
    const errorResponse: MainMessage = {
      type: "ERROR",
      error: error instanceof Error ? error.message : String(error),
    };
    globalThis.postMessage(errorResponse);
  }
}

function handleAddFab(fab: FabInitData, config: SimulationConfig): void {
  if (!engine) {
    console.warn("[Worker] Engine not initialized");
    return;
  }

  try {
    const actualNumVehicles = engine.addFab(fab, config);
    const response: MainMessage = {
      type: "FAB_ADDED",
      fabId: fab.fabId,
      actualNumVehicles,
    };
    globalThis.postMessage(response);
  } catch (error) {
    const errorResponse: MainMessage = {
      type: "ERROR",
      error: error instanceof Error ? error.message : String(error),
    };
    globalThis.postMessage(errorResponse);
  }
}

function handleRemoveFab(fabId: string): void {
  if (!engine) {
    console.warn("[Worker] Engine not initialized");
    return;
  }

  const success = engine.removeFab(fabId);
  if (success) {
    const response: MainMessage = {
      type: "FAB_REMOVED",
      fabId,
    };
    globalThis.postMessage(response);
  }
}

function handleCommand(fabId: string, payload: unknown): void {
  if (!engine) {
    console.warn("[Worker] Engine not initialized");
    return;
  }
  engine.handleCommand(fabId, payload);
}

function handleStart(): void {
  if (!engine) return;
  console.log("[Worker] Starting simulation");
  engine.start();

  const response: MainMessage = { type: "READY" };
  globalThis.postMessage(response);
}

function handleStop(): void {
  if (!engine) return;
  console.log("[Worker] Stopping simulation");
  engine.stop();
}

function handlePause(): void {
  if (!engine) return;
  console.log("[Worker] Pausing simulation");
  engine.stop();
}

function handleResume(): void {
  if (!engine) return;
  console.log("[Worker] Resuming simulation");
  engine.start();
}

function handleDispose(): void {
  console.log("[Worker] Disposing engine");
  if (engine) {
    engine.dispose();
    engine = null;
  }
  const response: MainMessage = { type: "DISPOSED" };
  globalThis.postMessage(response);
}

function handleSetRenderBuffer(
  vehicleRenderBuffer: SharedArrayBuffer,
  sensorRenderBuffer: SharedArrayBuffer,
  fabAssignments: FabRenderAssignment[],
  totalVehicles: number
): void {
  if (!engine) {
    console.warn("[Worker] Engine not initialized");
    return;
  }
  console.log(`[Worker] Setting render buffers, total=${totalVehicles}`);
  engine.setRenderBuffers(vehicleRenderBuffer, sensorRenderBuffer, fabAssignments, totalVehicles);
}

// Handle messages from main thread
globalThis.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const message = e.data;

  switch (message.type) {
    case "INIT":
      handleInit(message.payload);
      break;
    case "START":
      handleStart();
      break;
    case "STOP":
      handleStop();
      break;
    case "PAUSE":
      handlePause();
      break;
    case "RESUME":
      handleResume();
      break;
    case "DISPOSE":
      handleDispose();
      break;
    case "COMMAND":
      handleCommand(message.fabId, message.payload);
      break;
    case "ADD_FAB":
      handleAddFab(message.fab, message.config);
      break;
    case "REMOVE_FAB":
      handleRemoveFab(message.fabId);
      break;
    case "SET_TRANSFER_MODE":
      // TODO: Implement per-fab transfer mode change
      console.log(`[Worker] SET_TRANSFER_MODE for fab ${message.fabId}: ${message.mode}`);
      break;
    case "SET_RENDER_BUFFER":
      handleSetRenderBuffer(message.vehicleRenderBuffer, message.sensorRenderBuffer, message.fabAssignments, message.totalVehicles);
      break;
    default:
      console.warn("[Worker] Unknown message type:", (message as { type: string }).type);
  }
};

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof ErrorEvent) return error.message;
  return 'Unknown error';
}

// Handle errors
globalThis.onerror = (error) => {
  console.error("[Worker] Unhandled error:", error);
  const response: MainMessage = {
    type: "ERROR",
    error: getErrorMessage(error),
  };
  globalThis.postMessage(response);
};

console.log("[Worker] SHM Simulator worker initialized");
