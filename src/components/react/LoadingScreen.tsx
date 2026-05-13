import React, { useEffect, useRef, useState } from "react";
import { useLoadingStore } from "@store/ui/loadingStore";

type Phase = "loading" | "fading" | "gone";

const FADE_DURATION_MS = 3500;
const HOLD_AFTER_DONE_MS = 900;
const LERP_FACTOR = 0.08;

const computeTarget = (s: {
  configReady: boolean;
  iconsLoaded: boolean;
  mapLoaded: boolean;
  fabsTotal: number;
  fabsInitialized: number;
  allReady: boolean;
}): number => {
  if (s.allReady) return 100;
  let t = 0;
  if (s.configReady) t = Math.max(t, 5);
  if (s.iconsLoaded) t = Math.max(t, 10);
  if (s.mapLoaded) t = Math.max(t, 25);
  if (s.fabsTotal > 0) {
    const fabRatio = Math.min(s.fabsInitialized / s.fabsTotal, 1);
    t = Math.max(t, 25 + fabRatio * 70);
  }
  return Math.min(t, 95);
};

const getStageLabel = (s: {
  configReady: boolean;
  iconsLoaded: boolean;
  mapLoaded: boolean;
  fabsTotal: number;
  fabsInitialized: number;
  allReady: boolean;
}): string => {
  if (s.allReady) return "Ready";
  if (!s.configReady) return "Config";
  if (!s.iconsLoaded) return "메뉴 아이콘";
  if (!s.mapLoaded) return "Three.js Map";
  if (s.fabsTotal === 0) return "Worker 초기화";
  if (s.fabsInitialized < s.fabsTotal) {
    return `Vehicle (${s.fabsInitialized}/${s.fabsTotal} fab)`;
  }
  return "마무리";
};

const LoadingScreen: React.FC = () => {
  const configReady = useLoadingStore((s) => s.configReady);
  const iconsLoaded = useLoadingStore((s) => s.iconsLoaded);
  const mapLoaded = useLoadingStore((s) => s.mapLoaded);
  const fabsTotal = useLoadingStore((s) => s.fabsTotal);
  const fabsInitialized = useLoadingStore((s) => s.fabsInitialized);
  const allReady = useLoadingStore((s) => s.allReady);

  const state = {
    configReady,
    iconsLoaded,
    mapLoaded,
    fabsTotal,
    fabsInitialized,
    allReady,
  };
  const targetPercent = computeTarget(state);

  const [displayPercent, setDisplayPercent] = useState(0);
  const targetRef = useRef(targetPercent);
  targetRef.current = targetPercent;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setDisplayPercent((prev) => {
        const diff = targetRef.current - prev;
        if (Math.abs(diff) < 0.05) return targetRef.current;
        return prev + diff * LERP_FACTOR;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    if (!allReady || phase !== "loading") return;
    const t = setTimeout(() => setPhase("fading"), HOLD_AFTER_DONE_MS);
    return () => clearTimeout(t);
  }, [allReady, phase]);

  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => setPhase("gone"), FADE_DURATION_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;

  const isFading = phase === "fading";
  const label = getStageLabel(state);
  const shownPercent = isFading ? 100 : Math.floor(displayPercent);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black transition-opacity ease-in-out"
      style={{
        transitionDuration: `${FADE_DURATION_MS}ms`,
        opacity: isFading ? 0 : 1,
        pointerEvents: isFading ? "none" : "auto",
      }}
    >
      <div className="w-[460px] max-w-[80vw] flex flex-col items-center gap-8 px-6">
        <h1 className="text-white text-xl font-light tracking-[0.2em] uppercase">
          VPS
        </h1>

        <div className="w-full h-[2px] bg-white/10 overflow-hidden relative">
          <div
            className="absolute inset-y-0 left-0 w-full bg-white"
            style={{
              transform: `scaleX(${isFading ? 0 : displayPercent / 100})`,
              transformOrigin: isFading ? "right" : "left",
              transition: isFading
                ? `transform ${FADE_DURATION_MS}ms ease-in-out`
                : undefined,
              willChange: "transform",
            }}
          />
        </div>

        <div className="flex justify-between items-center w-full text-[11px] tracking-wider uppercase">
          <span className="text-neutral-500">{isFading ? "" : label}</span>
          <span className="text-neutral-400 font-mono">
            {isFading ? "" : `${shownPercent}%`}
          </span>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;
