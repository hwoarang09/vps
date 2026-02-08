// FabContext/loop-mode.ts
// LOOP 모드 관련 로직

import type { Edge } from "@/types/edge";
import type { VehicleLoop } from "@/common/vehicle/logic/TransferMgr";
import type { EngineStore } from "../EngineStore";

/**
 * Edge 시퀀스 추적 (nextEdgeIndices[0]를 따라가며 최대 maxSteps까지)
 *
 * @param startEdge - 시작 edge
 * @param edges - Edge 배열 (0-based)
 * @param maxSteps - 최대 추적 깊이 (기본 100)
 * @returns edge 이름 배열
 */
function traceEdgeSequence(
  startEdge: Edge,
  edges: Edge[],
  maxSteps: number = 100
): string[] {
  const sequence: string[] = [startEdge.edge_name];
  let edge = startEdge;
  const startEdgeName = startEdge.edge_name;

  for (let j = 0; j < maxSteps; j++) {
    if (!edge.nextEdgeIndices?.length) break;
    const nextIdx = edge.nextEdgeIndices[0];
    if (nextIdx < 1) break; // 1-based: 0 is invalid

    const nextEdge = edges[nextIdx - 1]; // Convert to 0-based for array access
    if (!nextEdge || nextEdge.edge_name === startEdgeName) break; // 순환 감지

    sequence.push(nextEdge.edge_name);
    edge = nextEdge;
  }

  return sequence;
}

/**
 * LOOP 모드: 각 차량의 순환 경로 구축
 *
 * 동작:
 * - 각 차량의 현재 edge에서 시작
 * - nextEdgeIndices[0]를 따라 최대 100개 edge 순서를 추적
 * - vehicleLoopMap에 { edgeSequence: [...] } 형태로 저장
 *
 * 사용:
 * - TransferMode.LOOP일 때 TransferMgr.getNextEdgeFromLoop()에서 사용
 */
export function buildVehicleLoopMap(
  vehicleLoopMap: Map<number, VehicleLoop>,
  actualNumVehicles: number,
  store: EngineStore,
  edges: Edge[]
): void {
  vehicleLoopMap.clear();

  for (let i = 0; i < actualNumVehicles; i++) {
    const currentEdgeIndex = store.getVehicleCurrentEdge(i);
    if (currentEdgeIndex < 1) continue; // 1-based: 0 is invalid
    const currentEdge = edges[currentEdgeIndex - 1]; // Convert to 0-based for array access
    if (!currentEdge) continue;

    const sequence = traceEdgeSequence(currentEdge, edges);
    vehicleLoopMap.set(i, { edgeSequence: sequence });
  }
}
