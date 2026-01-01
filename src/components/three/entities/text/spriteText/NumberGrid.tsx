import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import SpriteText from "three-spritetext";

type Props = {
  /** 사각형 가로/세로(World 단위) */
  readonly width?: number;
  readonly height?: number;
  /** 행/열 (기본 100x100 = 10,000개) */
  readonly rows?: number;
  readonly cols?: number;
  /** 라벨 색상 & 배경 */
  readonly color?: string;
  readonly backgroundColor?: string; // "transparent" 유지 가능
  /** 텍스트 높이(셀 높이 * scale) */
  readonly textHeightScale?: number; // 0~1, 기본 0.7
  /** z 고정 높이 */
  readonly z?: number; // 기본 1.0
  /** 한 프레임에 생성할 개수(너무 크면 멈칫할 수 있음) */
  readonly batchSize?: number; // 기본 500
  /** 테두리 프레임 표시 여부 */
  readonly showFrame?: boolean;
  readonly frameColor?: string;
};

export default function NumberGrid({
  width = 200,
  height = 200,
  rows = 100,
  cols = 100,
  color = "#ffffff",
  backgroundColor = "transparent",
  textHeightScale = 0.7,
  z = 1,
  batchSize = 500,
  showFrame = true,
  frameColor = "#888",
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const frameRef = useRef<THREE.LineLoop>(null);
  const total = rows * cols; // 10,000 기본

  // 셀 크기 & 시작 좌표 (센터 기준 배치)
  const layout = useMemo(() => {
    const cellW = (width / cols) * 3; // 그룹 간격 넓히기 (1.5배)
    const cellH = (height / rows) * 3; // 그룹 간격 넓히기 (1.5배)
    const startX = -width / 2 + cellW / 2;
    const startY = height / 2 - cellH / 2; // 위에서 아래로
    const textHeight = Math.min(cellW, cellH) * textHeightScale;
    return { cellW, cellH, startX, startY, textHeight };
  }, [width, height, rows, cols, textHeightScale]);

  // 프레임(사각 경계선) 생성/갱신
  useEffect(() => {
    if (!showFrame) return;
    const g =
      frameRef.current ??
      new THREE.LineLoop(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: frameColor })
      );
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-width / 2, -height / 2, z),
      new THREE.Vector3(width / 2, -height / 2, z),
      new THREE.Vector3(width / 2, height / 2, z),
      new THREE.Vector3(-width / 2, height / 2, z),
    ]);
    g.geometry.dispose();
    g.geometry = geo;
    g.position.set(0, 0, 0);
    groupRef.current?.add(g);

    return () => {
      groupRef.current?.remove(g);
      g.geometry.dispose();
      (g.material as THREE.Material).dispose();
    };
  }, [showFrame, frameColor, width, height, z]);

  // 숫자 스프라이트 점진 생성
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    let cancelled = false;
    let created: SpriteText[] = [];
    const { cellW, cellH, startX, startY, textHeight } = layout;

    // 기존 것 정리
    while (group.children.length) {
      const child = group.children.pop()!;
      if (child === frameRef.current) {
        group.add(child);
        break;
      } // 프레임 유지
      disposeChild(child);
    }

    // 숫자 문자열 미리 생성
    const texts: string[] = new Array(total);
    for (let i = 0; i < total; i++) {
      texts[i] = i.toString().padStart(4, "0"); // 0000~9999
    }

    // 배치 생성 루프
    const makeBatch = (startIdx: number) => {
      if (cancelled) return;
      const end = Math.min(startIdx + batchSize, total);

      for (let idx = startIdx; idx < end; idx++) {
        const r = Math.floor(idx / cols);
        const c = idx % cols;

        const x = startX + c * cellW;
        const y = startY - r * cellH;

        const spr = new SpriteText(texts[idx]);
        spr.color = color;
        spr.textHeight = textHeight; // 월드 단위 높이
        spr.backgroundColor = backgroundColor; // 'transparent' 유지 가능
        spr.position.set(x, y, z);
        group.add(spr);
        created.push(spr);
      }

      if (end < total) {
        requestAnimationFrame(() => makeBatch(end));
      }
    };

    makeBatch(0);

    return () => {
      cancelled = true;
      for (const child of created) {
        disposeChild(child);
      }
      created = [];
    };
  }, [total, cols, layout, color, backgroundColor, z, batchSize]);

  return <group ref={groupRef} />;
}

function disposeChild(obj: THREE.Object3D) {
  if ((obj as any).map?.dispose) (obj as any).map.dispose();
  if ((obj as any).material?.dispose) {
    const m = (obj as any).material as THREE.Material;
    if ((m as any).map?.dispose) (m as any).map.dispose();
    m.dispose();
  }
}
