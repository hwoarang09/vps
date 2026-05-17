// components/test/VehicleTest/WelcomeHint.tsx
import React, { useEffect, useRef, useState } from "react";
import { Play, Mouse, MousePointer2, Keyboard } from "lucide-react";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";
import { useFabStore } from "@/store/map/fabStore";

const DONT_SHOW_KEY = "vps_welcome_dont_show";
const SHOW_DELAY_MS = 1000;
const FADE_MS = 600;

interface WelcomeHintProps {
  isTestCreated: boolean;
  fabCountX: number;
  fabCountY: number;
  numVehicles: number;
}

const CONTROLS = [
  { icon: <Play size={14} fill="currentColor" strokeWidth={0} />, key: "Space", desc: "Start / Pause" },
  { icon: <Mouse size={14} />, key: "Scroll", desc: "Zoom in / out" },
  { icon: <MousePointer2 size={14} />, key: "Drag", desc: "Pan camera" },
  { icon: <Keyboard size={14} />, key: "1 – 5", desc: "Menu shortcuts" },
];

const WelcomeHint: React.FC<WelcomeHintProps> = ({ isTestCreated, fabCountX, fabCountY, numVehicles }) => {
  const isPaused = useVehicleTestStore((s) => s.isPaused);
  const setPaused = useVehicleTestStore((s) => s.setPaused);
  const activeFabIndex = useFabStore((s) => s.activeFabIndex);
  const fabs = useFabStore((s) => s.fabs);

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const hasShownRef = useRef(false);

  const activeFab = fabs[Math.max(0, Math.min(activeFabIndex, fabs.length - 1))];
  const fabLabel = activeFab ? `${activeFab.col}_${activeFab.row}` : "0_0";
  const totalFabs = fabs.length || fabCountX * fabCountY;

  useEffect(() => {
    if (!isTestCreated || hasShownRef.current) return;
    hasShownRef.current = true;

    if (localStorage.getItem(DONT_SHOW_KEY) === "true") {
      setTimeout(() => setPaused(false), 300);
      return;
    }

    const t = setTimeout(() => {
      if (useVehicleTestStore.getState().isPaused) {
        setMounted(true);
        requestAnimationFrame(() => setVisible(true));
      }
    }, SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [isTestCreated, setPaused]);

  useEffect(() => {
    if (!isPaused && mounted) dismiss();
  }, [isPaused, mounted]);

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => setMounted(false), FADE_MS);
  };

  const handlePlay = () => {
    if (dontShow) localStorage.setItem(DONT_SHOW_KEY, "true");
    setPaused(false);
  };

  if (!mounted) return null;

  return (
    <div
      onClick={dismiss}
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{
        background: "rgba(6, 8, 14, 0.72)",
        backdropFilter: "blur(4px)",
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease-in-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-[480px] px-12 py-10 rounded-2xl"
        style={{
          background: "rgba(14, 17, 26, 0.97)",
          border: "1px solid rgba(255,255,255,0.13)",
          boxShadow: "0 16px 64px rgba(0,0,0,0.65)",
          transform: visible ? "translateY(0)" : "translateY(12px)",
          transition: `transform ${FADE_MS}ms ease-in-out`,
        }}
      >
        {/* 헤더 */}
        <p className="text-white/40 text-xs font-mono tracking-[0.3em] uppercase mb-7">
          Simulation Ready
        </p>

        {/* Fab 정보 */}
        <div className="flex flex-col gap-3 mb-8">
          <div className="flex items-baseline justify-between">
            <span className="text-white/40 text-sm font-mono">Currently viewing</span>
            <span className="text-white text-sm font-mono font-semibold">Fab {fabLabel}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-white/40 text-sm font-mono">Total</span>
            <span className="text-white/70 text-sm font-mono">
              {totalFabs} fabs ({fabCountX}×{fabCountY}) · {numVehicles.toLocaleString()} vehicles
            </span>
          </div>
        </div>

        {/* 구분선 */}
        <div className="w-full h-px bg-white/8 mb-7" />

        {/* Controls */}
        <div className="flex flex-col gap-3.5 mb-9">
          {CONTROLS.map(({ icon, key, desc }) => (
            <div key={key} className="flex items-center gap-4">
              <span className="text-white/30 w-4 flex justify-center flex-shrink-0">{icon}</span>
              <span className="text-white/55 text-sm font-mono w-16">{key}</span>
              <span className="text-white/40 text-sm">{desc}</span>
            </div>
          ))}
        </div>

        {/* Start 버튼 */}
        <button
          onClick={handlePlay}
          className="flex items-center justify-center gap-2.5 w-full py-3.5 rounded-xl
                     text-white text-base font-semibold tracking-wide
                     transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
          style={{
            background: "rgba(103, 232, 249, 0.12)",
            border: "1px solid rgba(103, 232, 249, 0.35)",
            color: "#a5f3fc",
            boxShadow: "0 0 20px rgba(103, 232, 249, 0.15)",
          }}
        >
          <Play size={15} fill="currentColor" strokeWidth={0} />
          Start Simulation
        </button>

        {/* Don't show again + 닫기 */}
        <div className="flex items-center justify-between mt-5">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="w-3.5 h-3.5 cursor-pointer"
              style={{ accentColor: "#67e8f9" }}
            />
            <span className="text-white/30 text-xs font-mono">Don't show again</span>
          </label>
          <span className="text-white/20 text-xs font-mono">click outside to close</span>
        </div>
      </div>
    </div>
  );
};

export default WelcomeHint;
