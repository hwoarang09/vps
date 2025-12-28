import { useEffect, useRef, useState } from "react";
import { useShmSimulatorStore } from "@/store/vehicle/shmMode/shmSimulatorStore";


/**
 * PerformanceMonitorUI
 * - HTML overlay component that displays the performance stats
 */
export const PerformanceMonitorUI: React.FC = () => {
  const [avgFps, setAvgFps] = useState<number>(0);
  const [avgMs, setAvgMs] = useState<number>(0);
  const [avgCpu, setAvgCpu] = useState<number>(0);
  const frameTimesRef = useRef<number[]>([]);
  const lastUpdateTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const UPDATE_INTERVAL = 5000; // 5 seconds in milliseconds

  // Get worker performance stats from store
  const workerAvgMs = useShmSimulatorStore((state) => state.workerAvgMs);

  useEffect(() => {
    const updatePerformance = (currentTime: number) => {
      const delta = currentTime - lastFrameTimeRef.current;
      lastFrameTimeRef.current = currentTime;

      // Collect frame time (in milliseconds)
      frameTimesRef.current.push(delta);

      // Update every 5 seconds
      if (currentTime - lastUpdateTimeRef.current >= UPDATE_INTERVAL) {
        const frameTimes = frameTimesRef.current;

        if (frameTimes.length > 0) {
          // Calculate average frame time
          const avgFrameTime = frameTimes.reduce((sum, time) => sum + time, 0) / frameTimes.length;

          // Calculate FPS from average frame time
          const fps = 1000 / avgFrameTime;

          // Estimate CPU usage (rough approximation)
          // Assuming 60 FPS is baseline, lower FPS = higher CPU usage
          const targetFps = 60;
          const cpuUsage = Math.max(0, Math.min(100, ((targetFps - fps) / targetFps) * 100 + 20));

          setAvgFps(fps);
          setAvgMs(avgFrameTime);
          setAvgCpu(cpuUsage);
        }

        // Reset for next interval
        frameTimesRef.current = [];
        lastUpdateTimeRef.current = currentTime;
      }

      animationFrameRef.current = requestAnimationFrame(updatePerformance);
    };

    // Start the animation loop
    lastUpdateTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(updatePerformance);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        bottom: "10px", // Aligned with bottom
        right: "360px", // Left of r3f-perf panel (approx width 350px)
        padding: "10px 14px",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        color: "white",
        fontFamily: "monospace",
        fontSize: "15px",
        fontWeight: "bold",
        borderRadius: "6px",
        border: "1px solid rgba(255, 255, 255, 0.3)",
        textShadow: "1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black",
        zIndex: 9999,
        pointerEvents: "none",
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      }}
    >
      {/* Row 1: Main Thread */}
      <div style={{ display: "flex", flexDirection: "row", gap: "12px", alignItems: "center" }}>
        <div style={{ fontSize: "12px", color: "#888", width: "50px" }}>Main</div>
        <div style={{ fontSize: "16px", color: "#4ecdc4" }}>
          {avgFps.toFixed(1)} FPS
        </div>
        <div style={{ fontSize: "14px", color: "#9acd32" }}>
          {avgMs.toFixed(2)} ms
        </div>
        <div style={{ fontSize: "14px", color: "#9acd32" }}>
          {avgCpu.toFixed(2)} ms
        </div>        
      </div>
      {/* Row 2: Worker Thread */}
      <div style={{ display: "flex", flexDirection: "row", gap: "12px", alignItems: "center" }}>
        <div style={{ fontSize: "12px", color: "#888", width: "50px" }}>Worker</div>
        <div style={{ fontSize: "14px", color: "#ff9f43" }}>
          {workerAvgMs.toFixed(2)} ms
        </div>
      </div>
    </div>
  );
};
