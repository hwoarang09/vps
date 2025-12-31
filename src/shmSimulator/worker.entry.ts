// shmSimulator/worker.entry.ts
// Worker thread entry point

import { SimulationEngine } from "./core/SimulationEngine";
import type { WorkerMessage, MainMessage, InitPayload } from "./types";

let engine: SimulationEngine | null = null;

function handleInit(payload: InitPayload): void {
  try {
    console.log("[Worker] Received INIT message");

    engine = new SimulationEngine();
    engine.init(payload);

    const response: MainMessage = {
      type: "INITIALIZED",
      actualNumVehicles: engine.getActualNumVehicles(),
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
  if (!engine) return;
  console.log("[Worker] Disposing engine");
  engine.dispose();
  engine = null;
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
    default:
      console.warn("[Worker] Unknown message type:", (message as any).type);
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
