import React, { useMemo } from 'react';
import { useNodeStore } from '@/store/map/nodeStore';
import { useFabStore } from '@/store/map/fabStore';

/**
 * Floor component - Creates a factory floor at z=0
 */
const Floor: React.FC = () => {
  const nodes = useNodeStore((state) => state.nodes);
  const fabs = useFabStore((state) => state.fabs);
  const fabCountX = useFabStore((state) => state.fabCountX);
  const fabCountY = useFabStore((state) => state.fabCountY);

  const { width, height, centerX, centerY } = useMemo(() => {
    if (nodes.length === 0) {
      return { width: 200, height: 200, centerX: 0, centerY: 0 };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    // 멀티 fab: 모든 fab bounds union으로 계산
    if (fabs.length > 1) {
      for (const fab of fabs) {
        minX = Math.min(minX, fab.xMin);
        maxX = Math.max(maxX, fab.xMax);
        minY = Math.min(minY, fab.yMin);
        maxY = Math.max(maxY, fab.yMax);
      }
    } else {
      // 단일 fab: nodes bounds 사용
      for (const node of nodes) {
        minX = Math.min(minX, node.editor_x);
        maxX = Math.max(maxX, node.editor_x);
        minY = Math.min(minY, node.editor_y);
        maxY = Math.max(maxY, node.editor_y);
      }
    }

    const padding = 50;
    // fab grid 크기에 비례한 추가 여유 (절반: a×b/2)
    const totalFabs = Math.max(1, fabCountX * fabCountY);
    const scale = Math.max(1, totalFabs / 2);
    const baseWidth = maxX - minX + padding * 2;
    const baseHeight = maxY - minY + padding * 2;
    const width = baseWidth * scale;
    const height = baseHeight * scale;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return { width, height, centerX, centerY };
  }, [nodes, fabs, fabCountX, fabCountY]);

  return (
    <mesh position={[centerX, centerY, -1]} receiveShadow>
      {/* Dynamic plane for factory floor - normal vector points to +Z */}
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        color="#404040"
        roughness={0.8}
        metalness={0.1}
      />
    </mesh>
  );
};

export default Floor;
