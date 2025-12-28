// shmSimulator/worker.entry.ts
// Worker thread entry point

import { SimulationEngine } from "./core/SimulationEngine";
import type { WorkerMessage, MainMessage } from "./types";

let engine: SimulationEngine | null = null;

// Handle messages from main thread
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const message = e.data;

  switch (message.type) {
    case "INIT":
      try {
        console.log("[Worker] Received INIT message");

        engine = new SimulationEngine();
        engine.init(message.payload);

        const response: MainMessage = {
          type: "INITIALIZED",
          actualNumVehicles: engine.getActualNumVehicles(),
        };
        self.postMessage(response);

        console.log("[Worker] Engine initialized, sending INITIALIZED response");
      } catch (error) {
        const errorResponse: MainMessage = {
          type: "ERROR",
          error: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(errorResponse);
      }
      break;

    case "START":
      if (engine) {
        console.log("[Worker] Starting simulation");
        engine.start();

        const response: MainMessage = { type: "READY" };
        self.postMessage(response);
      }
      break;

    case "STOP":
      if (engine) {
        console.log("[Worker] Stopping simulation");
        engine.stop();
      }
      break;

    case "PAUSE":
      if (engine) {
        console.log("[Worker] Pausing simulation");
        engine.stop();
      }
      break;

    case "RESUME":
      if (engine) {
        console.log("[Worker] Resuming simulation");
        engine.start();
      }
      break;

    case "DISPOSE":
      if (engine) {
        console.log("[Worker] Disposing engine");
        engine.dispose();
        engine = null;
      }
      break;

    case "SET_TRANSFER_MODE":
      // TODO: Implement transfer mode change
      console.log("[Worker] SET_TRANSFER_MODE:", message.mode);
      break;

    default:
      console.warn("[Worker] Unknown message type:", (message as any).type);
  }
};

// Handle errors
self.onerror = (error) => {
  console.error("[Worker] Unhandled error:", error);
  const response: MainMessage = {
    type: "ERROR",
    error: String(error),
  };
  self.postMessage(response);
};

console.log("[Worker] SHM Simulator worker initialized");
