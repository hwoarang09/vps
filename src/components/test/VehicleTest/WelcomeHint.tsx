// components/test/VehicleTest/WelcomeHint.tsx
import React, { useEffect, useRef, useState } from "react";
import { Play, Mouse, MousePointer2, Keyboard, X } from "lucide-react";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";

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

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const hasShownRef = useRef(false);

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
        className="relative flex flex-col w-[480px] px-12 py-10 rounded-2xl"
        style={{
          background: "rgba(14, 17, 26, 0.97)",
          border: "1px solid rgba(255,255,255,0.13)",
          boxShadow: "0 16px 64px rgba(0,0,0,0.65)",
          transform: visible ? "translateY(0)" : "translateY(12px)",
          transition: `transform ${FADE_MS}ms ease-in-out`,
        }}
      >
        {/* X 닫기 버튼 */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-white/45 hover:text-white/80 transition-colors duration-150"
        >
          <X size={14} />
        </button>

        {/* 헤더 */}
        <p className="text-white/60 text-xs font-mono tracking-[0.3em] uppercase mb-7">
          Simulation Ready
        </p>

        {/* 시뮬레이션 규모 */}
        <p className="text-white/80 text-sm font-mono mb-8">
          {fabCountX}×{fabCountY} fabs · {numVehicles.toLocaleString()} vehicles
        </p>

        {/* 구분선 */}
        <div className="w-full h-px bg-white/8 mb-7" />

        {/* Controls */}
        <div className="flex flex-col gap-3.5 mb-9">
          {CONTROLS.map(({ icon, key, desc }) => (
            <div key={key} className="flex items-center gap-4">
              <span className="text-white/50 w-4 flex justify-center flex-shrink-0">{icon}</span>
              <span className="text-white/85 text-sm font-mono w-16">{key}</span>
              <span className="text-white/65 text-sm">{desc}</span>
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

        {/* Don't show again */}
        <div className="flex items-center justify-end mt-5">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="w-3.5 h-3.5 cursor-pointer"
              style={{ accentColor: "#67e8f9" }}
            />
            <span className="text-white/55 text-xs font-mono">Don't show again</span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default WelcomeHint;
