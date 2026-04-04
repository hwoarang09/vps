// shared/FloatingPanel.tsx
// 드래그/리사이즈 가능한 반투명 플로팅 패널 공통 래퍼

import React, { useEffect } from "react";
import { X, GripHorizontal } from "lucide-react";
import { useDragResize, type DragResizeOptions } from "./useDragResize";

interface FloatingPanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** useDragResize 옵션 (위치, 크기, 최소값) */
  dragResizeOpts?: DragResizeOptions;
  /** z-index (기본 60) */
  zIndex?: number;
  /** 배경 투명도 클래스 (기본 bg-gray-900/85) */
  bgClass?: string;
  /** 헤더 우측 추가 요소 (세션 셀렉터 등) */
  headerExtra?: React.ReactNode;
  /** 헤더-콘텐츠 사이 추가 요소 (탭 바 등) */
  subHeader?: React.ReactNode;
}

const FloatingPanel: React.FC<FloatingPanelProps> = ({
  title,
  onClose,
  children,
  dragResizeOpts,
  zIndex = 60,
  bgClass = "bg-gray-900/85",
  headerExtra,
  subHeader,
}) => {
  const { elRef, initialStyle, onDragStart, onResizeStart } = useDragResize(dragResizeOpts);

  // ESC로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={elRef}
      className={`fixed flex flex-col ${bgClass} border border-gray-700 shadow-2xl backdrop-blur-md rounded-xl`}
      style={{ ...initialStyle, zIndex }}
    >
      {/* Header (drag handle) */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/60 rounded-t-xl cursor-move select-none"
        onMouseDown={onDragStart}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={14} className="text-gray-500 flex-shrink-0" />
          <h2 className="text-sm font-bold text-white whitespace-nowrap">{title}</h2>
          {headerExtra}
        </div>
        <button
          onClick={onClose}
          onMouseDown={e => e.stopPropagation()}
          className="text-gray-400 hover:text-white transition-colors"
          title="ESC"
        >
          <X size={16} />
        </button>
      </div>

      {/* Sub-header (tabs etc.) */}
      {subHeader}

      {/* Content */}
      <div className="flex-1 pl-2 pr-2 pb-2 pt-3 min-h-0 overflow-auto">
        {children}
      </div>

      {/* Resize handles */}
      <div className="absolute top-0 right-0 w-2 h-full cursor-ew-resize z-10 hover:bg-blue-500/30" onMouseDown={onResizeStart("e")} />
      <div className="absolute bottom-0 left-0 w-full h-2 cursor-ns-resize z-10 hover:bg-blue-500/30" onMouseDown={onResizeStart("s")} />
      <div className="absolute top-0 left-0 w-2 h-full cursor-ew-resize z-10 hover:bg-blue-500/30" onMouseDown={onResizeStart("w")} />
      <div className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-20 hover:bg-blue-500/30 rounded-br-xl" onMouseDown={onResizeStart("se")} />
      <div className="absolute bottom-0 left-0 w-5 h-5 cursor-nesw-resize z-20 hover:bg-blue-500/30 rounded-bl-xl" onMouseDown={onResizeStart("sw")} />
    </div>
  );
};

export default FloatingPanel;
