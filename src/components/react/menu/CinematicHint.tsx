// components/react/menu/CinematicHint.tsx
// Cinematic 모드(모든 HUD/메뉴 숨김) 진입 시 복귀 방법을 살짝 띄웠다가 천천히 fade.
// UI 가 전부 사라지므로 "어떻게 돌아오지?" 를 위한 최소한의 안내. (H 또는 Esc)
import React, { useEffect, useState } from "react";
import { useMenuStore } from "@/store/ui/menuStore";

const CinematicHint: React.FC = () => {
  const cinematicMode = useMenuStore((s) => s.cinematicMode);
  const [visible, setVisible] = useState(false);

  // 진입할 때마다 안내를 잠깐 보여주고 자동으로 fade-out
  useEffect(() => {
    if (!cinematicMode) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(t);
  }, [cinematicMode]);

  if (!cinematicMode) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-none select-none"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 1.2s ease-in-out" }}
    >
      <span className="text-[11px] tracking-[0.25em] font-light text-white/60 uppercase">
        Press H or Esc to show UI
      </span>
    </div>
  );
};

export default CinematicHint;
