// shared/useDragResize.ts
// 드래그 & 리사이즈 훅 — FloatingPanel, DataPanel 등에서 공통 사용

import { useRef, useState, useCallback } from "react";

export type ResizeDir = "e" | "s" | "se" | "w" | "sw" | null;

export interface DragResizeOptions {
  defaultX?: number;
  defaultY?: number;
  defaultW?: number;
  defaultH?: number;
  minW?: number;
  minH?: number;
}

/** 드래그/리사이즈 중 DOM 직접 조작 → mouseup 시에만 React state 반영 */
export function useDragResize(opts: DragResizeOptions = {}) {
  const {
    defaultX = 0,
    defaultY = 60,
    defaultW = 750,
    defaultH = window.innerHeight - 160,
    minW = 400,
    minH = 250,
  } = opts;

  const elRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef({ x: defaultX, y: defaultY, w: defaultW, h: defaultH });
  const [, forceUpdate] = useState(0);

  const applyStyle = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const { x, y, w, h } = liveRef.current;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.width = w + "px";
    el.style.height = h + "px";
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = liveRef.current;
    const startX = e.clientX, startY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      liveRef.current.x = x + (ev.clientX - startX);
      liveRef.current.y = y + (ev.clientY - startY);
      applyStyle();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      forceUpdate(n => n + 1);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [applyStyle]);

  const onResizeStart = useCallback((dir: ResizeDir) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { w: origW, h: origH, x: origX } = liveRef.current;
    const startX = e.clientX, startY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dir === "e" || dir === "se") liveRef.current.w = Math.max(minW, origW + dx);
      if (dir === "s" || dir === "se" || dir === "sw") liveRef.current.h = Math.max(minH, origH + dy);
      if (dir === "w" || dir === "sw") {
        const newW = Math.max(minW, origW - dx);
        liveRef.current.w = newW;
        liveRef.current.x = origX + (origW - newW);
      }
      applyStyle();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      forceUpdate(n => n + 1);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [minW, minH, applyStyle]);

  const initialStyle = {
    left: liveRef.current.x,
    top: liveRef.current.y,
    width: liveRef.current.w,
    height: liveRef.current.h,
  };

  return { elRef, initialStyle, onDragStart, onResizeStart };
}
