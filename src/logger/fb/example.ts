// example.ts
// FbLogger 사용 예제

import { FbLogger, readLogBatch } from "./FbLogger";

async function main() {
  console.log("🚀 FbLogger Example\n");

  // 로거 생성
  const logger = new FbLogger({
    sessionId: `example_${Date.now()}`,
    workerId: 0,
    flushInterval: 0, // Manual flush
  });

  console.log("📝 Logging 100 entries...");

  // 1. 일반 로그
  logger.info("Simulation started", { tag: "SimEngine" });
  logger.debug("Initializing vehicles", { tag: "VehicleMgr" });

  // 2. 차량별 로그
  for (let vehId = 1; vehId <= 10; vehId++) {
    logger.debug(`Vehicle ${vehId} spawned`, { vehId, tag: "VehicleMgr" });
  }

  // 3. Checkpoint 로그
  for (let i = 0; i < 30; i++) {
    logger.checkpoint({
      vehId: (i % 10) + 1,
      cpIndex: i % 5,
      edgeId: 720 + (i % 10),
      ratio: Math.random(),
      flags: [1, 2, 4, 8, 9][i % 5],
      action: ["HIT", "SKIP", "LOAD_NEXT"][i % 3],
      details: `Iteration ${i}`,
    });
  }

  // 4. Edge 전환 로그
  for (let i = 0; i < 20; i++) {
    logger.edgeTransition({
      vehId: (i % 10) + 1,
      fromEdge: 720 + i,
      toEdge: 721 + i,
      nextEdges: [721 + i, 722 + i, 723 + i, 724 + i, 725 + i],
      pathBufLen: 15 - i,
    });
  }

  // 5. Lock 이벤트
  for (let i = 0; i < 15; i++) {
    logger.lockEvent({
      vehId: (i % 10) + 1,
      lockId: i % 5,
      eventType: ["REQUEST", "GRANT", "WAIT", "RELEASE"][i % 4],
      edgeId: 723,
      waitTimeMs: i * 10,
    });
  }

  // 6. 에러 로그
  logger.warn("High lock queue size", { tag: "LockMgr" });
  logger.error("Deadlock detected!", { vehId: 5, tag: "DeadlockDetector" });

  // 7. 성능 로그
  for (let i = 0; i < 5; i++) {
    logger.perf({
      fps: 60 - i * 2,
      memoryMb: 250 + i * 10,
      activeVehicles: 1000 + i * 100,
      lockQueueSize: 20 + i * 5,
    });
  }

  console.log(`✓ Logged ${logger.getBufferSize()} entries\n`);

  // Flush
  console.log("💾 Flushing to buffer...");
  const buffer = logger.flush();

  if (buffer) {
    console.log(`✓ Buffer size: ${buffer.byteLength.toLocaleString()} bytes\n`);

    // Read back
    console.log("📖 Reading back...");
    const batch = readLogBatch(buffer);
    console.log(`  Session ID: ${batch.sessionId()}`);
    console.log(`  Worker ID: ${batch.workerId()}`);
    console.log(`  Total entries: ${batch.logsLength()}\n`);

    // Print first 10 entries
    console.log("First 10 entries:");
    for (let i = 0; i < Math.min(10, batch.logsLength()); i++) {
      const entry = batch.logs(i);
      const ts = entry?.timestamp() ?? 0;
      const location = entry?.location() ?? "unknown";
      console.log(`  ${i + 1}. [${new Date(ts).toISOString()}] ${location}`);
    }

    // Save to file (example)
    if (typeof process !== "undefined") {
      const fs = await import("fs");
      const filename = `/tmp/fb_example_${Date.now()}.bin`;
      fs.writeFileSync(filename, new Uint8Array(buffer));
      console.log(`\n💾 Saved to: ${filename}`);
      console.log(`\nTo analyze with Python:`);
      console.log(`  python3 tools/log_parser/fb_parser.py ${filename}`);
      console.log(`  python3 tools/log_parser/fb_parser.py ${filename} --summary`);
      console.log(`  python3 tools/log_parser/fb_parser.py ${filename} --veh 5`);
    }
  }

  logger.dispose();
  console.log("\n✅ Done!");
}

// Run
if (import.meta.url.endsWith(process.argv[1])) {
  main().catch(console.error);
}

export { main };
