// components/test/VehicleTest/AppBranding.tsx
// 화면 고정 브랜딩 — 상단 좌측 "VPS" 제목 + 우하단 버전 표시.
// 미니멀 다크 톤(얇은 흰 라인). 클릭 방해 안 하도록 pointer-events-none.

import React from "react";

const AppBranding: React.FC = () => {
  return (
    <>
      {/* 상단 좌측 제목 */}
      <div className="fixed top-3 left-4 z-[1000] pointer-events-none select-none">
        <div className="text-white/80 text-base font-light tracking-[0.3em] leading-none">
          VPS
        </div>
        <div className="text-white/35 text-[9px] tracking-[0.15em] mt-1">
          VIRTUAL PHYSICS SIMULATOR
        </div>
      </div>

      {/* 우하단 버전 */}
      <div className="fixed bottom-2 right-3 z-[1000] pointer-events-none select-none text-white/30 text-[10px] font-mono tracking-wider">
        v{__APP_VERSION__}
      </div>
    </>
  );
};

export default AppBranding;
