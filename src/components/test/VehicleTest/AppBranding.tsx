// components/test/VehicleTest/AppBranding.tsx
import React from "react";
import { useCFGStore } from "@/store/system/cfgStore";
import { useNodeStore } from "@/store/map/nodeStore";
import { useEdgeStore } from "@/store/map/edgeStore";
import { useStationStore } from "@/store/map/stationStore";

const AppBranding: React.FC = () => {
  const currentMapName = useCFGStore((s) => s.currentMapName);
  const nodes = useNodeStore((s) => s.nodes);
  const edges = useEdgeStore((s) => s.edges);
  const stations = useStationStore((s) => s.stations);

  const totalKm = edges.reduce((sum, e) => sum + (e.distance ?? 0), 0) / 1000;

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

      {/* 좌하단 맵 정보 */}
      {currentMapName && (
        <div className="fixed bottom-2 left-4 z-[1000] pointer-events-none select-none flex items-center gap-1.5 text-white/35 text-[9px] font-mono">
          <span className="text-white/60">{currentMapName}</span>
          <span className="text-white/20">·</span>
          <span>{nodes.length}N</span>
          <span className="text-white/20">·</span>
          <span>{edges.length}E</span>
          <span className="text-white/20">·</span>
          <span>{stations.length}ST</span>
          <span className="text-white/20">·</span>
          <span>{totalKm.toFixed(2)}km</span>
        </div>
      )}

      {/* 우하단 버전 */}
      <div className="fixed bottom-2 right-3 z-[1000] select-none pointer-events-none">
        <span className="text-white/30 text-[10px] font-mono tracking-wider">
          v{__APP_VERSION__}
        </span>
      </div>
    </>
  );
};

export default AppBranding;
