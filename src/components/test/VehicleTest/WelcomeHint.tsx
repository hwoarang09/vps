// components/test/VehicleTest/WelcomeHint.tsx
// 첫 로딩 완료 시 1회 노출되는 온보딩 모달
// - 포트폴리오 방문자에게 "Play 버튼으로 시뮬레이션 시작" 안내
// - Bruno Simon 톤: 풀스크린 다크 + 얇은 흰 라인 + 천천히 ease-in-out fade

import React, { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useVehicleTestStore } from "@store/vehicle/vehicleTestStore";

interface WelcomeHintProps {
  /** 테스트(차량) 생성 완료 여부 — true 가 되면 잠시 후 모달 노출 */
  isTestCreated: boolean;
}

// 차량 렌더가 화면에 자리잡을 시간을 준 뒤 노출
const SHOW_DELAY_MS = 1200;
// fade 길이 (CSS duration 과 일치시킬 것)
const FADE_MS = 700;

const WelcomeHint: React.FC<WelcomeHintProps> = ({ isTestCreated }) => {
  const isPaused = useVehicleTestStore((s) => s.isPaused);
  const setPaused = useVehicleTestStore((s) => s.setPaused);

  const [mounted, setMounted] = useState(false); // DOM 존재 여부
  const [visible, setVisible] = useState(false); // opacity 토글
  const hasShownRef = useRef(false); // 세션당 1회만

  // 첫 로딩 완료 → 잠시 후 노출
  useEffect(() => {
    if (!isTestCreated || hasShownRef.current) return;
    hasShownRef.current = true;
    const t = setTimeout(() => {
      // 이미 재생 중이면 굳이 띄우지 않음
      if (useVehicleTestStore.getState().isPaused) {
        setMounted(true);
        requestAnimationFrame(() => setVisible(true));
      }
    }, SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [isTestCreated]);

  // 재생이 시작되면(어떤 경로로든) 자동으로 닫힘
  useEffect(() => {
    if (!isPaused && mounted) dismiss();
  }, [isPaused, mounted]);

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => setMounted(false), FADE_MS);
  };

  const handlePlay = () => {
    setPaused(false); // 시뮬레이션 재생 → isPaused effect 가 dismiss 처리
  };

  if (!mounted) return null;

  return (
    <div
      onClick={dismiss}
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{
        background: "rgba(8, 10, 16, 0.62)",
        backdropFilter: "blur(2px)",
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease-in-out`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col items-center text-center px-12 py-10 rounded-2xl"
        style={{
          background: "rgba(20, 24, 34, 0.92)",
          border: "1px solid rgba(255, 255, 255, 0.18)",
          boxShadow: "0 8px 40px rgba(0, 0, 0, 0.55)",
          transform: visible ? "translateY(0)" : "translateY(8px)",
          transition: `transform ${FADE_MS}ms ease-in-out`,
        }}
      >
        <p className="text-white/60 text-xs font-mono tracking-[0.2em] uppercase mb-3">
          Simulation Ready
        </p>
        <p className="text-white text-lg font-semibold leading-relaxed">
          <span className="text-accent-green">▶ Play</span> 버튼을 누르면
          <br />
          시뮬레이션이 시작됩니다
        </p>

        <button
          onClick={handlePlay}
          className="mt-7 flex items-center gap-2 px-7 py-2.5 rounded-xl
                     text-white font-semibold
                     transition-all duration-150 hover:scale-[1.04]"
          style={{
            background:
              "radial-gradient(circle, rgba(60,150,220,0.85) 0%, rgba(94,197,255,0.95) 100%)",
            border: "1px solid rgba(255, 255, 255, 0.45)",
            boxShadow: "0 0 18px rgba(94, 197, 255, 0.45)",
          }}
        >
          <Play size={16} fill="currentColor" strokeWidth={0} />
          <span>Play</span>
        </button>

        <p className="mt-6 text-white/35 text-[11px] font-mono">
          상단 컨트롤 바에서도 제어할 수 있어요 · 클릭해서 닫기
        </p>
      </div>
    </div>
  );
};

export default WelcomeHint;
