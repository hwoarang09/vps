// benchmark.ts
// Performance comparison: DevLogger vs FbLogger

import { FbLogger } from "./FbLogger";
import { devLog } from "../DevLogger";

interface BenchmarkResult {
  name: string;
  duration: number; // ms
  operations: number;
  opsPerSec: number;
  avgTimePerOp: number; // μs
  memoryUsed?: number; // bytes
}

/**
 * Benchmark: Write N log entries
 */
async function benchmarkWrite(iterations: number): Promise<{
  fbLogger: BenchmarkResult;
  devLogger: BenchmarkResult;
}> {
  console.log(`\n🔥 Benchmark: Writing ${iterations.toLocaleString()} log entries`);
  console.log("=" .repeat(80));

  // Test data
  const testMessages = [
    "Vehicle position updated",
    "Checkpoint HIT detected",
    "Lock request sent",
    "Edge transition completed",
    "Path recalculated",
  ];

  // -------------------------------------------------------------------------
  // FbLogger benchmark
  // -------------------------------------------------------------------------
  const fbLogger = new FbLogger({
    sessionId: "benchmark",
    workerId: 0,
    flushInterval: 0, // No auto-flush
  });

  const fbStart = performance.now();
  const fbMemBefore = (performance as any).memory?.usedJSHeapSize ?? 0;

  for (let i = 0; i < iterations; i++) {
    const msg = testMessages[i % testMessages.length];
    const vehId = i % 100;

    if (i % 3 === 0) {
      fbLogger.checkpoint({
        vehId,
        cpIndex: i % 10,
        edgeId: i % 1000,
        ratio: Math.random(),
        flags: i % 16,
        action: "HIT",
        details: `Detail ${i}`,
      });
    } else if (i % 3 === 1) {
      fbLogger.debug(msg, { vehId, tag: "benchmark" });
    } else {
      fbLogger.info(msg, { vehId, tag: "benchmark" });
    }
  }

  const fbBuffer = fbLogger.flush();
  const fbEnd = performance.now();
  const fbMemAfter = (performance as any).memory?.usedJSHeapSize ?? 0;

  const fbDuration = fbEnd - fbStart;
  const fbMemUsed = fbMemAfter - fbMemBefore;

  fbLogger.dispose();

  // -------------------------------------------------------------------------
  // DevLogger benchmark
  // -------------------------------------------------------------------------
  await devLog.init(0);

  const devStart = performance.now();
  const devMemBefore = (performance as any).memory?.usedJSHeapSize ?? 0;

  for (let i = 0; i < iterations; i++) {
    const msg = testMessages[i % testMessages.length];
    const vehId = i % 100;

    if (i % 2 === 0) {
      devLog.veh(vehId).debug(msg);
    } else {
      devLog.veh(vehId).info(msg);
    }
  }

  await devLog.flush();
  const devEnd = performance.now();
  const devMemAfter = (performance as any).memory?.usedJSHeapSize ?? 0;

  const devDuration = devEnd - devStart;
  const devMemUsed = devMemAfter - devMemBefore;

  await devLog.dispose();

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  const fbResult: BenchmarkResult = {
    name: "FbLogger (FlatBuffers)",
    duration: fbDuration,
    operations: iterations,
    opsPerSec: iterations / (fbDuration / 1000),
    avgTimePerOp: (fbDuration / iterations) * 1000,
    memoryUsed: fbBuffer?.byteLength ?? 0,
  };

  const devResult: BenchmarkResult = {
    name: "DevLogger (Text)",
    duration: devDuration,
    operations: iterations,
    opsPerSec: iterations / (devDuration / 1000),
    avgTimePerOp: (devDuration / iterations) * 1000,
    memoryUsed: devMemUsed,
  };

  return { fbLogger: fbResult, devLogger: devResult };
}

/**
 * Print benchmark results
 */
function printResults(results: { fbLogger: BenchmarkResult; devLogger: BenchmarkResult }) {
  const { fbLogger, devLogger } = results;

  console.log("\n📊 Results:");
  console.log("-".repeat(80));
  console.log(`  ${fbLogger.name}:`);
  console.log(`    Duration:       ${fbLogger.duration.toFixed(2)} ms`);
  console.log(`    Ops/sec:        ${fbLogger.opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`    Avg time/op:    ${fbLogger.avgTimePerOp.toFixed(3)} μs`);
  console.log(`    Buffer size:    ${(fbLogger.memoryUsed ?? 0).toLocaleString()} bytes`);

  console.log();
  console.log(`  ${devLogger.name}:`);
  console.log(`    Duration:       ${devLogger.duration.toFixed(2)} ms`);
  console.log(`    Ops/sec:        ${devLogger.opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`    Avg time/op:    ${devLogger.avgTimePerOp.toFixed(3)} μs`);
  console.log(`    Memory used:    ${(devLogger.memoryUsed ?? 0).toLocaleString()} bytes`);

  console.log();
  console.log("🏆 Winner:");
  console.log("-".repeat(80));

  const speedup = devLogger.duration / fbLogger.duration;
  const sizeRatio = (devLogger.memoryUsed ?? 0) / (fbLogger.memoryUsed ?? 1);

  if (speedup > 1) {
    console.log(`  ✅ FbLogger is ${speedup.toFixed(2)}x FASTER`);
  } else {
    console.log(`  ⚠️  DevLogger is ${(1 / speedup).toFixed(2)}x faster`);
  }

  if (sizeRatio > 1) {
    console.log(`  ✅ FbLogger uses ${sizeRatio.toFixed(2)}x LESS memory/storage`);
  } else {
    console.log(`  ⚠️  DevLogger uses ${(1 / sizeRatio).toFixed(2)}x less memory/storage`);
  }

  console.log();
}

/**
 * Run benchmark suite
 */
export async function runBenchmark(iterations = 10000) {
  console.log("\n🚀 FlatBuffers Logger Benchmark");
  console.log("=" .repeat(80));

  const results = await benchmarkWrite(iterations);
  printResults(results);
}

// Run if called directly
if (import.meta.url.endsWith(process.argv[1])) {
  const iterations = parseInt(process.argv[2] ?? "10000");
  runBenchmark(iterations).catch(console.error);
}
