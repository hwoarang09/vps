// shmSimulator/worker.entry.ts
// Worker thread entry point

import { SimulationEngine } from "./core/SimulationEngine";
import { DevLogger } from "@/logger/DevLogger";
import type { WorkerMessage, MainMessage, InitPayload, FabInitData, SimulationConfig, FabRenderAssignment } from "./types";

let engine: SimulationEngine | null = null;

function handleInit(payload: InitPayload): void {
  try {
    // DevLogger 초기화 (Worker 환경)
    DevLogger.init(`sim_${Date.now()}`);

    engine = new SimulationEngine();
    const fabVehicleCounts = engine.init(payload);

    const response: MainMessage = {
      type: "INITIALIZED",
      fabVehicleCounts,
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

function handleAddFab(fab: FabInitData, config: SimulationConfig): void {
  if (!engine) {
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
    return;
  }
  engine.handleCommand(fabId, payload);
}

function handleStart(): void {
  if (!engine) return;
  engine.start();

  const response: MainMessage = { type: "READY" };
  globalThis.postMessage(response);
}

function handleStop(): void {
  if (!engine) return;
  engine.stop();
}

function handlePause(): void {
  if (!engine) return;
  engine.stop();
}

function handleResume(): void {
  if (!engine) return;
  engine.start();
}

function handleDispose(): void {
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
    return;
  }
  engine.setRenderBuffers(vehicleRenderBuffer, sensorRenderBuffer, fabAssignments, totalVehicles);
}

function handleSetLoggerPort(port: MessagePort, workerId: number): void {
  console.log("[worker.entry] handleSetLoggerPort called, workerId:", workerId, "engine:", !!engine);
  if (!engine) {
    return;
  }
  engine.setLoggerPort(port, workerId);
  console.log("[worker.entry] setLoggerPort done");
}

function handleGetLockTable(fabId: string, requestId: string): void {
  if (!engine) {
    return;
  }
  const data = engine.getLockTableData(fabId);
  if (data) {
    const response: MainMessage = {
      type: "LOCK_TABLE",
      fabId,
      requestId,
      data,
    };
    globalThis.postMessage(response);
  }
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
      break;
    case "SET_RENDER_BUFFER":
      handleSetRenderBuffer(message.vehicleRenderBuffer, message.sensorRenderBuffer, message.fabAssignments, message.totalVehicles);
      break;
    case "SET_LOGGER_PORT":
      handleSetLoggerPort(message.port, message.workerId);
      break;
    case "GET_LOCK_TABLE":
      handleGetLockTable(message.fabId, message.requestId);
      break;
    default:
  }
};

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof ErrorEvent) return error.message;
  return 'Unknown error';
}

// Handle errors
globalThis.onerror = (error) => {
  const response: MainMessage = {
    type: "ERROR",
    error: getErrorMessage(error),
  };
  globalThis.postMessage(response);
};

