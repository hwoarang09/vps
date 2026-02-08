// example-opfs.ts
// FbLogger + OPFS 통합 예제 (브라우저에서 실행)

import { FbLogger } from "./FbLogger";
import { FbLoggerController, listFbLogFiles, downloadFbLogFile } from "./FbLoggerController";

/**
 * Main Thread에서 사용 (OPFS 저장)
 */
export async function runFbLoggerExample() {
  console.log("\n🚀 FbLogger + OPFS Example\n");

  // 1. Controller 생성 및 초기화
  const controller = new FbLoggerController({
    sessionId: `example_${Date.now()}`,
    workerId: 0,
  });

  console.log("📝 Initializing FbLoggerController...");
  await controller.init();
  console.log("✓ Controller ready\n");

  // 2. FbLogger 생성 (Controller와 연결 안 함, 직접 전송)
  const logger = new FbLogger({
    sessionId: `example_${Date.now()}`,
    workerId: 0,
    flushInterval: 0, // Manual flush
  });

  console.log("📝 Logging 100 entries...");

  // 3. 로그 생성
  logger.info("Simulation started", { tag: "SimEngine" });

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

  for (let i = 0; i < 20; i++) {
    logger.edgeTransition({
      vehId: (i % 10) + 1,
      fromEdge: 720 + i,
      toEdge: 721 + i,
      nextEdges: [721 + i, 722 + i, 723 + i, 724 + i, 725 + i],
      pathBufLen: 15 - i,
    });
  }

  for (let i = 0; i < 15; i++) {
    logger.lockEvent({
      vehId: (i % 10) + 1,
      lockId: i % 5,
      eventType: ["REQUEST", "GRANT", "WAIT", "RELEASE"][i % 4],
      edgeId: 723,
      waitTimeMs: i * 10,
    });
  }

  logger.warn("High lock queue", { tag: "LockMgr" });
  logger.error("Deadlock detected!", { vehId: 5, tag: "DeadlockDetector" });

  for (let i = 0; i < 5; i++) {
    logger.perf({
      fps: 60 - i * 2,
      memoryMb: 250 + i * 10,
      activeVehicles: 1000 + i * 100,
      lockQueueSize: 20 + i * 5,
    });
  }

  console.log(`✓ Logged ${logger.getBufferSize()} entries\n`);

  // 4. Flush to buffer
  console.log("💾 Flushing to buffer...");
  const buffer = logger.flush();

  if (buffer) {
    console.log(`✓ Buffer size: ${buffer.byteLength.toLocaleString()} bytes\n`);

    // 5. Send to OPFS via controller
    console.log("💾 Sending to OPFS...");
    controller.log(buffer);
    await controller.flush();
    console.log("✓ Saved to OPFS\n");
  }

  // 6. List files
  console.log("📂 OPFS files:");
  const files = await listFbLogFiles();
  files.forEach((f) => console.log(`  - ${f}`));
  console.log();

  // 7. Download and verify
  if (files.length > 0) {
    const latestFile = files[files.length - 1];
    console.log(`📥 Downloading: ${latestFile}`);
    const downloaded = await downloadFbLogFile(latestFile);
    console.log(`✓ Downloaded: ${downloaded.byteLength.toLocaleString()} bytes\n`);
  }

  // 8. Cleanup
  logger.dispose();
  controller.dispose();

  console.log("✅ Done!");
  console.log("\n💡 Next steps:");
  console.log("  1. Open browser DevTools → Application → Storage → OPFS");
  console.log("  2. Check fb_logs/ directory");
  console.log("  3. Use fb_parser.py to analyze (after downloading)");
}

// Auto-run if in browser
if (typeof window !== "undefined") {
  (window as any).runFbLoggerExample = runFbLoggerExample;
  console.log("💡 Run: runFbLoggerExample()");
}
