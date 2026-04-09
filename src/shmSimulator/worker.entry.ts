// shmSimulator/worker.entry.ts
// Worker thread entry point

import { SimulationEngine } from "./core/SimulationEngine";
import type { WorkerMessage, MainMessage, InitPayload, FabInitData, SimulationConfig, FabRenderAssignment } from "./types";

let engine: SimulationEngine | null = null;

async function handleInit(payload: InitPayload): Promise<void> {
  try {
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

async function handleSetLoggerPort(port: MessagePort, workerId: number): Promise<void> {
  console.log(`[worker.entry] SET_LOGGER_PORT received: workerId=${workerId}, engine=${!!engine}`);
  if (!engine) {
    console.log(`[worker.entry] SET_LOGGER_PORT SKIPPED: no engine`);
    return;
  }
  await engine.setLoggerPort(port, workerId);
  console.log(`[worker.entry] SET_LOGGER_PORT done`);
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
globalThis.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const message = e.data;

  switch (message.type) {
    case "INIT":
      await handleInit(message.payload);
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
      if (engine) {
        const ctx = engine.getFabContext(message.fabId);
        if (ctx) {
          ctx.setTransferMode(message.mode);
        }
      }
      break;
    case "SET_TRANSFER_ENABLED":
      console.log(`[worker.entry] SET_TRANSFER_ENABLED received: enabled=${message.enabled}, fabId=${message.fabId}, engine=${!!engine}`);
      if (engine) {
        if (message.fabId) {
          const ctx = engine.getFabContext(message.fabId);
          console.log(`[worker.entry] SET_TRANSFER_ENABLED: ctx found=${!!ctx} for fabId=${message.fabId}`);
          if (ctx) ctx.setTransferEnabled(message.enabled);
        } else {
          engine.forEachFab((ctx) => ctx.setTransferEnabled(message.enabled));
        }
      }
      break;
    case "SET_TRANSFER_RATE":
      if (engine) {
        if (message.fabId) {
          const ctx = engine.getFabContext(message.fabId);
          if (ctx) ctx.setTransferRate(message.rateMode, message.utilizationPercent, message.throughputPerHour);
        } else {
          engine.forEachFab((ctx) => ctx.setTransferRate(message.rateMode, message.utilizationPercent, message.throughputPerHour));
        }
      }
      break;
    case "SET_RENDER_BUFFER":
      handleSetRenderBuffer(message.vehicleRenderBuffer, message.sensorRenderBuffer, message.fabAssignments, message.totalVehicles);
      break;
    case "SET_LOGGER_PORT":
      await handleSetLoggerPort(message.port, message.workerId);
      break;
    case "GET_LOCK_TABLE":
      handleGetLockTable(message.fabId, message.requestId);
      break;
    case "SET_ROUTING_CONFIG":
      if (engine) {
        if (message.fabId) {
          // Per-fab update
          engine.getFabContext(message.fabId)?.updateRoutingConfig(
            message.strategy, message.bprAlpha, message.bprBeta, message.rerouteInterval
          );
        } else {
          // Broadcast to all fabs
          engine.forEachFab((ctx) => {
            ctx.updateRoutingConfig(message.strategy, message.bprAlpha, message.bprBeta, message.rerouteInterval);
          });
        }
      }
      break;
    case "SET_MOVEMENT_CONFIG":
      if (engine) {
        const params = {
          linearMaxSpeed: message.linearMaxSpeed,
          linearAcceleration: message.linearAcceleration,
          linearDeceleration: message.linearDeceleration,
          preBrakeDeceleration: message.preBrakeDeceleration,
          curveMaxSpeed: message.curveMaxSpeed,
          curveAcceleration: message.curveAcceleration,
        };
        if (message.fabId) {
          engine.getFabContext(message.fabId)?.updateMovementConfig(params);
        } else {
          engine.forEachFab((ctx) => ctx.updateMovementConfig(params));
        }
      }
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

